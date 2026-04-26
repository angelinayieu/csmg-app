/* global React, Ic */
const { useState: useSec, useEffect: useESec } = React;

/* ══════════════════════════════════════════════════════════════
   TITLE BANNER — project identity (replaces notif pill)
   ══════════════════════════════════════════════════════════════ */
function TitleBanner() {
  return (
    <div className="title-banner">
      <div className="tb-glyph">IX</div>
      <div style={{minWidth:0, flex:1}}>
        <div className="tb-crumb">
          <span>Interaxis</span>
          <span className="sep">/</span>
          <span>Projects</span>
          <span className="sep">/</span>
          <span className="cb">Decomposition Prompt</span>
        </div>
        <div className="tb-name">Decomposition Prompt Optimization</div>
        <div className="tb-meta-row">
          <span className="live">LIVE</span>
          <span className="dot"/>
          <span>v4.2 · iter 12/16</span>
          <span className="dot"/>
          <span>updated 12m ago</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SIDE POPUP NOTIFICATION (dismissable)
   ══════════════════════════════════════════════════════════════ */
function SideNotif() {
  const [dismissed, setDismissed] = useSec(false);
  const [hidden, setHidden] = useSec(false);
  if (hidden) return null;
  return (
    <div className={"side-notif" + (dismissed ? " dismissed" : "")}
         onAnimationEnd={(e) => { if (dismissed && e.animationName === "notifOut") setHidden(true); }}>
      <div className="sn-ico"><Ic.box width="18" height="18"/></div>
      <div className="sn-body">
        <div className="sn-kicker">NEW · 6 min ago</div>
        <div className="sn-title">Acme Research released a new decomposition dataset</div>
        <div className="sn-sub">
          <b>12 prompt proposals</b> match your active objective. Review before tonight's run.
        </div>
        <div className="sn-acts">
          <button className="sn-act primary">Review</button>
          <button className="sn-act" onClick={() => setDismissed(true)}>Later</button>
        </div>
      </div>
      <button className="sn-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SECTION DIVIDER
   ══════════════════════════════════════════════════════════════ */
function SectionDivider({ num, title, sub }) {
  return (
    <div className="section-divider">
      <div className="sd-num">{num}</div>
      <div>
        <div className="sd-title">{title}</div>
        {sub && <div className="sd-sub">{sub}</div>}
      </div>
      <div className="sd-line"/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MACRO OBJECTIVE TREE — decomposable nodes
   ══════════════════════════════════════════════════════════════ */
const TREE_DATA = {
  id: "root",
  kind: "root",
  kicker: "ULTIMATE",
  title: "Raise analysis quality to 0.90",
  stat: "0.83 → 0.90",
  delta: "+0.07",
  progress: 0.68,
  children: [
    {
      id: "soph", kind: "branch",
      kicker: "BRANCH · S1",
      title: "Enhance sophistication",
      stat: "3.9 → 4.8",
      delta: "+0.9",
      progress: 0.58,
      children: [
        { id: "s-depth",  kind: "leaf", kicker: "LEAF", title: "Depth-of-reasoning rubric", stat: "4.3", delta: "+0.4", progress: 0.72 },
        { id: "s-vocab",  kind: "leaf", kicker: "LEAF", title: "Domain vocabulary adapter",  stat: "0.71", delta: "+0.08", progress: 0.60 },
      ],
    },
    {
      id: "dens", kind: "branch",
      kicker: "BRANCH · D1",
      title: "Increase density",
      stat: "0.71 → 0.85",
      delta: "+0.14",
      progress: 0.46,
      children: [
        { id: "d-comp",  kind: "leaf", kicker: "LEAF", title: "Compression prior",        stat: "0.79", delta: "+0.08", progress: 0.64 },
        { id: "d-decl",  kind: "leaf", kicker: "LEAF", title: "Declarative framing",      stat: "0.62", delta: "+0.05", progress: 0.32 },
      ],
    },
    {
      id: "depth", kind: "branch",
      kicker: "BRANCH · X1",
      title: "Extend depth",
      stat: "3.9 → 5.0",
      delta: "+1.1",
      progress: 0.34,
      children: [
        { id: "x-chain", kind: "leaf", kicker: "LEAF", title: "Chain-of-thought anchor", stat: "4.8", delta: "+0.5", progress: 0.48 },
        { id: "x-crit",  kind: "leaf", kicker: "LEAF", title: "Self-critique pass",      stat: "0.66", delta: "-0.02", neg: true, progress: 0.18 },
      ],
    },
  ],
};

function MacroTree() {
  const [expanded, setExpanded] = useSec({ root: true, soph: true, dens: true, depth: false });
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  // Layout: root at top, branches row 2, leaves row 3 under their branch.
  // Compute using percentages.
  const W = 100;
  const rootX = 50, rootY = 12;
  const branches = TREE_DATA.children;
  const bY = 44;
  const leafY = 80;

  // horizontal positions for branches
  const bCount = branches.length;
  const positions = {};
  positions["root"] = { x: rootX, y: rootY };
  branches.forEach((b, bi) => {
    const bx = ((bi + 0.5) / bCount) * W;
    positions[b.id] = { x: bx, y: bY };
    const open = expanded[b.id];
    if (open && b.children) {
      b.children.forEach((c, ci) => {
        const spread = 18;
        const span = (b.children.length - 1) * spread;
        const lx = bx - span/2 + ci * spread;
        positions[c.id] = { x: lx, y: leafY };
      });
    }
  });

  // Build edge pairs
  const edges = [];
  branches.forEach(b => {
    edges.push([positions["root"], positions[b.id]]);
    if (expanded[b.id] && b.children) {
      b.children.forEach(c => {
        edges.push([positions[b.id], positions[c.id]]);
      });
    }
  });

  const renderNode = (n, pos) => {
    const canExpand = n.children && n.children.length > 0;
    const open = expanded[n.id];
    return (
      <div key={n.id}
           className={"mot-node " + n.kind + (open && canExpand ? " expanded" : "")}
           style={{ left: pos.x + "%", top: pos.y + "%" }}
           onClick={() => canExpand && toggle(n.id)}>
        <div className="mot-node-kicker">
          <span>{n.kicker}</span>
          {canExpand && <span className="pill">{n.children.length}</span>}
        </div>
        <div className="mot-node-title">{n.title}</div>
        <div className="mot-node-stat">
          <span>{n.stat}</span>
          {n.delta && <span className={"delta" + (n.neg ? " neg" : "")}>{n.delta}</span>}
        </div>
        <div className="mot-progress"><div className="bar" style={{width: (n.progress*100).toFixed(0) + "%"}}/></div>
        {canExpand && (
          <div className="mot-node-expand">{open ? "−" : "+"}</div>
        )}
      </div>
    );
  };

  return (
    <div className="mot-wrap">
      <div className="mot-head">
        <div className="mot-title">Macro Objective Tree</div>
        <div className="mot-meta">
          <span>3 branches · 6 leaves · 68% on track</span>
          <div className="mot-tabs">
            <button className="on">Tree</button>
            <button>List</button>
            <button>Sankey</button>
          </div>
        </div>
      </div>
      <div className="mot-tree">
        <svg className="mot-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="mot-edge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a7aff" stopOpacity="0.55"/>
              <stop offset="100%" stopColor="#65d4e8" stopOpacity="0.5"/>
            </linearGradient>
          </defs>
          {edges.map(([a,b], i) => {
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const d = `M ${a.x} ${a.y+3} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y-3}`;
            return (
              <path key={i} d={d} fill="none" stroke="url(#mot-edge)"
                strokeWidth="0.35" vectorEffect="non-scaling-stroke"/>
            );
          })}
        </svg>
        {renderNode(TREE_DATA, positions["root"])}
        {branches.map(b => renderNode(b, positions[b.id]))}
        {branches.flatMap(b => expanded[b.id] && b.children ? b.children.map(c => renderNode(c, positions[c.id])) : [])}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DECOMPOSED PROMPT VIZ — token-tinted prompt + property cards
   ══════════════════════════════════════════════════════════════ */
function Sparkline({ data, color }) {
  const W = 80, H = 20;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [i / (data.length-1) * W, H - ((v-min)/range) * H]);
  const d = pts.map((p,i) => (i?"L":"M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return (
    <svg className="dpv-card-spark" viewBox={`0 0 ${W} ${H}`} width="100%" height="20">
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="1.3" fill={color}/>
    </svg>
  );
}

function DecomposedPromptViz() {
  const cards = [
    { kind: "role", label: "Role", count: 1, val: "0.82", sub: "tone-shifted v4.2", pct: 82,
      spark: [0.60,0.64,0.68,0.72,0.76,0.78,0.80,0.82], color: "#1a7aff" },
    { kind: "task", label: "Task", count: 3, val: "0.91", sub: "3 sub-tasks declared", pct: 91,
      spark: [0.70,0.74,0.80,0.83,0.86,0.88,0.90,0.91], color: "#10b981" },
    { kind: "context", label: "Context", count: 8, val: "0.68", sub: "8 grounding clauses", pct: 68,
      spark: [0.50,0.52,0.55,0.58,0.61,0.64,0.66,0.68], color: "#f5a623" },
    { kind: "constraint", label: "Constraints", count: 5, val: "0.74", sub: "5 hard · 2 soft", pct: 74,
      spark: [0.60,0.66,0.68,0.70,0.72,0.73,0.74,0.74], color: "#ef4444" },
    { kind: "rubric", label: "Rubric", count: 4, val: "0.86", sub: "4 scoring axes", pct: 86,
      spark: [0.65,0.70,0.74,0.78,0.81,0.83,0.85,0.86], color: "#a855f7" },
  ];
  return (
    <div className="dpv-wrap">
      <div className="dpv-head">
        <div className="dpv-title">Decomposed Prompt · v4.2</div>
        <div className="mot-meta"><span>21 tokens · 5 slots</span></div>
      </div>

      <div className="dpv-prompt">
        <span className="token t-role">You are a structured-analysis agent</span>
        {" "}that must{" "}
        <span className="token t-task">decompose a situational brief into entities, relations, and causal chains</span>.
        {" "}Given{" "}
        <span className="token t-context">a domain-tagged corpus, prior graph state, and a 3-round session memory</span>,{" "}
        produce an output respecting{" "}
        <span className="token t-constraint">strict typing, no hallucinated edges, &lt;1200 tokens</span>.
        {" "}Score yourself on{" "}
        <span className="token t-rubric">sophistication, density, depth, utility</span>.
      </div>

      <div className="dpv-grid">
        {cards.map(c => (
          <div key={c.kind} className={"dpv-card " + c.kind}>
            <div className="dpv-card-head">
              <span className="dpv-card-label">{c.label}</span>
              <span className="dpv-card-count">×{c.count}</span>
            </div>
            <div className="dpv-card-val">{c.val}<span className="unit"> score</span></div>
            <div className="dpv-card-sub">{c.sub}</div>
            <div className="dpv-card-bar"><div className="bar" style={{width: c.pct + "%"}}/></div>
            <Sparkline data={c.spark} color={c.color}/>
          </div>
        ))}
      </div>

      <div className="dpv-legend">
        <span className="leg"><span className="swatch" style={{"--c":"#1a7aff"}}/>Role</span>
        <span className="leg"><span className="swatch" style={{"--c":"#10b981"}}/>Task</span>
        <span className="leg"><span className="swatch" style={{"--c":"#f5a623"}}/>Context</span>
        <span className="leg"><span className="swatch" style={{"--c":"#ef4444"}}/>Constraint</span>
        <span className="leg"><span className="swatch" style={{"--c":"#a855f7"}}/>Rubric</span>
        <span style={{marginLeft:"auto", color:"var(--fg-faint)"}}>Hover tokens to inspect · click cards to drill in</span>
      </div>
    </div>
  );
}

Object.assign(window, { TitleBanner, SideNotif, SectionDivider, MacroTree, DecomposedPromptViz });
