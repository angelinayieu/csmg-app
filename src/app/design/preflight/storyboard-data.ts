// Connected-vision storyboard data — four frames that walk a Mind-Body-Cognition
// research prompt through intake → decompose → synthesis → ambient mode.
//
// Every node, edge, count, and synthesis line here is grounded in real
// schemas (entities/edges tables, synthesis_data JSONB structure, the
// /src/lib/templates/mind-body-cognition seed) so the storyboard isn't
// fabrication — it shows EXACTLY what these primitives display in the
// real pipeline output, just frozen at four moments of the run.
//
// Source map:
//   • /src/lib/templates/mind-body-cognition/seed.ts → 7-layer ontology
//   • /src/types/synthesis.ts → leverage_points / bottlenecks / open_questions / action_plan shape
//   • /src/components/canvas/pipeline-event-painter.tsx → kg-node + ghost mechanic
//   • /src/types/pipeline-events.ts → event shapes for the activity stream

export type LayerId = "L0" | "L1" | "L2" | "L3" | "L4";
export type Tier = "hero" | "key" | "support" | "peripheral";
export type EntityCategory =
  | "concrete"
  | "abstract"
  | "process"
  | "relational"
  | "epistemic";

export interface FrameNode {
  id: string;
  x: number;
  y: number;
  name: string;
  layer: LayerId;
  tier: Tier;
  category: EntityCategory;
  isGhost?: boolean;
  isCyclePart?: boolean;
  isLeverage?: boolean;
  isBottleneck?: boolean;
  /** Show a TrailBadge on this card (collapsed probe trail). */
  hasProbeTrail?: boolean;
  trailLabel?: string;
  trailResultCount?: number;
}

export interface FrameEdge {
  from: string;
  to: string;
  isGhost?: boolean;
  isCycle?: boolean;
  dimension?: "structural" | "functional" | "causal" | "logical";
  polarity?: "positive" | "negative" | "neutral";
}

export interface FrameStrategyHero {
  x: number;
  y: number;
  rank: number;
  title: string;
  summary: string;
  posture: string;
  confidence: number;
}

export type ProbeTrailIcon =
  | "probe-origin"
  | "decompose-step"
  | "search-step"
  | "result-terminal"
  | "reasoning-step";

export interface FrameProbeTrail {
  /** Trail anchor node id (where it extends from). */
  fromNodeId: string;
  /** Source kg-node UUID — the trail's first node tethers visibly to this. */
  sourceCardNodeId?: string;
  nodes: Array<{
    id: string;
    dx: number;
    dy: number;
    phase: "idle" | "working" | "complete" | "result" | "error";
    icon: ProbeTrailIcon;
    label?: string;
  }>;
  edges: Array<{ from: string; to: string; phase: "working" | "complete" }>;
}

export interface FrameRail {
  streaming: "running" | "paused" | "off";
  stage?: string; // "intake" | "decompose" | "research" | "synthesize" | "ambient"
  state?: {
    kgSnapshot: { entities: number; edges: number; cycles: number };
    activeStrategy?: {
      rank: number;
      title: string;
      posture: string;
      confidence: number;
    };
    lockedInsights?: Array<{
      kind: "bottleneck" | "leverage" | "risk";
      title: string;
      subtitle?: string;
    }>;
  };
  live?: {
    freshCount?: number;
    fresh?: Array<{
      kind: "pairwise" | "probe" | "stale" | "proposal";
      eyebrow: string;
      title: string;
      subtitle?: string;
      arrivedAt?: number;
    }>;
    activity?: Array<{
      time: string;
      text: string;
      iconKind: "added" | "edge" | "cycle" | "bridge" | "research" | "strategy";
    }>;
  };
}

export type PromptMode = "add" | "decompose" | "solve" | "probe";

export interface FrameSolveLandscape {
  x: number; y: number; w: number; h: number;
  query: string;
  axes: Array<{
    label: string;
    description: string;
    score: number; // 0..1 confidence axis is relevant
    state: "scoring" | "scored";
  }>;
}

