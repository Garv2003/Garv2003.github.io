import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { CASES, type CaseDef } from './cases';

const center = (n: CaseDef['nodes'][string]): [number, number] => [n.x + n.w / 2, n.y + n.h / 2];

function clip(from: CaseDef['nodes'][string], toC: [number, number]): [number, number] {
  const [fx, fy] = center(from);
  const dx = toC[0] - fx, dy = toC[1] - fy;
  if (dx === 0 && dy === 0) return [fx, fy];
  const sx = dx !== 0 ? (from.w / 2 + 3) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (from.h / 2 + 3) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [fx + dx * s, fy + dy * s];
}

export default function CaseStudies() {
  const [idx, setIdx] = useState(0);
  const c = CASES[idx];
  const root = useRef<HTMLDivElement>(null);
  const [scaled, setScaled] = useState(false);
  const [failing, setFailing] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState({ cls: '', html: 'Press <b>Trace a request</b> to watch the flow.' });

  useEffect(() => {
    const id = decodeURIComponent(location.hash.replace('#', ''));
    const i = CASES.findIndex((cc) => cc.id === id);
    if (i >= 0) setIdx(i);
  }, []);

  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const node = (k: string) => root.current!.querySelector('#n_' + k) as SVGGElement;
  const edge = (k: string) => root.current!.querySelector('#e_' + k) as SVGPathElement;
  const tok = () => root.current!.querySelector('#token') as SVGCircleElement;
  const tokB = () => root.current!.querySelector('#tokenB') as SVGCircleElement;

  function switchCase(i: number) {
    if (running) return;
    setIdx(i); setScaled(false); setFailing(false);
    setStatus({ cls: '', html: 'Press <b>Trace a request</b> to watch the flow.' });
    try { history.replaceState(null, '', `/systems#${CASES[i].id}`); } catch { /* ignore */ }
  }

  function clear() {
    root.current!.querySelectorAll('.node').forEach((n) => n.classList.remove('on', 'pulse', 'fail'));
    root.current!.querySelectorAll('.edge').forEach((e) => e.classList.remove('lit', 'litfail', 'dim'));
    [tok(), tokB()].forEach((t) => { t.setAttribute('opacity', '0'); t.classList.remove('tok-fail'); });
  }
  const place = (el: SVGCircleElement, k: string) => {
    const [x, y] = center(c.nodes[k]); el.setAttribute('cx', String(x)); el.setAttribute('cy', String(y)); el.setAttribute('opacity', '1');
  };
  function moveTo(el: SVGCircleElement, k: string, dur: number) {
    const [x, y] = center(c.nodes[k]);
    if (reduce) { el.setAttribute('cx', String(x)); el.setAttribute('cy', String(y)); return Promise.resolve(); }
    return new Promise<void>((res) => { gsap.to(el, { attr: { cx: x, cy: y }, duration: dur, ease: 'power1.inOut', onComplete: () => res() }); });
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
  const say = (cls: string, html?: string) => html && setStatus({ cls, html });

  async function run() {
    if (running) return;
    setRunning(true); clear();
    const D = reduce ? 0 : 0.5;
    const phases = failing ? c.failTrace : c.trace;

    for (const p of phases) {
      if (p.kind === 'move') {
        say('run', p.status); edge(p.edge).classList.add('lit'); node(p.from).classList.add('on');
        place(tok(), p.from); await moveTo(tok(), p.to, D); node(p.to).classList.add('on');
        if (p.done) say('done', p.done);
      } else if (p.kind === 'blink') {
        say('run', p.status); edge(p.edge).classList.add('lit'); node(p.node).classList.add('pulse');
        await wait(480); node(p.node).classList.remove('pulse'); node(p.node).classList.add('on');
      } else if (p.kind === 'parallel') {
        say('run', p.status); node(p.from).classList.add('on');
        p.branches.forEach((b) => edge(b.edge).classList.add('lit'));
        place(tok(), p.from); if (p.branches[1]) place(tokB(), p.from);
        await Promise.all(p.branches.map((b, i) => moveTo(i === 0 ? tok() : tokB(), b.to, D)));
        p.branches.forEach((b) => node(b.to).classList.add('on'));
        if (p.done) say('done', p.done);
      } else if (p.kind === 'fail') {
        say('err', p.status); node(p.node).classList.add('fail'); await wait(560);
      } else if (p.kind === 'failmove') {
        say('err', p.status);
        (p.dim ?? []).forEach((d) => edge(d).classList.add('dim'));
        if (p.failNode) node(p.failNode).classList.add('fail');
        edge(p.edge).classList.add(p.red ? 'litfail' : 'lit');
        const t = tok(); place(t, p.from); if (p.red) t.classList.add('tok-fail');
        await moveTo(t, p.to, D);
        if (p.red) node(p.to).classList.add('fail');
        else { node(p.to).classList.remove('fail'); node(p.to).classList.add('on'); }
      }
    }
    setRunning(false);
  }

  function toggleScale() {
    const v = !scaled; setScaled(v);
    setStatus({ cls: '', html: v ? c.scale.status : 'Press <b>Trace a request</b> to watch the flow.' });
  }
  function toggleFail() {
    const v = !failing; setFailing(v);
    setStatus({ cls: '', html: v ? '<b>Failure armed</b> — trace now to see the failure path.' : 'Press <b>Trace a request</b> to watch the flow.' });
  }

  const allEdges = [...c.edges, ...(c.extraEdges ?? [])];

  return (
    <div className="cs" ref={root}>
      <style>{`
        .cs .tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 22px;border-bottom:1px solid var(--border);}
        .cs .tab{font-family:var(--mono);font-size:12.5px;padding:9px 14px;color:var(--muted);border:1px solid transparent;border-bottom:none;border-radius:7px 7px 0 0;background:none;cursor:pointer;position:relative;top:1px;}
        .cs .tab[aria-selected="true"]{color:var(--text);background:var(--surface);border-color:var(--border);}
        .cs .ch-title{font-size:clamp(24px,4.4vw,36px);font-weight:800;letter-spacing:-.02em;line-height:1.06;text-wrap:balance;margin-bottom:12px;}
        .cs .thesis{color:var(--muted);font-size:16px;max-width:62ch;}
        .cs .chips{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 4px;}
        .cs .chip{font-family:var(--mono);font-size:11.5px;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 10px;}
        .cs .chip.real{color:var(--ok);border-color:var(--ok-soft);background:var(--ok-soft);}
        .cs .label{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:34px 0 14px;}
        .cs .prob{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;padding:15px 18px;color:var(--muted);font-size:14.5px;}
        .cs .prob b{color:var(--text);font-weight:600;}
        .cs .panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
        .cs .ctrl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--surface2);}
        .cs .btn{font-family:var(--mono);font-size:12.5px;font-weight:600;padding:8px 13px;border-radius:7px;border:1px solid var(--border);background:var(--ground);color:var(--text);cursor:pointer;}
        .cs .btn:hover{border-color:var(--accent);}
        .cs .btn.primary{background:var(--accent);color:#1a1206;border-color:var(--accent);}
        .cs .btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft);}
        .cs .btn:disabled{opacity:.5;cursor:default;}
        .cs .spacer{flex:1;}
        .cs .stage{overflow-x:auto;padding:10px;}
        .cs svg{display:block;min-width:660px;width:100%;height:auto;}
        .cs .status{font-family:var(--mono);font-size:12.5px;color:var(--muted);padding:12px 16px;border-top:1px solid var(--border);min-height:44px;display:flex;align-items:center;gap:9px;}
        .cs .status .dot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex-shrink:0;}
        .cs .status.run .dot{background:var(--accent);box-shadow:0 0 8px var(--accent);}
        .cs .status.done .dot{background:var(--ok);box-shadow:0 0 8px var(--ok);}
        .cs .status.err .dot{background:var(--fail);box-shadow:0 0 8px var(--fail);}
        .cs .status b{color:var(--text);font-weight:600;}
        .cs .node rect{fill:var(--surface2);stroke:var(--border);stroke-width:1.5;transition:stroke .25s,fill .25s;}
        .cs .node .t{fill:var(--muted);font-family:var(--mono);font-size:13px;font-weight:600;transition:fill .25s;}
        .cs .node .s{fill:var(--dim);font-family:var(--mono);font-size:10.5px;}
        .cs .node.on rect{stroke:var(--accent);fill:#241a08;} .cs .node.on .t{fill:var(--text);}
        .cs .node.pulse rect{stroke:var(--info);fill:rgba(96,165,250,.12);}
        .cs .node.fail rect{stroke:var(--fail);fill:var(--fail-soft);} .cs .node.fail .t{fill:#ffd5d5;}
        .cs .edge{stroke:var(--border);stroke-width:2;fill:none;transition:stroke .2s,stroke-width .2s,opacity .2s;}
        .cs .edge.lit{stroke:var(--accent);stroke-width:3;}
        .cs .edge.litfail{stroke:var(--fail);stroke-width:3;}
        .cs .edge.dim{opacity:.22;}
        .cs .xedge{opacity:.22;}
        .cs .scale-only{opacity:0;transition:opacity .35s;} .cs.scaled .scale-only{opacity:1;}
        .cs #token,.cs #tokenB{fill:var(--accent);} .cs #token.tok-fail,.cs #tokenB.tok-fail{fill:var(--fail);}
        .cs #arw path{fill:var(--border);}
        .cs .scale-only rect{fill:var(--surface2);stroke:var(--border);} .cs .scale-only text{fill:var(--info);font-family:var(--mono);}
        .cs .dgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .cs details.dcard{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;}
        .cs details.dcard summary{list-style:none;cursor:pointer;padding:15px 16px;display:flex;align-items:center;gap:11px;font-weight:600;font-size:14.5px;}
        .cs details.dcard summary::-webkit-details-marker{display:none;}
        .cs .num{font-family:var(--mono);font-size:11px;color:var(--accent);border:1px solid var(--accent-soft);background:var(--accent-soft);border-radius:5px;padding:2px 7px;}
        .cs .caret{margin-left:auto;color:var(--muted);font-family:var(--mono);transition:transform .2s;}
        .cs details.dcard[open] .caret{transform:rotate(90deg);}
        .cs details .inner{padding:0 16px 16px;font-size:13.5px;}
        .cs .kv{display:flex;gap:9px;margin-top:9px;} .cs .kv .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);flex:0 0 78px;padding-top:2px;}
        .cs .kv.why .k{color:var(--accent);} .cs .kv .v{color:var(--muted);} .cs .kv.why .v{color:var(--text);}
        .cs ul.fu{list-style:none;display:flex;flex-direction:column;gap:10px;}
        .cs ul.fu li{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 15px 12px 40px;font-size:14px;color:var(--muted);position:relative;}
        .cs ul.fu li::before{content:"?";position:absolute;left:15px;top:12px;font-family:var(--mono);color:var(--accent);font-weight:700;}
        @media (max-width:640px){ .cs .dgrid{grid-template-columns:1fr;} }
      `}</style>

      <div className="tabs" role="tablist" aria-label="Case studies">
        {CASES.map((cc, i) => (
          <button key={cc.id} className="tab" role="tab" aria-selected={i === idx} onClick={() => switchCase(i)}>{cc.tab}</button>
        ))}
      </div>

      <h2 className="ch-title">{c.title}</h2>
      <p className="thesis">{c.thesis}</p>
      <div className="chips">
        {c.chips.map((ch) => <span key={ch} className={'chip' + (ch.startsWith('◆') ? ' real' : '')}>{ch.startsWith('◆') ? 'shipped in production' : ch}</span>)}
      </div>

      <p className="label">The problem</p>
      <div className="prob" dangerouslySetInnerHTML={{ __html: c.problem }} />

      <p className="label">Architecture — explore it</p>
      <div className={'panel' + (scaled ? ' scaled' : '')}>
        <div className="ctrl">
          <button className="btn primary" onClick={run} disabled={running}>▶ Trace a request</button>
          <button className="btn" aria-pressed={scaled} onClick={toggleScale}>{c.scaleLabel}</button>
          <button className="btn" aria-pressed={failing} onClick={toggleFail}>{c.failLabel}</button>
        </div>
        <div className="stage">
          <svg key={c.id} viewBox="0 0 940 400" role="img" aria-label={`${c.title} architecture diagram`}>
            <defs><marker id="arw" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" /></marker></defs>
            {allEdges.map((e) => {
              const a = clip(c.nodes[e.from], center(c.nodes[e.to]));
              const b = clip(c.nodes[e.to], center(c.nodes[e.from]));
              const isExtra = (c.extraEdges ?? []).some((x) => x.id === e.id);
              return <path key={e.id} id={'e_' + e.id} className={'edge' + (isExtra ? ' xedge' : '')} d={`M${a[0]},${a[1]} L${b[0]},${b[1]}`} markerEnd="url(#arw)" />;
            })}
            {c.scale.ghosts?.map((g, i) => (
              <g className="scale-only" key={'g' + i}><rect x={g.x} y={g.y} width={g.w} height={g.h} rx="8" opacity={g.opacity} /></g>
            ))}
            {c.scale.annotation && (
              <g className="scale-only"><text x={c.scale.annotation.x} y={c.scale.annotation.y} textAnchor="middle" fontSize="11">{c.scale.annotation.text}</text></g>
            )}
            {Object.entries(c.nodes).map(([k, n]) => (
              <g className="node" id={'n_' + k} key={k}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" />
                <text className="t" x={n.x + n.w / 2} y={n.y + n.h * 0.44} textAnchor="middle">{n.title}</text>
                <text className="s" x={n.x + n.w / 2} y={n.y + n.h * 0.74} textAnchor="middle">{n.sub}</text>
              </g>
            ))}
            <circle id="token" r="6.5" opacity="0" />
            <circle id="tokenB" r="6.5" opacity="0" />
          </svg>
        </div>
        <div className={'status ' + status.cls}><span className="dot" /><span dangerouslySetInnerHTML={{ __html: status.html }} /></div>
      </div>

      <p className="label">Key decisions &amp; tradeoffs</p>
      <div className="dgrid">
        {c.decisions.map((d, i) => (
          <details className="dcard" key={c.id + i}>
            <summary><span className="num">{i + 1}</span>{d.t}<span className="caret">›</span></summary>
            <div className="inner">
              <div className="kv"><span className="k">Decision</span><span className="v">{d.d}</span></div>
              <div className="kv"><span className="k">Instead of</span><span className="v">{d.a}</span></div>
              <div className="kv why"><span className="k">Why</span><span className="v">{d.w}</span></div>
            </div>
          </details>
        ))}
      </div>

      <p className="label">Questions an interviewer would probe</p>
      <ul className="fu">{c.followups.map((f, i) => <li key={i}>{f}</li>)}</ul>
    </div>
  );
}
