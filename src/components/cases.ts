export type NodeDef = { x: number; y: number; w: number; h: number; title: string; sub: string };
export type EdgeDef = { id: string; from: string; to: string };
export type Phase =
  | { kind: 'move'; from: string; to: string; edge: string; status?: string; done?: string }
  | { kind: 'blink'; node: string; edge: string; status?: string }
  | { kind: 'parallel'; from: string; branches: { to: string; edge: string }[]; status?: string; done?: string }
  | { kind: 'fail'; node: string; status?: string }
  | { kind: 'failmove'; from: string; to: string; edge: string; red?: boolean; dim?: string[]; failNode?: string; status?: string };

export type Decision = { t: string; d: string; a: string; w: string };

export type CaseDef = {
  id: string;
  tab: string;
  title: string;
  thesis: string;
  chips: string[];
  problem: string;
  nodes: Record<string, NodeDef>;
  edges: EdgeDef[];
  extraEdges?: EdgeDef[]; // rendered but only lit during failure
  trace: Phase[];
  failTrace: Phase[];
  failLabel: string;
  scaleLabel: string;
  scale: { status: string; ghosts?: { x: number; y: number; w: number; h: number; opacity: number }[]; annotation?: { x: number; y: number; text: string } };
  decisions: Decision[];
  followups: string[];
};

const N = (x: number, y: number, w: number, h: number, title: string, sub: string): NodeDef => ({ x, y, w, h, title, sub });