export interface FrameSolveProposal {
  x: number; y: number; w: number; h: number;
  query: string;
  solutions: Array<{
    rank: number;
    title: string;
    summary: string;
    confidence: number;
    drawnFrom: string[]; // axis labels
    posture: string;
  }>;
}

export interface StoryboardFrame {
  t: string; // human-readable time stamp ("t=0s", "t=8s")
  title: string;
  caption: string;
  canvas: {
    showPromptInput?: boolean;
    promptText?: string;
    promptMode?: PromptMode;
    showStageBanner?: { stage: string; phase: "enter" | "exit" };
    nodes?: FrameNode[];
    edges?: FrameEdge[];
    cyclePolygons?: Array<{ nodeIds: string[] }>;
    strategyHero?: FrameStrategyHero;
    probeTrail?: FrameProbeTrail;
    /** Background prompt-as-tldraw-shape near origin. Stays visible
     *  through the run as a "you started here" anchor. */
    originPrompt?: { x: number; y: number; text: string };
    /** Solve mode artifacts — the diverge (Landscape) + converge
     *  (Proposal) rooms that re-fire when the user asks "Solve …" */
    solveLandscape?: FrameSolveLandscape;
    solveProposal?: FrameSolveProposal;
    /** When set, pre-existing canvas nodes recede to this opacity so
     *  the Solve rooms read as the active foreground. */
    backgroundOpacity?: number;
  };
  rail: FrameRail;
}

// ── Frame 1 · t=0s · User enters prompt ─────────────────────────────

const PROMPT_TEXT =
  'Decompose how attention, working memory, and executive function interconnect. Focus on load-bearing bottlenecks.';

const F1: StoryboardFrame = {
  t: "t=0s",
  title: "User enters prompt · Decompose mode",
  caption:
    "A blank canvas with one persistent surface — the prompt pill at bottom-center. The mode selector (Add · Decompose · Solve · Probe) is leading; Decompose is active because the canvas is empty (Solve is disabled until KG ≥ 10 entities, Probe is disabled until a card is selected). The next click triggers POST /api/intake/bootstrap.",
  canvas: {
    showPromptInput: true,
    promptText: PROMPT_TEXT,
    promptMode: "decompose",
  },
  rail: {
    streaming: "off",
    stage: "idle",
  },
};

// ── Frame 2 · t=12s · Intake fired, decompose pass 1 ─────────────────
//
// Origin prompt shape persists as the anchor. 5 ghost kg-nodes have
// landed (dashed border, isGhost=true), staggered along the tree-fan
// algorithm coordinates. Edges are dashed grey. Activity stream shows
// rapid entity_added / edge_added events.

