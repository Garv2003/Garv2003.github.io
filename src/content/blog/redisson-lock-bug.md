---
title: "The Redisson Lock Bug That Took Down Three Services"
date: "2026-05-18"
description: "Three services threw 5xx at once from one line of lock code. A walk through the diagnosis, the thread-ownership root cause, and the fix."
tags: ["distributed-systems", "java", "redis", "incident", "concurrency"]
---

A few months ago, three of our backend services started throwing 5xx errors
simultaneously. Same stack trace, different services. The culprit turned out to be a
single line of code that violated a contract I hadn't fully read.

This is a write-up of that incident — the diagnosis, the root cause, the fix, and the
lesson.

## The Alert

It started with a monitoring spike. Three services, all showing elevated error rates
within the same two-minute window. The alerts fired close enough together that it was
clearly one root cause, not three independent failures.

The stack traces were nearly identical across all three:

```
java.lang.IllegalMonitorStateException
    at org.redisson.RedissonLock.unlock(RedissonLock.java:...)
    at com.example.service.SomeService.processRequest(SomeService.java:...)
```

The services were separate deployments with separate codebases, but they shared one
thing: they all used Redisson — a Java client for Redis — for distributed locking.

The immediate priority was triage: were users being affected? Yes. Requests that required
the locked resource were failing with 500s. Revenue-impacting. Clock was running.

## Initial Hypothesis

My first assumption was Redis. When distributed lock errors start appearing, the obvious
suspect is the lock store — maybe Redis had a blip, maybe connections were timing out,
maybe the cluster had a failover.

I checked Redis metrics. Everything looked healthy: memory stable, connection count
normal, no latency spikes, no failover events. Redis was fine.

Second hypothesis: lock contention. Maybe too many threads were trying to acquire the same
lock simultaneously and something was deadlocking or timing out under load. Checked the
lock acquisition metrics — acquisitions were succeeding. The failures were only on unlock.

That narrowed it down considerably. Something was going wrong at `unlock()` specifically,
and it wasn't the Redis layer.

## Narrowing It Down

I went back to the stack trace and focused on the exception type:
`IllegalMonitorStateException`.

In standard Java, `IllegalMonitorStateException` is thrown when a thread tries to call
`notify()`, `notifyAll()`, or `wait()` on a monitor it doesn't own. The pattern is: you
can only release what you hold. Redisson uses the same concept.

I looked up Redisson's contract for `RLock.unlock()`. The documentation is explicit:

> Unlocks the lock. Throws `IllegalMonitorStateException` if the current thread does not
> hold the lock.

So the exception wasn't ambiguous — it was telling us exactly what happened. The thread
calling `unlock()` was not the same thread that had called `lock()`. Redisson tracks lock
ownership by thread ID (and by the Redisson connection/node), and those weren't matching.

The question was: how did the thread change between acquire and release?

## Root Cause

The lock lifecycle in all three services followed roughly the same pattern:

```java
RLock lock = redissonClient.getLock("resource-lock-key");
lock.lock();
try {
    // do the work
} finally {
    lock.unlock();
}
```

This looks safe. And in a purely synchronous call chain, it is.

The problem was that "do the work" wasn't purely synchronous in these code paths.
Somewhere between `lock.lock()` and `lock.unlock()`, the execution was being handed off to
a different thread — a thread pool, an async executor, a callback handler. The exact
mechanism differed slightly across the three services, but the outcome was the same: by
the time `finally { lock.unlock(); }` ran, it was running on a thread that hadn't acquired
the lock.

Redisson checks the thread ID stored in Redis against the current thread's ID. No match —
`IllegalMonitorStateException`.

This is not a Redisson bug. It's a correct enforcement of the lock ownership contract. The
bug was in how we were using it.

The subtle danger here is that the code looks obviously correct. The `try/finally` pattern
is the standard Java lock pattern. You'd have to know that Redisson's `RLock` is
thread-affine — it binds ownership to the acquiring thread — to spot the problem on a code
review.

## The Fix

There were two options.

**Option 1: Ensure lock acquire and release happen on the same thread.** Restructure the
code so that any async dispatch happens either before the lock is acquired or after it is
released — never while the lock is held. This is the correct long-term fix because it
eliminates the thread-ownership violation entirely rather than working around it.

**Option 2: Use `RLock.forceUnlock()`.** Redisson provides `forceUnlock()`, which releases
the lock regardless of which thread calls it. This is sometimes the right tool — for
example, in cleanup code where you genuinely can't guarantee thread affinity. But it
bypasses the ownership check: if two threads both think they're the owner, `forceUnlock()`
can silently corrupt the lock state. It's a scalpel, not a default.

We went with Option 1 across all three services. Async dispatches were refactored so that:

1. The lock was acquired
2. All work happened synchronously on the acquiring thread
3. The lock was released
4. Any async dispatch happened after the release

## What We Added

**Structured logging on the lock lifecycle.** Every `lock()` and `unlock()` now logs the
lock key, the thread ID, and a timestamp — almost free at runtime, and it makes the next
thread-ownership incident trivially diagnosable by correlating acquire and release by
thread ID.

```java
log.info("Acquiring lock key={} threadId={}", lockKey, Thread.currentThread().getId());
lock.lock();
try {
    // work
} finally {
    log.info("Releasing lock key={} threadId={}", lockKey, Thread.currentThread().getId());
    lock.unlock();
}
```

**A unit test for the async path.** It exercises the exact code path where the async
dispatch was occurring and asserts the lock is acquired and released on the same thread. If
someone reintroduces the async dispatch inside the locked section, the test fails with a
clear message rather than a mysterious 5xx in production.

## Takeaway

Redisson's `RLock` is thread-affine: the thread that acquires the lock must be the thread
that releases it. If your code has any async dispatch, callback, or thread-pool handoff
inside a locked section, you will hit `IllegalMonitorStateException` — not a question of
if, only of when the load is high enough to exercise that path.

Before using any distributed lock library, read its thread-ownership contract. It should
be on page one of the docs. If it isn't, assume it's thread-affine and verify.