export const CASES: CaseDef[] = [
  // ── 1. Async Notification Pipeline ─────────────────────────────────────────
  {
    id: 'notification', tab: 'Notification Pipeline',
    title: 'Async Notification Pipeline',
    thesis: 'Decoupling push delivery from the request path so a slow third party can never stall the app — how I built it, the tradeoffs, and how it scales to 100M users.',
    chips: ['Java', 'Amazon SQS', 'Redis', 'APNs / FCM', '◆ shipped'],
    problem: 'Send push notifications to <b>100M users</b> — some time-sensitive, some batched — without the notification path ever blocking the action that triggered it, and without spamming users into muting the app.',
    nodes: {
      srv: N(20, 176, 120, 48, 'App', 'producer'),
      api: N(190, 176, 120, 48, 'API', 'publisher'),
      sqs: N(370, 176, 120, 48, 'SQS', 'queue'),
      wrk: N(560, 176, 120, 48, 'Worker', 'consumer'),
      rds: N(560, 64, 120, 48, 'Redis', 'rate limit'),
      apns: N(770, 132, 130, 46, 'APNs', 'iOS'),
      fcm: N(770, 230, 130, 46, 'FCM', 'Android'),
      dlq: N(560, 300, 120, 48, 'DLQ', 'dead-letter'),
    },
    edges: [
      { id: 'e1', from: 'srv', to: 'api' }, { id: 'e2', from: 'api', to: 'sqs' },
      { id: 'e3', from: 'sqs', to: 'wrk' }, { id: 'er', from: 'wrk', to: 'rds' },
      { id: 'e4', from: 'wrk', to: 'apns' }, { id: 'e5', from: 'wrk', to: 'fcm' },
      { id: 'e6', from: 'wrk', to: 'dlq' },
    ],
    trace: [
      { kind: 'move', from: 'srv', to: 'api', edge: 'e1', status: '<b>App</b> emits an event → <b>API</b> publishes to the queue…' },
      { kind: 'move', from: 'api', to: 'sqs', edge: 'e2', status: 'Event <b>queued</b> — the request returns immediately; delivery is decoupled.' },
      { kind: 'move', from: 'sqs', to: 'wrk', edge: 'e3', status: 'A worker consumes the message.' },
      { kind: 'blink', node: 'rds', edge: 'er', status: 'Worker checks <b>Redis</b> rate limits before dispatch…' },
      { kind: 'parallel', from: 'wrk', branches: [{ to: 'apns', edge: 'e4' }, { to: 'fcm', edge: 'e5' }], status: 'Routes per platform → <b>APNs</b> + <b>FCM</b> in parallel.', done: 'Delivered. The trigger never waited on push — <b>latency stays flat</b>.' },
    ],
    failTrace: [
      { kind: 'move', from: 'srv', to: 'api', edge: 'e1', status: 'App emits an event → API publishes…' },
      { kind: 'move', from: 'api', to: 'sqs', edge: 'e2' },
      { kind: 'move', from: 'sqs', to: 'wrk', edge: 'e3', status: 'Worker consumes; APNs is unreachable…' },
      { kind: 'failmove', from: 'wrk', to: 'dlq', edge: 'e6', red: true, dim: ['e4', 'e5'], failNode: 'wrk', status: 'Delivery failed → routed to the <b>DLQ</b> for retry &amp; audit — never silently dropped.' },
    ],
    failLabel: 'Simulate failure',
    scaleLabel: '10× scale',
    scale: { status: '<b>10×:</b> add worker instances to one consumer group — throughput scales horizontally.', ghosts: [{ x: 566, y: 164, w: 120, h: 48, opacity: 0.5 }, { x: 572, y: 158, w: 120, h: 48, opacity: 0.3 }], annotation: { x: 430, y: 150, text: '↑ consumer group · N workers' } },
    decisions: [
      { t: 'A queue, not a direct call', d: 'Publish the event to SQS instead of calling the push provider inline on the request thread.', a: 'A synchronous HTTP call to the notification service from the request path.', w: 'Decouples delivery latency from the action. A slow or down provider can never stall the request or push back-pressure into app logic.' },
      { t: 'Route per platform at the worker', d: 'Workers branch to APNs (iOS) or FCM (Android) with platform-specific payloads and retry behavior.', a: 'One unified sender hiding both providers.', w: 'APNs and FCM differ in API shape, payload limits, and retry semantics — isolating them keeps each provider’s quirks contained.' },
      { t: 'Redis for rate limiting', d: 'Per-user TTL counters checked before dispatch; thresholds configurable per notification type.', a: 'Counting in the primary database.', w: 'TTL counters are O(1) and in-memory — cheap on every send, so we never spam a user or trip Apple/Google abuse flags.' },
      { t: 'Dead-letter queue for failures', d: 'Undeliverable messages move to a DLQ for inspection and retry.', a: 'Drop the message, or retry inline until it succeeds.', w: 'Inline retries block the worker; dropping loses the notification. A DLQ makes failures auditable and replayable without stalling live traffic.' },
    ],
    followups: [
      'How do you handle device-token invalidation — expired tokens, reinstalls?',
      'How do you support notification preferences — a user opts out of a category?',
      'How do you keep ordering for time-sensitive alerts vs. batched digests?',
      'What happens if the worker pool falls behind — how do you shed or prioritize load?',
    ],
  },

  // ── 2. Account Migration & Merge ───────────────────────────────────────────
  {
    id: 'merge', tab: 'Account Merge',
    title: 'Account Migration & Merge',
    thesis: 'Merging a guest account into a registered one without losing progress — safe under partial failure, idempotent under retries, auditable end to end.',
    chips: ['Java', 'MongoDB', 'Redis', '3 services', '◆ shipped'],
    problem: 'Let a user merge a <b>guest account</b> into a registered one without losing data — handling partial failures, preventing the same account merging twice, and keeping an audit trail.',
    nodes: {
      client: N(20, 190, 130, 48, 'Client', 'guest + social'),
      api: N(210, 190, 130, 48, 'Merge API', 'verify'),
      code: N(210, 74, 130, 48, 'Redis', 'one-time code · TTL'),
      merge: N(410, 190, 150, 48, 'Atomic Merge', 'across 3 services'),
      audit: N(640, 116, 150, 48, 'Audit log', 'per-asset outcome'),
      retry: N(640, 262, 150, 48, 'Retry job', 'completes partials'),
    },
    edges: [
      { id: 'm1', from: 'client', to: 'api' }, { id: 'mc', from: 'api', to: 'code' },
      { id: 'm2', from: 'api', to: 'merge' }, { id: 'm3', from: 'merge', to: 'audit' },
      { id: 'm4', from: 'merge', to: 'retry' },
    ],
    trace: [
      { kind: 'move', from: 'client', to: 'api', edge: 'm1', status: 'Client submits a one-time migration code.' },
      { kind: 'blink', node: 'code', edge: 'mc', status: 'Validate the <b>TTL code</b> (Redis) behind an email-verification gate.' },
      { kind: 'move', from: 'api', to: 'merge', edge: 'm2', status: '<b>Atomic merge</b> across 3 services — an <b>idempotency key</b> blocks double-merge.' },
      { kind: 'move', from: 'merge', to: 'audit', edge: 'm3', status: 'Each asset transfer is logged to the <b>audit log</b>.', done: 'Guest merged into social. Balance integrity held; no double-merge.' },
    ],
    failTrace: [
      { kind: 'move', from: 'client', to: 'api', edge: 'm1', status: 'Client submits the migration code.' },
      { kind: 'blink', node: 'code', edge: 'mc', status: 'Code validated…' },
      { kind: 'move', from: 'api', to: 'merge', edge: 'm2', status: 'Atomic merge begins — one asset transfer will fail…' },
      { kind: 'failmove', from: 'merge', to: 'retry', edge: 'm4', red: true, dim: ['m3'], failNode: 'merge', status: 'A transfer failed → the <b>audit log captured the partial state</b> → a retry job completes it without re-running the whole merge.' },
    ],
    failLabel: 'Simulate partial failure',
    scaleLabel: 'Concurrency',
    scale: { status: '<b>Same-user race:</b> two concurrent merges arrive → the idempotency key dedupes; exactly one wins, the other is a no-op.', ghosts: [{ x: 26, y: 178, w: 130, h: 48, opacity: 0.4 }], annotation: { x: 85, y: 166, text: '⇈ concurrent request · deduped' } },
    decisions: [
      { t: 'One-time code with a TTL', d: 'Migration is gated by a short-lived code stored in Redis with a TTL; the client submits it to start the merge.', a: 'Merge triggered directly on login.', w: 'Gates the merge behind an explicit, time-bounded user action — prevents stale or accidental merges from session confusion.' },
      { t: 'Idempotency key on the merge', d: 'The grant/merge handler checks a dedup key before writing.', a: 'Trust that the trigger fires exactly once.', w: 'Callbacks and retries can fire more than once; the key makes a double-merge impossible under concurrency and at-least-once delivery.' },
      { t: 'Per-asset audit log', d: 'Each asset type logs its transfer outcome independently.', a: 'One all-or-nothing transaction across services.', w: 'True cross-service atomicity is expensive/unavailable; a per-asset log lets a retry job finish a partial merge without redoing completed work.' },
      { t: 'Expiry before hard delete', d: 'On account deletion, run expiry first, then delete.', a: 'Delete rows directly.', w: 'Avoids phantom credits and dangling references — the balance is settled before the account disappears.' },
    ],
    followups: [
      'What if the same guest account tries to merge into two different social accounts?',
      'What if both accounts have non-zero balances that can’t simply be added?',
      'How would you support undoing a merge?',
      'How do you test the idempotency logic under concurrent load?',
    ],
  },

  // ── 3. Real-time Leaderboard ───────────────────────────────────────────────
  {
    id: 'leaderboard', tab: 'Real-time Leaderboard',
    title: 'Real-time Leaderboard',
    thesis: 'Live ranks for a multiplayer game — O(log N) updates, one push per interval instead of per score change, and recovery when the cache dies.',
    chips: ['Java', 'Redis ZSET', 'WebSockets', 'MongoDB', '◆ shipped'],
    problem: 'A leaderboard for a multiplayer game — scores update in real time, users see their rank and the top N, at <b>10,000 concurrent rooms</b>. Cheap to update, cheap to broadcast.',
    nodes: {
      game: N(20, 190, 130, 48, 'Game svc', 'score write'),
      mongo: N(20, 74, 130, 48, 'MongoDB', 'source of truth'),
      redis: N(250, 190, 150, 48, 'Redis ZSET', 'live ranking'),
      snap: N(470, 190, 150, 48, 'Snapshot', 'every 30s'),
      ws: N(700, 190, 160, 48, 'WebSocket', 'push to clients'),
    },
    edges: [
      { id: 'l1', from: 'game', to: 'redis' }, { id: 'lm', from: 'game', to: 'mongo' },
      { id: 'l3', from: 'redis', to: 'snap' }, { id: 'l4', from: 'snap', to: 'ws' },
    ],
    extraEdges: [{ id: 'lr', from: 'mongo', to: 'redis' }],
    trace: [
      { kind: 'move', from: 'game', to: 'redis', edge: 'l1', status: 'Score write → <b>Redis sorted set</b> (ZADD) — O(log N) rank updates.' },
      { kind: 'blink', node: 'mongo', edge: 'lm', status: 'Durable copy to <b>MongoDB</b> — the source of truth for end-of-round resolution.' },
      { kind: 'move', from: 'redis', to: 'snap', edge: 'l3', status: 'Every <b>30s</b> the server batches a snapshot — not every score change.' },
      { kind: 'move', from: 'snap', to: 'ws', edge: 'l4', status: 'Pushed to all clients over <b>WebSocket</b>; clients animate the transition.', done: 'Live ranks, O(log N) writes, one push / 30s — cheap even at 10k rooms.' },
    ],
    failTrace: [
      { kind: 'move', from: 'game', to: 'redis', edge: 'l1', status: 'Scores are flowing into Redis…' },
      { kind: 'fail', node: 'redis', status: '<b>Redis restarts</b> — the live ranking is lost from cache.' },
      { kind: 'failmove', from: 'mongo', to: 'redis', edge: 'lr', dim: ['l1', 'l3', 'l4'], status: 'Rebuilt from the <b>MongoDB source of truth</b> on reconnect — no permanent data loss.' },
    ],
    failLabel: 'Redis restart',
    scaleLabel: 'Global scale',
    scale: { status: '<b>Global board:</b> shard the sorted set by region/bucket, then merge top-N across shards for a single global ranking.', annotation: { x: 325, y: 168, text: '⇉ sharded ZSETs · merge top-N' } },
    decisions: [
      { t: 'Redis sorted sets for ranking', d: 'ZADD / ZREVRANK give O(log N) score updates and rank lookups.', a: 'Sort rows in a relational table on read.', w: 'A sorted set is the natural fit for real-time ranking — no full scan, no per-read sort, and rank lookups are cheap.' },
      { t: 'Per-room state isolation', d: 'Each active room has its own sorted set keyed by room ID.', a: 'One global sorted set for everyone.', w: 'Keeps leaderboard ops local to a room and avoids cross-room interference at 10k concurrent rooms.' },
      { t: 'Snapshot push every 30s', d: 'The server batches and pushes a snapshot on an interval, not on every score update.', a: 'Push every score change to every client.', w: 'Per-update fan-out is O(updates × clients) — ruinous at scale. A batched snapshot bounds broadcast cost; clients animate between snapshots.' },
      { t: 'Redis for reads, Mongo for truth', d: 'Redis is the live read path; MongoDB is the durable source of truth.', a: 'Serve everything from one store.', w: 'Redis gives speed but is a cache; Mongo lets the board rebuild after a restart and resolves the authoritative end-of-round result.' },
    ],
    followups: [
      'How do you shard the sorted set for a global leaderboard across millions of users?',
      'What happens to leaderboard data if Redis restarts — how do you recover?',
      'How would you add a "friends leaderboard" (rank among friends only) efficiently?',
      'How do you handle a tie in scores deterministically?',
    ],
  },
];