const F2: StoryboardFrame = {
  t: "t=12s",
  title: "Intake firing · ghost nodes materializing",
  caption:
    "POST /api/intake/bootstrap returned spaceId+runId in <500ms; the user redirected to the canvas. The decompose pipeline (queued via Next 16's after()) is mid-Pass-1, emitting entity_added events. The painter places ghost kg-node shapes (dashed) at tree-fan coordinates. The rail's Live zone is now streaming.",
  canvas: {
    showStageBanner: { stage: "decompose", phase: "enter" },
    originPrompt: { x: 60, y: 240, text: PROMPT_TEXT },
    nodes: [
      // Hero entities first — these are the load-bearing concepts
      {
        id: "e-attention",
        x: 240, y: 80,
        name: "Selective Attention",
        layer: "L1",
        tier: "key",
        category: "process",
        isGhost: true,
      },
      {
        id: "e-wm",
        x: 240, y: 180,
        name: "Working Memory",
        layer: "L1",
        tier: "key",
        category: "process",
        isGhost: true,
      },
      {
        id: "e-exec",
        x: 240, y: 280,
        name: "Executive Function",
        layer: "L1",
        tier: "key",
        category: "process",
        isGhost: true,
      },
      {
        id: "e-load",
        x: 440, y: 130,
        name: "Cognitive Load",
        layer: "L2",
        tier: "support",
        category: "abstract",
        isGhost: true,
      },
      {
        id: "e-stress",
        x: 440, y: 230,
        name: "Stress Response",
        layer: "L2",
        tier: "support",
        category: "process",
        isGhost: true,
      },
    ],
    edges: [
      { from: "e-attention", to: "e-wm", isGhost: true, dimension: "functional" },
      { from: "e-wm", to: "e-exec", isGhost: true, dimension: "functional" },
      { from: "e-load", to: "e-attention", isGhost: true, polarity: "negative" },
      { from: "e-stress", to: "e-load", isGhost: true, polarity: "positive" },
    ],
  },
  rail: {
    streaming: "running",
    stage: "decompose",
    state: {
      kgSnapshot: { entities: 5, edges: 4, cycles: 0 },
    },
    live: {
      freshCount: 9,
      fresh: [
        {
          kind: "proposal",
          eyebrow: "Stage",
          title: "Decompose · Pass 1",
          subtitle: "5 entities · 4 edges so far",
          arrivedAt: Date.now(),
        },
      ],
      activity: [
        { time: "·12s", text: "+ Stress Response", iconKind: "added" },
        { time: "·11s", text: "+ Cognitive Load", iconKind: "added" },
        { time: "·9s", text: "+ Executive Function", iconKind: "added" },
        { time: "·8s", text: "+ Working Memory", iconKind: "added" },
        { time: "·6s", text: "+ Selective Attention", iconKind: "added" },
        { time: "·3s", text: "Decompose started", iconKind: "research" },
      ],
    },
  },
};

// ── Frame 3 · t=45s · Decompose complete · cycle detected ────────────
//
// 12 real entities (no longer ghosts), solid edges. A reinforcing
// cycle Attention → Stress → Cognitive Load → Attention has been
// detected and is highlighted. Pairwise prospector kicked in once
// neighborhood density crossed threshold.

