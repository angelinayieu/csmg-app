/* global React, Ic */
const { useState: useSp, useEffect: useEpSp, useRef: useRefSp } = React;

/* ══════════════════════════════════════════════════════════════
   DIGITAL TWIN — top-down command tree
   Agent C → Prompt → Quality → {Novelty, Utility} → Labs → Agents A/B
   ══════════════════════════════════════════════════════════════ */
function DigitalTwin() {
  // Nodes on a 100×100 viewBox. Careful vertical lanes so nothing overlaps.
  const nodes = {
    // Row 1 — controller
    agentC:  { x: 50, y: 8,  type: "agent",   letter: "C", role: "Controller" },
    // Row 2 — prompt spec
    prompt:  { x: 50, y: 25, type: "art",     title: "Prompt Design",       sub: "v4.2 · 2,840 tok", primary: true },
    // Row 3 — quality tracking (the fork point)
    quality: { x: 50, y: 42, type: "art",     title: "Quality Tracking",    sub: "0.83 · 6 axes" },
    // Row 4 — two measurement criteria
    novel:   { x: 26, y: 58, type: "metric",  title: "Novel insights",      sub: "+18 this run" },
    utility: { x: 74, y: 58, type: "metric",  title: "Utility & Impact",    sub: "0.76 score" },
    // Row 5 — criteria labs (agent's workshop)
    novelLab:{ x: 26, y: 75, type: "lab",     title: "Novelty Lab",         sub: "tests divergence" },
    scoreLab:{ x: 74, y: 75, type: "lab",     title: "Score Lab",           sub: "tests fit" },
    // Row 6 — agents
    agentA:  { x: 26, y: 92, type: "agent",   letter: "A", role: "Explorer" },
    agentB:  { x: 74, y: 92, type: "agent",   letter: "B", role: "Scorer" },
  };

  const edges = [
    { from: "agentC",   to: "prompt"  },
    { from: "prompt",   to: "quality" },
    { from: "quality",  to: "novel"   },
    { from: "quality",  to: "utility" },
    { from: "novel",    to: "novelLab", upward: true },
    { from: "utility",  to: "scoreLab", upward: true },
    { from: "novelLab", to: "agentA",   upward: true },
    { from: "scoreLab", to: "agentB",   upward: true },
  ];

  // Animate one pulsing packet traveling down the tree (command flow)
  // and a separate one traveling up the two side branches (measurement signal).
  const [tick, setTick] = useSp(0);
  useEpSp(() => {
    let raf;
    const loop = () => { setTick(t => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function edgePath(e) {
    const a = nodes[e.from], b = nodes[e.to];
    // curves on the fork (quality → novel / utility), straight vertical otherwise
    if (Math.abs(a.x - b.x) > 4) {
      const mx = (a.x + b.x) / 2;
      return `M ${a.x} ${a.y} C ${a.x} ${a.y + (b.y - a.y) * 0.55}, ${b.x} ${a.y + (b.y - a.y) * 0.55}, ${b.x} ${b.y}`;
    }
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  // time-along-path helper for pulse particles
  const t = (tick * 0.012) % 1;

  return (
    <div className="dt-wrap">
      <div className="dt-legend">
        <span className="dt-leg"><i className="dt-leg-dot controller"/>Controller</span>
        <span className="dt-leg"><i className="dt-leg-dot art"/>Artifact</span>
        <span className="dt-leg"><i className="dt-leg-dot metric"/>Criterion</span>
        <span className="dt-leg"><i className="dt-leg-dot agent-exec"/>Executing agent</span>
        <span className="dt-loop-note">top-down command · bottom-up signal</span>
      </div>

      <div className="dt-stage">
        <svg className="dt-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <marker id="dt-arr-down" viewBox="0 0 10 10" refX="7" refY="5"
                    markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#0a5ad4"/>
            </marker>
            <marker id="dt-arr-up" viewBox="0 0 10 10" refX="7" refY="5"
                    markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#65c9e0"/>
            </marker>
          </defs>
          {edges.map((e, i) => {
            const up = e.upward;
            return (
              <path key={i}
                    d={edgePath(e)}
                    fill="none"
                    stroke={up ? "rgba(101,201,224,0.7)" : "rgba(10,90,212,0.58)"}
                    strokeWidth="0.42"
                    strokeDasharray={up ? "1.4,0.8" : "0"}
                    markerEnd={up ? "url(#dt-arr-up)" : "url(#dt-arr-down)"}
                    vectorEffect="non-scaling-stroke"/>
            );
          })}
          {/* command pulses — flowing DOWN the main spine */}
          {edges.filter(e => !e.upward).map((e, i) => {
            const offset = (t + i * 0.2) % 1;
            return (
              <circle key={"pd"+i} r="0.8" fill="#0a5ad4" opacity={0.85}>
                <animateMotion dur="5s" repeatCount="indefinite" path={edgePath(e)} keyPoints="0;1" keyTimes="0;1"/>
              </circle>
            );
          })}
        </svg>

        {Object.entries(nodes).map(([id, n]) => {
          if (n.type === "agent") {
            const isExec = id === "agentA" || id === "agentB";
            return (
              <div key={id} className={"dt-node dt-agent" + (isExec ? " exec" : " ctrl")}
                   style={{ left: n.x + "%", top: n.y + "%" }}>
                <div className="dt-agent-disc">{n.letter}</div>
                <div className="dt-agent-name">Agent {n.letter}</div>
                <div className="dt-agent-role">{n.role}</div>
              </div>
            );
          }
          return (
            <div key={id} className={"dt-node dt-art dt-" + n.type + (n.primary ? " primary" : "")}
                 style={{ left: n.x + "%", top: n.y + "%" }}>
              <div className="dt-art-title">{n.title}</div>
              <div className="dt-art-sub">{n.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   HOLOGRAPHIC OSCILLOSCOPE — agent quality readout with bloom
   ══════════════════════════════════════════════════════════════ */
function AgentChart({ series, target=0.82, color="#1a7aff", baseline, gid }) {
  const W=260, H=104;
  const padL=28, padR=10, padT=12, padB=22;
  const pw = W - padL - padR, ph = H - padT - padB;
  const iters = series.length;
  const x = (i) => padL + (i/(iters-1)) * pw;
  const y = (v) => padT + (1-v) * ph;
  const mainPts = series.map((v,i) => [x(i), y(v)]);
  const basePts = baseline ? baseline.map((v,i) => [x(i), y(v)]) : null;
  const toP = (pts) => pts.map((p,i) => (i?"L":"M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const fillD = toP(mainPts) + ` L ${x(iters-1)} ${y(0)} L ${x(0)} ${y(0)} Z`;
  const last = mainPts[mainPts.length-1];

  // pulse animation
  const [tk, setTk] = useSp(0);
  useEpSp(() => {
    let r; const loop = () => { setTk(t => t+1); r = requestAnimationFrame(loop); };
    r = requestAnimationFrame(loop); return () => cancelAnimationFrame(r);
  }, []);
  const pulse = 3 + 2 * Math.sin(tk * 0.07);

  return (
    <svg className="agent-chart" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.42"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
        <filter id={gid+"-bloom"} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.2"/>
        </filter>
        <linearGradient id={gid+"-line"} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.4"/>
          <stop offset="100%" stopColor={color} stopOpacity="1"/>
        </linearGradient>
      </defs>

      {/* grid — fades from center */}
      {[0,0.25,0.5,0.75,1].map(tv => (
        <line key={tv} x1={padL} x2={W-padR} y1={y(tv)} y2={y(tv)}
          stroke="rgba(120,140,180,0.18)" strokeWidth="0.4"
          strokeDasharray={tv===0 ? "" : "2 3"}/>
      ))}
      {[0,0.25,0.5,0.75,1].map(tv => (
        <text key={"t"+tv} x={padL-5} y={y(tv)+2.5} textAnchor="end" fontSize="7" fill="#a6b0c0">{tv.toFixed(1)}</text>
      ))}

      {/* target */}
      <line x1={padL} x2={W-padR} y1={y(target)} y2={y(target)}
        stroke="#10b981" strokeWidth="0.7" strokeDasharray="3 2" opacity="0.55"/>
      <text x={W-padR-2} y={y(target)-3} textAnchor="end" fontSize="6.5" fill="#10b981" fontWeight="700">target {target}</text>

      {/* baseline */}
      {basePts && <path d={toP(basePts)} fill="none" stroke="#a6b0c0" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.55"/>}

      {/* fill */}
      <path d={fillD} fill={`url(#${gid})`}/>

      {/* bloom halo (behind line) */}
      <path d={toP(mainPts)} fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" filter={`url(#${gid}-bloom)`}/>
      {/* main line */}
      <path d={toP(mainPts)} fill="none" stroke={`url(#${gid}-line)`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>

      {/* pulsing endpoint */}
      <circle cx={last[0]} cy={last[1]} r={pulse} fill={color} opacity="0.18"/>
      <circle cx={last[0]} cy={last[1]} r="2.4" fill="white" stroke={color} strokeWidth="1.6"/>
      <text x={last[0]-4} y={last[1]-5} textAnchor="end" fontSize="8" fontWeight="700" fill={color}>
        {series[series.length-1].toFixed(2)}
      </text>

      <text x={(padL+W-padR)/2} y={H-5} textAnchor="middle" fontSize="7" fill="#7a8698">iteration · 1 → {iters}</text>
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
   POTENTIAL-SURFACE PHASE DIAGRAM — isobars + comet trajectory
   ══════════════════════════════════════════════════════════════ */
function PhaseDiagram() {
  const W = 380, H = 240;
  const padL = 34, padR = 14, padT = 18, padB = 34;
  const pw = W - padL - padR, ph = H - padT - padB;
  const X = (e) => padL + e * pw;
  const Y = (s) => padT + (1-s) * ph;

  // trajectory
  const traj = [
    [0.15, 0.92],[0.22, 0.80],[0.32, 0.70],[0.42, 0.62],
    [0.50, 0.58],[0.58, 0.54],[0.62, 0.52],
  ];
  const trajD = traj.map((p,i) => (i?"L":"M") + X(p[0]) + " " + Y(p[1])).join(" ");
  const crit = [0.62, 0.52];

  // potential field — quality(e,s) is higher near optimal center (0.6, 0.5)
  // draw topographic rings as concentric curves
  const cx = 0.6, cy = 0.5;
  const rings = [0.10, 0.18, 0.28, 0.40, 0.52];

  // animate comet
  const [tk, setTk] = useSp(0);
  useEpSp(() => {
    let r; const loop = () => { setTk(t => t+1); r = requestAnimationFrame(loop); };
    r = requestAnimationFrame(loop); return () => cancelAnimationFrame(r);
  }, []);
  const cometIdx = (tk * 0.04) % traj.length;
  const ci = Math.floor(cometIdx);
  const cf = cometIdx - ci;
  const nextI = (ci+1) % traj.length;
  const cx_ = traj[ci][0] + (traj[nextI][0]-traj[ci][0]) * cf;
  const cy_ = traj[ci][1] + (traj[nextI][1]-traj[ci][1]) * cf;

  return (
    <svg className="phase-svg" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <radialGradient id="pd-core" cx={`${cx*100}%`} cy={`${(1-cy)*100}%`} r="55%">
          <stop offset="0%"  stopColor="#c4f5d4" stopOpacity="0.9"/>
          <stop offset="55%" stopColor="#a5e6b8" stopOpacity="0.55"/>
          <stop offset="100%" stopColor="#7dcf94" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="pd-bgtop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe3d4" stopOpacity="0.75"/>
          <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="pd-bgbot" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#dfe8f5" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
        <filter id="comet-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
      </defs>

      {/* hazard gradients (regions) */}
      <rect x={padL} y={padT} width={pw} height={ph/2} fill="url(#pd-bgtop)"/>
      <rect x={padL} y={padT+ph/2} width={pw} height={ph/2} fill="url(#pd-bgbot)"/>
      {/* core glow */}
      <rect x={padL} y={padT} width={pw} height={ph} fill="url(#pd-core)"/>

      {/* grid */}
      {[0,0.25,0.5,0.75,1].map(tv => (
        <g key={tv}>
          <line x1={X(tv)} x2={X(tv)} y1={padT} y2={H-padB} stroke="rgba(120,140,180,0.13)" strokeWidth="0.4"/>
          <line x1={padL} x2={W-padR} y1={Y(tv)} y2={Y(tv)} stroke="rgba(120,140,180,0.13)" strokeWidth="0.4"/>
        </g>
      ))}

      {/* topographic rings — drawn as ellipses around (cx, cy) */}
      {rings.map((r,i) => {
        const rxp = r * pw;
        const ryp = r * ph * 0.85;
        return (
          <ellipse key={i} cx={X(cx)} cy={Y(cy)} rx={rxp} ry={ryp}
            fill="none" stroke="#1a5a2e"
            strokeWidth="0.6" strokeDasharray={i===0?"":"3 3"}
            opacity={0.55 - i*0.08} vectorEffect="non-scaling-stroke"/>
        );
      })}

      {/* region labels — OUTSIDE the plot area */}
      <text x={padL+4} y={padT+12} fontSize="9.5" fontWeight="700" fill="#8a3a10">◆ Under-constrained</text>
      <text x={padL+4} y={padT+22} fontSize="7" fill="#8a3a10" opacity="0.8">hallucinates · drifts</text>

      <text x={W-padR-4} y={H-padB-16} fontSize="9.5" fontWeight="700" fill="#2a4a70" textAnchor="end">Over-constrained ◆</text>
      <text x={W-padR-4} y={H-padB-6} fontSize="7" fill="#2a4a70" opacity="0.8" textAnchor="end">brittle · shallow</text>

      <text x={X(cx)} y={Y(cy)-ph*0.11} fontSize="10" fontWeight="800" fill="#1a5a2e" textAnchor="middle">Optimal Regime</text>

      {/* trajectory */}
      <path d={trajD} fill="none" stroke="#1a7aff" strokeWidth="1.3" strokeDasharray="3 2" opacity="0.85"/>
      {traj.slice(0,-1).map((p,i) => (
        <circle key={i} cx={X(p[0])} cy={Y(p[1])} r="1.6" fill="#1a7aff" opacity={0.2 + i*0.09}/>
      ))}
      {/* current position — static anchor */}
      <circle cx={X(traj[traj.length-1][0])} cy={Y(traj[traj.length-1][1])} r="6" fill="#1a7aff" opacity="0.18"/>
      <circle cx={X(traj[traj.length-1][0])} cy={Y(traj[traj.length-1][1])} r="3" fill="#1a7aff" stroke="white" strokeWidth="1.6"/>
      <text x={X(traj[traj.length-1][0])+7} y={Y(traj[traj.length-1][1])-5} fontSize="8" fontWeight="700" fill="#0a4a99">v4.2</text>

      {/* comet head */}
      <circle cx={X(cx_)} cy={Y(cy_)} r="5" fill="#1a7aff" opacity="0.7" filter="url(#comet-glow)"/>
      <circle cx={X(cx_)} cy={Y(cy_)} r="1.8" fill="white"/>

      {/* critical point */}
      <circle cx={X(crit[0])+24} cy={Y(crit[1])-22} r="3.2" fill="none" stroke="#ef4444" strokeWidth="1"/>
      <circle cx={X(crit[0])+24} cy={Y(crit[1])-22} r="1.2" fill="#ef4444"/>
      <line x1={X(crit[0])+3} y1={Y(crit[1])-3} x2={X(crit[0])+22} y2={Y(crit[1])-20} stroke="#ef4444" strokeWidth="0.6" strokeDasharray="1.5 1.5" opacity="0.7"/>
      <text x={X(crit[0])+30} y={Y(crit[1])-19} fontSize="8" fontWeight="700" fill="#ef4444">critical point</text>
      <text x={X(crit[0])+30} y={Y(crit[1])-10} fontSize="6.5" fill="#8a2020">outputs crystallize</text>

      {/* axes */}
      <line x1={padL} x2={W-padR} y1={H-padB} y2={H-padB} stroke="#0a1020" strokeWidth="0.8"/>
      <line x1={padL} x2={padL}   y1={padT}   y2={H-padB} stroke="#0a1020" strokeWidth="0.8"/>

      <text x={(padL+W-padR)/2} y={H-10} textAnchor="middle" fontSize="8" fontWeight="600" fill="#40506a">
        Exploration (temperature · sampling breadth) →
      </text>
      <text x={12} y={(padT+H-padB)/2} fontSize="8" fontWeight="600" fill="#40506a"
        transform={`rotate(-90 12 ${(padT+H-padB)/2})`} textAnchor="middle">
        Specificity (constraints) →
      </text>

      <text x={X(0)} y={H-padB+11} textAnchor="middle" fontSize="6.5" fill="#7a8698">low</text>
      <text x={X(1)} y={H-padB+11} textAnchor="middle" fontSize="6.5" fill="#7a8698">high</text>
      <text x={padL-4} y={Y(0)+3} textAnchor="end" fontSize="6.5" fill="#7a8698">low</text>
      <text x={padL-4} y={Y(1)+3} textAnchor="end" fontSize="6.5" fill="#7a8698">high</text>
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
   APP BRAND GLYPHS
   ══════════════════════════════════════════════════════════════ */
const AppGlyph = {
  gmail: () => (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M2 6.5L12 13l10-6.5v11a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 17.5V6.5z" fill="#fff"/>
      <path d="M2 6.5L12 13l10-6.5A1.5 1.5 0 0 0 20.5 5h-17A1.5 1.5 0 0 0 2 6.5z" fill="#ea4335"/>
      <path d="M12 13L2 6.5V17.5A1.5 1.5 0 0 0 3.5 19H8V11.5L12 13z" fill="#4285f4"/>
      <path d="M12 13l10-6.5V17.5A1.5 1.5 0 0 1 20.5 19H16V11.5L12 13z" fill="#34a853"/>
      <path d="M8 11.5V19h8v-7.5L12 13l-4-1.5z" fill="#fbbc04"/>
    </svg>
  ),
  arxiv: () => (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <rect width="24" height="24" rx="5" fill="#b31b1b"/>
      <text x="12" y="16" textAnchor="middle" fontFamily="serif" fontSize="10" fontWeight="700" fill="#fff" fontStyle="italic">χiv</text>
    </svg>
  ),
  slack: () => (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <rect width="24" height="24" rx="5" fill="#fff"/>
      <path d="M8.5 15a1.5 1.5 0 1 1-1.5-1.5h1.5V15z" fill="#e01e5a"/>
      <path d="M9 15a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0v-3z" fill="#e01e5a"/>
      <path d="M10.5 9a1.5 1.5 0 1 1 1.5-1.5V9h-1.5z" fill="#36c5f0"/>
      <path d="M9 9a1.5 1.5 0 0 1 0-3h3a1.5 1.5 0 0 1 0 3H9z" fill="#36c5f0"/>
      <path d="M15 10.5a1.5 1.5 0 1 1 1.5 1.5H15v-1.5z" fill="#2eb67d"/>
      <path d="M13.5 10.5a1.5 1.5 0 0 1-3 0v-3a1.5 1.5 0 0 1 3 0v3z" fill="#2eb67d"/>
      <path d="M13.5 15a1.5 1.5 0 1 1-1.5 1.5V15h1.5z" fill="#ecb22e"/>
      <path d="M15 13.5a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 1 0-3h3z" fill="#ecb22e"/>
    </svg>
  ),
  notion: () => (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <rect width="24" height="24" rx="5" fill="#fff" stroke="#e5e7eb"/>
      <path d="M7 6l10-.7v13.4L7 17.6V6z" fill="none" stroke="#0a1020" strokeWidth="1.2"/>
      <path d="M9 8.5v8l6 .5V9.5L9 8.5zM9.5 8.8l5.2 8.3" stroke="#0a1020" strokeWidth="1" fill="none"/>
    </svg>
  ),
};

/* ══════════════════════════════════════════════════════════════
   CHECK-IN PANEL
   ══════════════════════════════════════════════════════════════ */
const CHECKIN_APPS = [
  {
    id: "gmail", name: "Gmail", Glyph: AppGlyph.gmail,
    count: 3, summary: <><b>3 new messages</b> needing approval</>,
    items: [
      { t: "reviewer@mit.edu", s: "Re: v4.2 prompt draft — approve tone shift?", time: "14m" },
      { t: "legal@acme.co",    s: "Disclosure language for benchmark release",     time: "2h"  },
      { t: "claire@interaxis", s: "Weekly digest — approve before send",            time: "6h"  },
    ],
  },
  {
    id: "arxiv", name: "arXiv", Glyph: AppGlyph.arxiv,
    count: 6, summary: <><b>6 new research proposals</b> matched your objective</>,
    items: [
      { t: "2604.18219", s: "Constraint-induced collapse in chain-of-thought prompts", time: "1d" },
      { t: "2604.17845", s: "Temperature scheduling for compositional reasoning",       time: "1d" },
      { t: "2604.17112", s: "Density-aware decoding: a survey",                         time: "2d" },
    ],
  },
  {
    id: "slack", name: "Slack", Glyph: AppGlyph.slack,
    count: 4, summary: <><b>4 new combination proposals</b> from #prompt-lab</>,
    items: [
      { t: "#prompt-lab · Ryo",   s: "Combine v3.8 depth prior with v4.1 temp schedule", time: "32m" },
      { t: "#prompt-lab · Marek", s: "Swap the novelty weighting term",                  time: "1h"  },
      { t: "#prompt-lab · Jenny", s: "What if we seed with last week's winners?",        time: "3h"  },
    ],
  },
  {
    id: "notion", name: "Notion", Glyph: AppGlyph.notion,
    count: 5, summary: <><b>5 drafts prepared</b> — ready for review</>,
    items: [
      { t: "Draft · v4.3 spec",        s: "Ultimate-goal anchor + density regulator", time: "20m" },
      { t: "Draft · eval harness",     s: "Add utility-score breakdown per rubric",    time: "1h"  },
      { t: "Draft · stakeholder memo", s: "Summarize critical-point reasoning",        time: "2h"  },
    ],
  },
];

function CheckinPanel() {
  const [open, setOpen] = useSp("arxiv");
  return (
    <div className="panel glass-panel">
      <div className="panel-head">
        <div className="panel-title">Check-in Updates</div>
        <div className="panel-more">14 · ranked</div>
      </div>
      <div className="ci-intro">
        <div className="ci-intro-text">
          Actionable outputs from connected apps,<br/>
          ranked for <b>Decomposition Prompt Optimization</b>
        </div>
        <span className="ci-live"><span className="ci-live-dot"/>LIVE</span>
      </div>

      <div className="ci-apps">
        {CHECKIN_APPS.map(app => {
          const Glyph = app.Glyph;
          const isOpen = open === app.id;
          return (
            <div key={app.id}
                 className={"ci-app" + (isOpen ? " open" : "")}
                 onClick={() => !isOpen && setOpen(app.id)}>
              <div className="ci-app-head" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : app.id); }}>
                <div className="ci-app-glyph"><Glyph/></div>
                <div className="ci-app-meta">
                  <div className="ci-app-name">{app.name}</div>
                  <div className="ci-app-count">{app.count} items</div>
                </div>
                <div className="ci-app-chev" aria-hidden>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </div>

              {isOpen && (
                <div className="ci-app-body">
                  <div className="ci-app-summary">{app.summary}</div>
                  <div className="ci-app-items">
                    {app.items.map((it, i) => (
                      <div key={i} className="ci-item">
                        <div className="ci-item-row">
                          <div className="ci-item-title">{it.t}</div>
                          <div className="ci-item-time">{it.time}</div>
                        </div>
                        <div className="ci-item-sub">{it.s}</div>
                        <div className="ci-item-acts">
                          <button className="ci-act primary" onClick={(e)=>e.stopPropagation()}>Approve</button>
                          <button className="ci-act" onClick={(e)=>e.stopPropagation()}>Dismiss</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="ci-see-all" onClick={(e)=>e.stopPropagation()}>See all {app.count} in {app.name} →</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TwinPanel() {
  return (
    <div className="panel glass-panel elevated">
      <div className="panel-head">
        <div className="panel-title">Experiment Digital Twin</div>
        <div className="panel-more">v4.2 · running</div>
      </div>
      <DigitalTwin/>
      <div className="twin-foot">
        <div className="tf-stat"><div className="tf-v">12</div><div className="tf-l">iterations</div></div>
        <div className="tf-stat"><div className="tf-v">0.84</div><div className="tf-l">best quality</div></div>
        <div className="tf-stat"><div className="tf-v">+0.20</div><div className="tf-l">lift this run</div></div>
        <div className="tf-stat"><div className="tf-v">~4</div><div className="tf-l">iters to target</div></div>
      </div>
    </div>
  );
}

const AGENT_A_SERIES   = [0.28, 0.34, 0.41, 0.48, 0.54, 0.59, 0.64, 0.68, 0.71, 0.74, 0.76, 0.78];
const AGENT_A_BASELINE = [0.28, 0.30, 0.34, 0.38, 0.42, 0.45, 0.48, 0.50, 0.52, 0.54, 0.55, 0.56];
const AGENT_B_SERIES   = [0.32, 0.42, 0.55, 0.65, 0.72, 0.77, 0.80, 0.82, 0.83, 0.84, 0.84, 0.84];
const AGENT_B_BASELINE = [0.32, 0.36, 0.41, 0.46, 0.50, 0.54, 0.58, 0.60, 0.62, 0.63, 0.64, 0.64];

function PerfPanel() {
  return (
    <div className="panel glass-panel">
      <div className="panel-head">
        <div className="panel-title">Optimization Performance</div>
        <div className="panel-more">A/B · 12 iters</div>
      </div>
      <div className="agent-row">
        <div className="agent-card">
          <div className="agent-card-head">
            <span className="agent-chip"><span className="dot"/>Agent A <span className="ag-role">Explorer</span></span>
            <span className="ag-delta up">+0.22</span>
          </div>
          <AgentChart series={AGENT_A_SERIES} baseline={AGENT_A_BASELINE} target={0.82} color="#1a7aff" gid="ag-a"/>
          <div className="agent-meta">
            <div>
              <div className="big">0.78<span className="unit"> quality</span></div>
              <div className="meta-sub">depth <b>3.9</b> · density <b>0.71</b></div>
            </div>
          </div>
        </div>
        <div className="agent-card">
          <div className="agent-card-head">
            <span className="agent-chip alt"><span className="dot"/>Agent B <span className="ag-role">Scorer</span></span>
            <span className="ag-delta up">+0.20</span>
          </div>
          <AgentChart series={AGENT_B_SERIES} baseline={AGENT_B_BASELINE} target={0.82} color="#0a6aee" gid="ag-b"/>
          <div className="agent-meta">
            <div>
              <div className="big">0.84<span className="unit"> quality</span></div>
              <div className="meta-sub">depth <b>4.3</b> · density <b>0.79</b></div>
            </div>
          </div>
        </div>
      </div>

      <div className="phase-head">
        <div className="phase-title">Phase Diagram — Prompt Optimization Landscape</div>
        <div className="phase-legend">
          <span className="pl-dot" style={{background:"#1a7aff"}}/>trajectory
          <span className="pl-dot" style={{background:"#ef4444", marginLeft:10}}/>critical
        </div>
      </div>
      <div className="phase-diagram"><PhaseDiagram/></div>
    </div>
  );
}

Object.assign(window, { CheckinPanel, TwinPanel, PerfPanel });