const F3: StoryboardFrame = {
  t: "t=45s",
  title: "Decompose complete · first cycle locked",
  caption:
    "Pass 2 structured the prose decomposition into JSON; sanitized entities + edges inserted into the entities/edges tables. cycle_detected event fires on the Attention → Stress → Cognitive Load reinforcing loop. Auto-prospect (the wiring we shipped earlier) is now firing on the parent's neighborhood — first novel pairwise candidate landing in the Live zone.",
  canvas: {
    originPrompt: { x: 60, y: 240, text: PROMPT_TEXT },
    nodes: [
      {
        id: "e-attention",
        x: 240, y: 80,
        name: "Selective Attention",
        layer: "L1",
        tier: "hero",
        category: "process",
        isCyclePart: true,
        isBottleneck: true,
      },
      {
        id: "e-wm",
        x: 240, y: 180,
        name: "Working Memory",
        layer: "L1",
        tier: "hero",
        category: "process",
        isLeverage: true,
      },
      {
        id: "e-exec",
        x: 240, y: 280,
        name: "Executive Function",
        layer: "L1",
        tier: "key",
        category: "process",
      },
      {
        id: "e-load",
        x: 440, y: 130,
        name: "Cognitive Load",
        layer: "L2",
        tier: "key",
        category: "abstract",
        isCyclePart: true,
      },
      {
        id: "e-stress",
        x: 440, y: 230,
        name: "Stress Response",
        layer: "L2",
        tier: "support",
        category: "process",
        isCyclePart: true,
      },
      {
        id: "e-sleep",
        x: 440, y: 320,
        name: "Sleep Pressure",
        layer: "L2",
        tier: "support",
        category: "process",
      },
      {
        id: "e-rehearsal",
        x: 620, y: 120,
        name: "Phonological Rehearsal",
        layer: "L3",
        tier: "support",
        category: "process",
      },
      {
        id: "e-chunk",
        x: 620, y: 200,
        name: "Chunking",
        layer: "L3",
        tier: "support",
        category: "process",
      },
      {
        id: "e-inhib",
        x: 620, y: 300,
        name: "Response Inhibition",
        layer: "L3",
        tier: "support",
        category: "process",
      },
      {
        id: "e-ext",
        x: 620, y: 380,
        name: "External Stores",
        layer: "L3",
        tier: "support",
        category: "concrete",
      },
      {
        id: "e-cocktail",
        x: 800, y: 80,
        name: "Cocktail Party Gating",
        layer: "L4",
        tier: "peripheral",
        category: "process",
      },
      {
        id: "e-cowan",
        x: 800, y: 180,
        name: "Cowan Limit (4±1)",
        layer: "L4",
        tier: "peripheral",
        category: "epistemic",
      },
    ],
    edges: [
      { from: "e-attention", to: "e-wm", dimension: "functional" },
      { from: "e-wm", to: "e-exec", dimension: "functional" },
      { from: "e-attention", to: "e-load", isCycle: true, polarity: "negative" },
      { from: "e-load", to: "e-stress", isCycle: true, polarity: "positive" },
      { from: "e-stress", to: "e-attention", isCycle: true, polarity: "negative" },
      { from: "e-stress", to: "e-sleep", polarity: "positive" },
      { from: "e-sleep", to: "e-attention", polarity: "negative" },
      { from: "e-rehearsal", to: "e-wm", dimension: "structural" },
      { from: "e-chunk", to: "e-wm", dimension: "structural" },
      { from: "e-inhib", to: "e-exec", dimension: "structural" },
      { from: "e-ext", to: "e-wm", polarity: "positive" },
      { from: "e-cocktail", to: "e-attention", dimension: "structural" },
      { from: "e-cowan", to: "e-wm", dimension: "structural" },
    ],
    cyclePolygons: [{ nodeIds: ["e-attention", "e-load", "e-stress"] }],
  },
  rail: {
    streaming: "running",
    stage: "decompose",
    state: {
      kgSnapshot: { entities: 12, edges: 13, cycles: 1 },
    },
    live: {
      freshCount: 4,
      fresh: [
        {
          kind: "pairwise",
          eyebrow: "Pairwise · novelty 0.92",
          title: "Sleep Pressure ↔ Selective Attention",
          subtitle: "cross-layer · auto-prospected",
          arrivedAt: Date.now() - 4_000,
        },
        {
          kind: "proposal",
          eyebrow: "Cycle",
          title: "Attention → Stress → Load → Attention",
          subtitle: "reinforcing loop detected",
          arrivedAt: Date.now() - 12_000,
        },
        {
          kind: "stale",
          eyebrow: "Coverage",
          title: "8 connection checks need revisit",
          subtitle: "topology shifted",
          arrivedAt: Date.now() - 22_000,
        },
      ],
      activity: [
        { time: "·2s", text: "Pairwise: Sleep ↔ Attention (0.92)", iconKind: "edge" },
        { time: "·12s", text: "Cycle: 3-node reinforcing loop", iconKind: "cycle" },
        { time: "·18s", text: "+ Cocktail Party Gating", iconKind: "added" },
        { time: "·24s", text: "+ Cowan Limit (4±1)", iconKind: "added" },
        { time: "·36s", text: "Pass 2: 12 entities · 13 edges", iconKind: "research" },
      ],
    },
  },
};

// ── Frame 4 · t=2m 30s · Synthesis consensus · ambient mode ─────────
//
// Strategy hero card materialized at the canvas origin position.
// Synthesis identified working memory externalization as top leverage.
// Probe trail is unfurling from the Cognitive Load node — user clicked
// "Open rabbit hole" on the "Sleep cards have no metric" probe.
// Ambient mode is the steady state; user can now triage at their pace.

const F4: StoryboardFrame = {
  t: "t=2m 30s",
  title: "Synthesis ready · ambient mode steady-state",
  caption:
    "synthesize_layered emitted the strategy_consensus_ready event. The StrategyHeroCard materialized; synthesis_data populated with leverage_points, bottlenecks, axioms, action_plan, open_questions. The rail's State zone now anchors against settled artifacts; the Live zone keeps streaming low-noise updates. A user-clicked probe rabbit hole is unfurling from the Working Memory node.",
  canvas: {
    originPrompt: { x: 60, y: 240, text: PROMPT_TEXT },
    nodes: [
      // Same nodes as F3, but Working Memory has a TrailBadge attached
      {
        id: "e-attention",
        x: 240, y: 80,
        name: "Selective Attention",
        layer: "L1",
        tier: "hero",
        category: "process",
        isCyclePart: true,
        isBottleneck: true,
      },
      {
        id: "e-wm",
        x: 240, y: 180,
        name: "Working Memory",
        layer: "L1",
        tier: "hero",
        category: "process",
        isLeverage: true,
        hasProbeTrail: true,
        trailLabel: "Probe · 2 results",
        trailResultCount: 2,
      },
      {
        id: "e-exec",
        x: 240, y: 280,
        name: "Executive Function",
        layer: "L1",
        tier: "key",
        category: "process",
      },
      {
        id: "e-load",
        x: 440, y: 130,
        name: "Cognitive Load",
        layer: "L2",
        tier: "key",
        category: "abstract",
        isCyclePart: true,
      },
      {
        id: "e-stress",
        x: 440, y: 230,
        name: "Stress Response",
        layer: "L2",
        tier: "support",
        category: "process",
        isCyclePart: true,
      },
      {
        id: "e-ext",
        x: 620, y: 380,
        name: "External Stores",
        layer: "L3",
        tier: "key",
        category: "concrete",
        isLeverage: true,
      },
    ],
    edges: [
      { from: "e-attention", to: "e-wm", dimension: "functional" },
      { from: "e-wm", to: "e-exec", dimension: "functional" },
      { from: "e-attention", to: "e-load", isCycle: true, polarity: "negative" },
      { from: "e-load", to: "e-stress", isCycle: true, polarity: "positive" },
      { from: "e-stress", to: "e-attention", isCycle: true, polarity: "negative" },
      { from: "e-ext", to: "e-wm", polarity: "positive" },
    ],
    cyclePolygons: [{ nodeIds: ["e-attention", "e-load", "e-stress"] }],
    strategyHero: {
      x: 60, y: 60,
      rank: 1,
      title: "Attention Redirection via External Stores",
      summary:
        "Externalize working-memory load into structured templates so the attention bottleneck doesn't gate downstream reasoning.",
      posture: "cautious_validation",
      confidence: 0.82,
    },
    probeTrail: {
      fromNodeId: "e-load",
      sourceCardNodeId: "e-load",
      nodes: [
        { id: "p-q",   dx: 60,  dy: -10, phase: "complete", icon: "probe-origin",     label: "probe" },
        { id: "p-dec", dx: 160, dy: -10, phase: "complete", icon: "decompose-step",   label: "decompose" },
        { id: "p-r1",  dx: 260, dy: -50, phase: "complete", icon: "search-step",      label: "Walker '17" },
        { id: "p-r2",  dx: 260, dy:  30, phase: "working",  icon: "search-step",      label: "searching" },
        { id: "p-res", dx: 380, dy: -10, phase: "result",   icon: "result-terminal",  label: "2 entities" },
      ],
      edges: [
        { from: "p-q",   to: "p-dec", phase: "complete" },
        { from: "p-dec", to: "p-r1",  phase: "complete" },
        { from: "p-dec", to: "p-r2",  phase: "working" },
        { from: "p-r1",  to: "p-res", phase: "complete" },
        { from: "p-r2",  to: "p-res", phase: "working" },
      ],
    },
  },
  rail: {
    streaming: "running",
    stage: "ambient",
    state: {
      kgSnapshot: { entities: 34, edges: 87, cycles: 3 },
      activeStrategy: {
        rank: 1,
        title: "Attention Redirection via External Stores",
        posture: "Cautious validation",
        confidence: 82,
      },
      lockedInsights: [
        {
          kind: "bottleneck",
          title: "Selective Attention Gate",
          subtitle: "blast radius 0.94",
        },
        {
          kind: "leverage",
          title: "Working Memory Externalization",
          subtitle: "unlocks 4 downstream nodes",
        },
        {
          kind: "risk",
          title: "Stress feedback loop",
          subtitle: "reinforcing · 3 nodes",
        },
      ],
    },
    live: {
      freshCount: 3,
      fresh: [
        {
          kind: "pairwise",
          eyebrow: "Pairwise · novelty 0.92",
          title: "Sleep Pressure ↔ Selective Attention",
          subtitle: "just now",
          arrivedAt: Date.now() - 8_000,
        },
        {
          kind: "probe",
          eyebrow: "Probe · critical",
          title: "Does attention share a resource pool with WM?",
          subtitle: "would reframe dual-task strategy",
          arrivedAt: Date.now() - 35_000,
        },
        {
          kind: "stale",
          eyebrow: "Coverage",
          title: "12 pair checks pending revisit",
          subtitle: "topology shifted · 3m ago",
          arrivedAt: Date.now() - 180_000,
        },
      ],
      activity: [
        { time: "·8s", text: "Pairwise: Sleep ↔ Attention", iconKind: "edge" },
        { time: "·35s", text: "Probe started: Working Memory", iconKind: "research" },
        { time: "·1m", text: "Strategy locked: Attention Redirection", iconKind: "strategy" },
        { time: "·1m", text: "Synthesis: 3 leverage · 1 bottleneck", iconKind: "research" },
        { time: "·2m", text: "Cycle: Attention → Stress → Load", iconKind: "cycle" },
      ],
    },
  },
};

// ── Frame 5 · t=3m 20s · Solve mode · Landscape + Proposal re-fire ──
//
// User has the populated KG from F4. They open the prompt pill, switch
// to SOLVE mode, and ask: "Given this graph, what's the highest-leverage
// next intervention I can run this week?". The system uses the existing
// KG as substrate and re-fires:
//   • Landscape room (diverge) — opens 4 axis lenses scoring the KG
//     for the query (which mechanisms / variables / actors / risks)
//   • Proposal room (converge) — synthesizes 3 ranked solutions
//     drawn from the axis findings
//
// Pre-existing canvas nodes recede to 0.35 so the Solve rooms read as
// the foreground. The Stage Rooms are the SAME ones that fire during
// initial intake — Solve mode just re-runs Landscape → Proposal with
// the existing KG as input rather than running decompose from scratch.

const F5_QUERY =
  'Given this graph, what\'s the highest-leverage intervention I can run this week to lift attention without sleep changes?';

const F5: StoryboardFrame = {
  t: "t=3m 20s",
  title: "Solve mode · Landscape diverges · Proposal converges",
  caption:
    "The user opened the prompt pill, switched to SOLVE, and asked a question. The existing KG (faded to background) becomes the substrate — the system re-fires the Landscape room (4 axis lenses scoring the graph for this query) and converges into the Proposal room (3 ranked solutions). This is the diverge → converge pattern, but it's NOT new infrastructure — it's the same Stage Rooms that fired during initial intake, re-firing on demand. The rail's Active Strategy section will swap to the new top-ranked solution once the user accepts it.",
  canvas: {
    showPromptInput: true,
    promptText: F5_QUERY,
    promptMode: "solve",
    backgroundOpacity: 0.35,
    originPrompt: { x: 30, y: 12, text: PROMPT_TEXT },
    // Pre-existing KG as faded substrate
    nodes: [
      { id: "e-attention", x: 110, y: 60,  name: "Selective Attention", layer: "L1", tier: "support", category: "process", isBottleneck: true },
      { id: "e-wm",        x: 110, y: 130, name: "Working Memory",      layer: "L1", tier: "support", category: "process", isLeverage: true },
      { id: "e-load",      x: 110, y: 200, name: "Cognitive Load",      layer: "L2", tier: "peripheral", category: "abstract" },
      { id: "e-stress",    x: 110, y: 260, name: "Stress Response",     layer: "L2", tier: "peripheral", category: "process" },
      { id: "e-ext",       x: 110, y: 320, name: "External Stores",     layer: "L3", tier: "peripheral", category: "concrete", isLeverage: true },
    ],
    edges: [
      { from: "e-attention", to: "e-wm",   dimension: "functional" },
      { from: "e-load",      to: "e-attention", polarity: "negative" },
      { from: "e-stress",    to: "e-attention", polarity: "negative" },
      { from: "e-ext",       to: "e-wm",   polarity: "positive" },
    ],
    solveLandscape: {
      x: 240, y: 30, w: 420, h: 195,
      query: F5_QUERY,
      axes: [
        {
          label: "Mechanism",
          description: "Which causal pathways are most plastic this week?",
          score: 0.82,
          state: "scored",
        },
        {
          label: "Cost / lag",
          description: "Which interventions have low cost + short time-to-effect?",
          score: 0.71,
          state: "scored",
        },
        {
          label: "Constraint",
          description: "What constraint must hold (no sleep changes)?",
          score: 0.58,
          state: "scored",
        },
        {
          label: "Counterfactual",
          description: "What's the next-best alternative if #1 is blocked?",
          score: 0.45,
          state: "scoring",
        },
      ],
    },
    solveProposal: {
      x: 240, y: 235, w: 420, h: 175,
      query: F5_QUERY,
      solutions: [
        {
          rank: 1,
          title: "Externalize working-memory load",
          summary:
            "Use structured templates to free attention from internal rehearsal — ladder of low-cost weekly tests.",
          confidence: 0.84,
          drawnFrom: ["Mechanism", "Cost / lag"],
          posture: "Cautious validation",
        },
        {
          rank: 2,
          title: "Reduce ambient distraction",
          summary:
            "Block notification interrupts during 90-min focus windows; cocktail-party gating recovers downstream.",
          confidence: 0.71,
          drawnFrom: ["Mechanism", "Constraint"],
          posture: "Aggressive growth",
        },
        {
          rank: 3,
          title: "Chunk inputs in familiar domain",
          summary:
            "Only when domain fluency is high — fragile under novelty. Use as a supplement to #1.",
          confidence: 0.54,
          drawnFrom: ["Counterfactual"],
          posture: "Pivot exploration",
        },
      ],
    },
  },
  rail: {
    streaming: "running",
    stage: "solve",
    state: {
      kgSnapshot: { entities: 34, edges: 87, cycles: 3 },
      activeStrategy: {
        rank: 1,
        title: "Attention Redirection via External Stores",
        posture: "Cautious validation",
        confidence: 82,
      },
      lockedInsights: [
        {
          kind: "bottleneck",
          title: "Selective Attention Gate",
          subtitle: "blast radius 0.94",
        },
        {
          kind: "leverage",
          title: "Working Memory Externalization",
          subtitle: "unlocks 4 downstream nodes",
        },
      ],
    },
    live: {
      freshCount: 4,
      fresh: [
        {
          kind: "proposal",
          eyebrow: "Solve · running",
          title: "Landscape · 3 of 4 lenses scored",
          subtitle: "12s · re-firing on existing KG",
          arrivedAt: Date.now(),
        },
        {
          kind: "proposal",
          eyebrow: "Solve · ready",
          title: "Proposal · 3 solutions ranked",
          subtitle: "draft — accept to swap into Active",
          arrivedAt: Date.now() - 2_000,
        },
      ],
      activity: [
        { time: "·12s", text: "Solve started: leverage this week", iconKind: "research" },
        { time: "·9s", text: "Mechanism axis scored (0.82)", iconKind: "research" },
        { time: "·6s", text: "Cost/lag axis scored (0.71)", iconKind: "research" },
        { time: "·2s", text: "Proposal #1 ready: External Stores", iconKind: "strategy" },
      ],
    },
  },
};

export const STORYBOARD_FRAMES: StoryboardFrame[] = [F1, F2, F3, F4, F5];
