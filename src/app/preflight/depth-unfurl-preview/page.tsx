"use client";

// Preflight prototype — the DEPTH-UNFURL dial with a TRANSPARENT readiness
// model (D0→D3).
//
// The point of this revision: "readiness" is no longer a magic number. It
// is a fully auditable roll-up —
//
//     readiness = Σ ( layer.weight × layer.completion )
//     layer.completion = 0.30·Mapped + 0.35·Addressed + 0.35·Proven
//     each dimension is derived from the STATE of that layer's variables
//
// So every layer carries its own completion bar (itself composed of the
// Mapped/Addressed/Proven sub-criteria), a weight (its causal contribution
// to the objective), and a points figure (weight × completion). The orb's
// score is literally the sum of those points, shown as a composition bar +
// scorecard you can read top-to-bottom. Nothing is hand-waved.
//
//   D0 Seed     — orb + the readiness scorecard (how the number is built).
//   D1 Anatomy  — layers as shelves, each with a completion bar + weight +
//                 pts + its (now many) feature variables.
//   D2 Bets     — sub-objectives dock onto bands; gaps glow.
//   D3 Levers   — dig into one bet → its room (pains → mechanisms → outcomes).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  Settings2,
  RefreshCw,
  Activity,
  Target,
  Plus,
  Sparkles,
  ArrowUp,
  ArrowRight,
  ChevronRight,
  AlertTriangle,
  Check,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const EASE = [0.22, 1, 0.36, 1] as const;

// ── State model: every variable has a maturity state that drives scoring ─
type VarState = "open" | "mapped" | "addressed" | "proven";
const STATE_RANK: Record<VarState, number> = { open: 0, mapped: 1, addressed: 2, proven: 3 };
const STATE_META: Record<VarState, { color: string; label: string }> = {
  open: { color: "#94A3B8", label: "Open" },
  mapped: { color: "#3B82F6", label: "Mapped" },
  addressed: { color: "#F59E0B", label: "Addressed" },
  proven: { color: "#10B981", label: "Proven" },
};

// Dimension weights inside a layer's completion (sum = 1).
const DIM_W = { mapped: 0.3, addressed: 0.35, proven: 0.35 };

type Archetype = "substrate" | "mechanism" | "process" | "output" | "outcome";
interface Variable {
  id: string;
  name: string;
  state: VarState;
}
interface Layer {
  ordinal: number; // 1 = substrate (bottom) … N = outcome (top)
  name: string;
  archetype: Archetype;
  variables: Variable[];
  // NOTE: no `weight` here — it's DERIVED from INFLUENCES via weightOf().
}
interface Bet {
  id: string;
  title: string;
  layerOrdinals: number[];
  health: number;
  chains: number;
}
interface RoomItem {
  id: string;
  name: string;
  state?: VarState;
}
/** A causal play: pain → mechanism → outcome, with polarity + strength.
 *  The mechanism's `state` doubles as the rigor tier at D5 Proof. */
interface Chain {
  id: string;
  painId: string;
  mechId: string;
  outcomeId: string;
  polarity: "+" | "-";
  strength: number; // 0..1 → stroke weight
  inLoop?: boolean; // participates in the reinforcing loop
}
interface Room {
  pains: RoomItem[];
  mechanisms: RoomItem[];
  outcomes: RoomItem[];
  heroMechanismId: string;
  chains: Chain[];
  /** Reinforcing/balancing loop summary surfaced at D4+. */
  loopLabel?: string;
}

const OBJECTIVE = "Sustain afternoon cognitive performance";

// ── Mock cognition-health stack — deliberately dense (many features) ─────
const LAYERS: Layer[] = [
  {
    ordinal: 5,
    name: "Outcome",
    archetype: "outcome",
    variables: [
      { id: "focus", name: "Sustained focus hours", state: "mapped" },
      { id: "stability", name: "Afternoon energy stability", state: "addressed" },
      { id: "clarity", name: "Subjective clarity", state: "open" },
      { id: "quality", name: "Output quality", state: "mapped" },
    ],
  },
  {
    ordinal: 4,
    name: "Behavioral",
    archetype: "output",
    variables: [
      { id: "blocks", name: "Deep-work blocks", state: "addressed" },
      { id: "breaks", name: "Break cadence", state: "mapped" },
      { id: "switch", name: "Context-switch rate", state: "mapped" },
      { id: "env", name: "Environment design", state: "addressed" },
      { id: "notif", name: "Notification discipline", state: "proven" },
      { id: "sched", name: "Energy-based scheduling", state: "open" },
    ],
  },
  {
    ordinal: 3,
    name: "Cognitive",
    archetype: "process",
    variables: [
      { id: "attention", name: "Attention regulation", state: "mapped" },
      { id: "wm", name: "Working memory", state: "open" },
      { id: "load", name: "Cognitive load", state: "mapped" },
      { id: "switchcost", name: "Task-switch cost", state: "open" },
      { id: "fatigue", name: "Mental fatigue", state: "open" },
      { id: "flow", name: "Flow access", state: "open" },
      { id: "filter", name: "Distraction filtering", state: "open" },
    ],
  },
  {
    ordinal: 2,
    name: "Biological",
    archetype: "mechanism",
    variables: [
      { id: "glucose", name: "Glucose regulation", state: "addressed" },
      { id: "cortisol", name: "Cortisol rhythm", state: "mapped" },
      { id: "hydration", name: "Hydration status", state: "addressed" },
      { id: "inflam", name: "Inflammatory load", state: "open" },
      { id: "micro", name: "Micronutrient sufficiency", state: "mapped" },
      { id: "hrv", name: "Heart-rate variability", state: "addressed" },
      { id: "bgv", name: "Blood-sugar variability", state: "proven" },
    ],
  },
  {
    ordinal: 1,
    name: "Foundational",
    archetype: "substrate",
    variables: [
      { id: "sleep", name: "Sleep architecture", state: "proven" },
      { id: "circadian", name: "Circadian timing", state: "addressed" },
      { id: "nutrient", name: "Nutrient timing", state: "addressed" },
      { id: "light", name: "Light exposure", state: "mapped" },
      { id: "debt", name: "Sleep debt / recovery", state: "proven" },
      { id: "stim", name: "Stimulant timing", state: "addressed" },
      { id: "winddown", name: "Evening wind-down", state: "mapped" },
    ],
  },
];

// Cross-layer influence arrows. In the real app these come from
// ObjectiveStack.influences (LLM-generated). A layer's WEIGHT is derived
// from these — its share of the arrows touching it (degree centrality) —
// so hubs are weighted more and the terminal outcome (no outgoing
// leverage) weighs least. Includes long-range arrows (L2→L4, L1→L3) the
// real stack also emits, which is what differentiates the weights.
const INFLUENCES = [
  { from: 1, to: 2, verb: "enables" },
  { from: 2, to: 3, verb: "produces" },
  { from: 3, to: 4, verb: "enables" },
  { from: 4, to: 5, verb: "produces" },
  { from: 2, to: 4, verb: "enables" }, // biological → behavioral (skips cognitive)
  { from: 1, to: 3, verb: "enables" }, // foundation → cognitive (direct)
];

const BETS: Bet[] = [
  { id: "b1", title: "Fix sleep consistency", layerOrdinals: [1], health: 0.8, chains: 4 },
  { id: "b2", title: "Stabilize afternoon glucose", layerOrdinals: [1, 2], health: 0.7, chains: 3 },
  // L3 (Cognitive) deliberately has no bet → gap-invitation glow.
  { id: "b3", title: "Protect deep-work blocks", layerOrdinals: [4], health: 0.55, chains: 2 },
  { id: "b4", title: "Add recovery breaks", layerOrdinals: [4], health: 0.45, chains: 1 },
  { id: "b5", title: "Build a focus→reward loop", layerOrdinals: [3, 5], health: 0.4, chains: 1 },
];

const ROOMS: Record<string, Room> = {
  b2: {
    heroMechanismId: "m_protein",
    pains: [
      { id: "p1", name: "Post-lunch glucose spike" },
      { id: "p2", name: "2–4pm energy crash" },
      { id: "p3", name: "Reactive snacking" },
    ],
    mechanisms: [
      { id: "m_protein", name: "Protein-forward lunch", state: "proven" },
      { id: "m_walk", name: "10-min post-meal walk", state: "addressed" },
      { id: "m_fiber", name: "Fiber-first sequencing", state: "mapped" },
      { id: "m_caf", name: "Caffeine timing shift", state: "open" },
    ],
    outcomes: [
      { id: "o1", name: "Stable 2–4pm focus" },
      { id: "o2", name: "Fewer cravings" },
      { id: "o3", name: "Even energy curve" },
    ],
    chains: [
      { id: "c1", painId: "p1", mechId: "m_protein", outcomeId: "o1", polarity: "+", strength: 0.9, inLoop: true },
      { id: "c2", painId: "p3", mechId: "m_fiber", outcomeId: "o2", polarity: "+", strength: 0.6 },
      { id: "c3", painId: "p2", mechId: "m_walk", outcomeId: "o3", polarity: "+", strength: 0.7, inLoop: true },
    ],
    loopLabel: "Stable focus → steadier eating habits → protein-forward lunch",
  },
};

const ARCHETYPE: Record<Archetype, { color: string; Icon: typeof Layers; label: string }> = {
  substrate: { color: "#64748B", Icon: Layers, label: "Substrate" },
  mechanism: { color: "#475569", Icon: Settings2, label: "Mechanism" },
  process: { color: "#475569", Icon: RefreshCw, label: "Process" },
  output: { color: "#C026D3", Icon: Activity, label: "Output" },
  outcome: { color: "#475569", Icon: Target, label: "Outcome" },
};

// ── Scoring math (all derived, nothing hand-set) ─────────────────────────
function layerDims(l: Layer) {
  const n = l.variables.length || 1;
  const atLeast = (r: number) =>
    l.variables.filter((v) => STATE_RANK[v.state] >= r).length / n;
  return { mapped: atLeast(1), addressed: atLeast(2), proven: atLeast(3) };
}
function layerCompletion(l: Layer) {
  const d = layerDims(l);
  return DIM_W.mapped * d.mapped + DIM_W.addressed * d.addressed + DIM_W.proven * d.proven;
}
// Weight DERIVED from the influence graph: a layer's degree (# of arrows
// touching it) ÷ total degree. Hubs weigh more; the terminal outcome
// (incoming only) weighs least. This replaces the old hand-set weights.
function degreeOf(ordinal: number) {
  return INFLUENCES.filter((f) => f.from === ordinal || f.to === ordinal).length;
}
const TOTAL_DEGREE = LAYERS.reduce((s, l) => s + degreeOf(l.ordinal), 0);
function weightOf(ordinal: number) {
  return TOTAL_DEGREE === 0 ? 0 : degreeOf(ordinal) / TOTAL_DEGREE;
}
function contributionPts(l: Layer) {
  return weightOf(l.ordinal) * layerCompletion(l) * 100;
}

const DEPTHS = [
  { d: 0, label: "Seed", locked: false },
  { d: 1, label: "Anatomy", locked: false },
  { d: 2, label: "Bets", locked: false },
  { d: 3, label: "Levers", locked: false },
  { d: 4, label: "Plays", locked: false },
  { d: 5, label: "Proof", locked: false },
];

export default function DepthUnfurlPreviewPage() {
  const [depth, setDepth] = useState(0);
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null);
  const [focusBetId, setFocusBetId] = useState<string>("b2");
  const wheelAcc = useRef(0);
  const depthRef = useRef(depth);
  useEffect(() => {
    depthRef.current = depth;
  }, [depth]);

  const setDepthClamped = useCallback(
    (next: number) => setDepth(Math.max(0, Math.min(5, next))),
    [],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      wheelAcc.current += e.deltaY;
      if (wheelAcc.current > 60) {
        wheelAcc.current = 0;
        setDepthClamped(depthRef.current + 1);
      } else if (wheelAcc.current < -60) {
        wheelAcc.current = 0;
        setDepthClamped(depthRef.current - 1);
      }
    },
    [setDepthClamped],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") setDepthClamped(depthRef.current + 1);
      if (e.key === "ArrowUp") setDepthClamped(depthRef.current - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDepthClamped]);

  // ── Derived scores ──
  const { readiness, rows, gapLayer } = useMemo(() => {
    const rows = LAYERS.map((l) => ({
      layer: l,
      completion: layerCompletion(l),
      pts: contributionPts(l),
      dims: layerDims(l),
    }));
    const readiness = rows.reduce((s, r) => s + r.pts, 0); // already 0..100
    // biggest gap = layer losing the most potential points (weight × shortfall)
    const gap = [...rows].sort(
      (a, b) =>
        weightOf(b.layer.ordinal) * (1 - b.completion) -
        weightOf(a.layer.ordinal) * (1 - a.completion),
    )[0];
    return { readiness, rows, gapLayer: gap.layer.ordinal };
  }, []);

  const shelvesTopDown = [...LAYERS].sort((a, b) => b.ordinal - a.ordinal);
  const betsByOrdinal = new Map<number, Bet[]>();
  for (const b of BETS) {
    const o = Math.max(...b.layerOrdinals);
    betsByOrdinal.set(o, [...(betsByOrdinal.get(o) ?? []), b]);
  }
  const leverage = (b: Bet) => b.health * b.chains * b.layerOrdinals.length;
  const focusBet = BETS.find((b) => b.id === focusBetId) ?? BETS[0];

  return (
    <div
      onWheel={onWheel}
      className="fixed inset-0 overflow-hidden"
      style={{
        background: "#F5F5F7",
        backgroundImage: "radial-gradient(rgba(15,23,42,0.05) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header */}
      <div className="pointer-events-none fixed left-0 right-0 top-0 z-20 flex flex-col items-center pt-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: appleVibe.text.faint }}>
          Depth-unfurl · readiness model
        </div>
        <div className="mt-1 text-[12px]" style={{ color: appleVibe.text.tertiary }}>
          Scroll · ↑/↓ · or click a notch to unfurl
        </div>
      </div>

      {/* Stage */}
      <div className="absolute inset-0 flex flex-col items-center overflow-y-auto px-8 py-16">
        {depth < 3 && (
          <>
            {/* Orb */}
            <motion.div
              className="relative z-10 flex flex-shrink-0 flex-col items-center"
              animate={{ scale: depth === 0 ? 1 : 0.66 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <Orb readiness={readiness} big={depth === 0} />
            </motion.div>
            {/* Objective caption — labelled + readable at every depth so the
                orb always reads as "this is the objective." */}
            <div
              className="flex-shrink-0 text-center"
              style={{ marginTop: depth === 0 ? 16 : 6 }}
            >
              <div
                className="font-bold uppercase"
                style={{ color: appleVibe.text.faint, fontSize: 9, letterSpacing: "0.18em" }}
              >
                Objective
              </div>
              <div
                className="mx-auto mt-0.5 max-w-md font-semibold"
                style={{ color: appleVibe.text.primary, fontSize: depth === 0 ? 18 : 13 }}
              >
                {OBJECTIVE}
              </div>
            </div>

            {/* D0 — the scorecard: how readiness is composed */}
            {depth === 0 && (
              <Scorecard readiness={readiness} rows={rows} gapLayer={gapLayer} />
            )}

            {/* D1+ — the layer shelves */}
            {depth >= 1 && (
              <div className="relative mt-6 w-full max-w-[1040px] flex-shrink-0">
                {/* Column headers — categorize the two regions. */}
                <div className="mb-2 flex items-end gap-3 px-1">
                  <div className="flex-1">
                    <div
                      className="text-[10px] font-bold uppercase tracking-[0.16em]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      Causal layers
                    </div>
                    <div className="text-[10.5px]" style={{ color: appleVibe.text.faint }}>
                      foundation → outcome · scored by completion × weight
                    </div>
                  </div>
                  {depth >= 2 && (
                    <div className="w-[300px] flex-shrink-0">
                      <div
                        className="text-[10px] font-bold uppercase tracking-[0.16em]"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        Bets · {BETS.length}
                      </div>
                      <div className="text-[10.5px]" style={{ color: appleVibe.text.faint }}>
                        sub-objectives, on the layer they move
                      </div>
                    </div>
                  )}
                </div>
                {shelvesTopDown.map((layer, i) => {
                  const meta = ARCHETYPE[layer.archetype];
                  const row = rows.find((r) => r.layer.ordinal === layer.ordinal)!;
                  const betsHere = betsByOrdinal.get(layer.ordinal) ?? [];
                  const sortedBets = [...betsHere].sort((a, b) => leverage(b) - leverage(a));
                  const heroBet = sortedBets[0];
                  const secondaryBets = sortedBets.slice(1);
                  const uncovered = depth >= 2 && betsHere.length === 0;
                  const isGap = layer.ordinal === gapLayer;

                  return (
                    <div key={layer.ordinal}>
                      {i > 0 && (
                        <InfluenceConnector
                          verb={
                            INFLUENCES.find(
                              (f) => f.to === shelvesTopDown[i - 1].ordinal && f.from === layer.ordinal,
                            )?.verb ?? "enables"
                          }
                        />
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 16, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: i * 0.06, duration: 0.42, ease: EASE }}
                        className="flex items-stretch gap-3"
                      >
                        <LayerShelf
                          layer={layer}
                          meta={meta}
                          completion={row.completion}
                          pts={row.pts}
                          dims={row.dims}
                          isGap={isGap}
                          expanded={expandedLayer === layer.ordinal}
                          onToggle={() =>
                            setExpandedLayer(expandedLayer === layer.ordinal ? null : layer.ordinal)
                          }
                        />
                        {depth >= 2 && (
                          <div className="flex w-[300px] flex-shrink-0 items-center">
                            {uncovered ? (
                              <motion.button
                                type="button"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed py-3 text-[11.5px] font-semibold transition-colors hover:bg-white/60"
                                style={{ borderColor: `${meta.color}55`, color: meta.color }}
                              >
                                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                                nothing here yet — add a bet
                              </motion.button>
                            ) : (
                              <div className="flex w-full flex-col gap-1.5">
                                {heroBet && (
                                  <BetCard
                                    bet={heroBet}
                                    color={meta.color}
                                    hero
                                    onClick={() => {
                                      setFocusBetId(heroBet.id);
                                      setDepthClamped(3);
                                    }}
                                  />
                                )}
                                {secondaryBets.slice(0, 2).map((b) => (
                                  <BetMiniRow
                                    key={b.id}
                                    bet={b}
                                    color={meta.color}
                                    onClick={() => {
                                      setFocusBetId(b.id);
                                      setDepthClamped(3);
                                    }}
                                  />
                                ))}
                                {secondaryBets.length > 2 && (
                                  <span
                                    className="pl-1 text-[10.5px] font-semibold"
                                    style={{ color: appleVibe.text.faint }}
                                  >
                                    +{secondaryBets.length - 2} more bet
                                    {secondaryBets.length - 2 === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    </div>
                  );
                })}
                {depth >= 2 && (
                  <div className="mt-3 text-center text-[11px]" style={{ color: appleVibe.text.faint }}>
                    Click a bet to dig into its levers →
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* D3–D5 — the focused bet's room, progressively detailed:
            Levers (inventory) → Plays (chains + loop) → Proof (rigor). */}
        {depth >= 3 && (
          <RoomView
            bet={focusBet}
            room={ROOMS[focusBet.id]}
            depth={depth}
            onBack={() => setDepthClamped(2)}
          />
        )}
      </div>

      {/* Depth dial */}
      <div className="fixed right-5 top-1/2 z-30 -translate-y-1/2">
        <div
          className="flex flex-col gap-1 rounded-2xl p-2"
          style={{
            background: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(15,23,42,0.08)",
            boxShadow: "0 18px 48px -16px rgba(11,18,40,0.26)",
            backdropFilter: "blur(12px)",
          }}
        >
          {DEPTHS.map((notch) => {
            const active = notch.d === depth;
            return (
              <button
                key={notch.d}
                type="button"
                disabled={notch.locked}
                onClick={() => !notch.locked && setDepthClamped(notch.d)}
                className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-all duration-150"
                style={{
                  background: active ? appleVibe.accent.primary : "transparent",
                  cursor: notch.locked ? "not-allowed" : "pointer",
                  opacity: notch.locked ? 0.32 : 1,
                }}
              >
                <span
                  className="grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold"
                  style={{
                    background: active ? "rgba(255,255,255,0.25)" : "rgba(15,23,42,0.06)",
                    color: active ? "white" : appleVibe.text.tertiary,
                  }}
                >
                  {notch.d}
                </span>
                <span className="text-[11.5px] font-semibold" style={{ color: active ? "white" : appleVibe.text.secondary }}>
                  {notch.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Orb ──────────────────────────────────────────────────────────────────
function Orb({ readiness, big }: { readiness: number; big: boolean }) {
  const size = big ? 184 : 122;
  const pct = Math.round(readiness);
  return (
    <div
      className="relative flex items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 35% 30%, #94A3B8 0%, #475569 55%, #475569 100%)",
        boxShadow: "0 30px 80px -20px rgba(71,85,105,0.55), inset 0 2px 12px rgba(255,255,255,0.35)",
        transition: "width 0.5s, height 0.5s",
      }}
    >
      <svg className="absolute inset-0" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(readiness / 100) * 289} 289`}
        />
      </svg>
      <div className="px-5 text-center">
        <div className={`${big ? "text-[30px]" : "text-[22px]"} font-bold leading-none text-white`}>{pct}%</div>
        <div className="mt-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-white/75">readiness</div>
      </div>
    </div>
  );
}

// ── Scorecard (D0) — the composition of the readiness number ─────────────
function Scorecard({
  readiness,
  rows,
  gapLayer,
}: {
  readiness: number;
  rows: { layer: Layer; completion: number; pts: number; dims: ReturnType<typeof layerDims> }[];
  gapLayer: number;
}) {
  const ordered = [...rows].sort((a, b) => b.layer.ordinal - a.layer.ordinal);
  const gap = rows.find((r) => r.layer.ordinal === gapLayer)!;
  // Plain div (not motion): this mounts at the initial depth-0 render and
  // again on every return to D0. framer-motion's enter animation doesn't
  // reliably replay on remount under React 19, which left it stuck at
  // opacity:0. Rendering it statically guarantees it's always visible.
  return (
    <div
      className="mt-7 w-full max-w-[640px] flex-shrink-0 rounded-3xl p-5"
      style={{
        background: "rgba(255,255,255,0.94)",
        border: "1px solid rgba(15,23,42,0.07)",
        boxShadow: "0 1px 2px rgba(11,18,40,0.05), 0 22px 60px -28px rgba(11,18,40,0.3)",
      }}
    >
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-semibold" style={{ color: appleVibe.text.primary }}>
          How readiness is composed
        </div>
        <div className="text-[10.5px] font-medium" style={{ color: appleVibe.text.faint }}>
          Σ (completion × weight) across {rows.length} layers
        </div>
      </div>

      <div className="mt-1 text-[10.5px] leading-snug" style={{ color: appleVibe.text.faint }}>
        <strong style={{ color: appleVibe.text.tertiary }}>Completion</strong> = how
        built-out a layer is (Mapped · Addressed · Proven).{" "}
        <strong style={{ color: appleVibe.text.tertiary }}>Weight</strong> = its causal
        connectivity — the share of influence arrows touching it.
      </div>

      {/* composition bar — each layer a segment sized by its points */}
      <div className="mt-3 flex h-7 w-full overflow-hidden rounded-lg" style={{ background: "rgba(15,23,42,0.05)" }}>
        {ordered.map((r) => {
          const meta = ARCHETYPE[r.layer.archetype];
          return (
            <div
              key={r.layer.ordinal}
              title={`${r.layer.name}: ${r.pts.toFixed(1)} pts`}
              style={{
                width: `${r.pts}%`,
                background: meta.color,
                borderRight: "2px solid white",
              }}
            />
          );
        })}
      </div>

      {/* table */}
      <div className="mt-4 flex flex-col gap-2">
        {ordered.map((r) => {
          const meta = ARCHETYPE[r.layer.archetype];
          const isGap = r.layer.ordinal === gapLayer;
          return (
            <div key={r.layer.ordinal} className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: meta.color }} />
              <span className="w-[96px] flex-shrink-0 text-[12px] font-semibold" style={{ color: appleVibe.text.primary }}>
                {r.layer.name}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(15,23,42,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${r.completion * 100}%`, background: meta.color }} />
              </div>
              <span className="w-[42px] flex-shrink-0 text-right text-[11px] font-semibold" style={{ color: appleVibe.text.secondary }}>
                {Math.round(r.completion * 100)}%
              </span>
              <span
                className="flex w-[84px] flex-shrink-0 flex-col items-end leading-tight"
                title={`${degreeOf(r.layer.ordinal)} influence arrows touch this layer`}
              >
                <span className="text-[10.5px] font-medium" style={{ color: appleVibe.text.faint }}>
                  × {Math.round(weightOf(r.layer.ordinal) * 100)}%
                </span>
                <span className="text-[8.5px]" style={{ color: appleVibe.text.faint, opacity: 0.7 }}>
                  {degreeOf(r.layer.ordinal)} links
                </span>
              </span>
              <span className="w-[46px] flex-shrink-0 text-right text-[11.5px] font-bold tabular-nums" style={{ color: isGap ? "#EF4444" : meta.color }}>
                {r.pts.toFixed(1)}
              </span>
            </div>
          );
        })}
        {/* total */}
        <div className="mt-1 flex items-center gap-3 border-t pt-2" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <span className="w-[96px] flex-shrink-0 pl-[22px] text-[12px] font-bold" style={{ color: appleVibe.text.primary }}>
            Readiness
          </span>
          <div className="flex-1" />
          <span className="text-[13px] font-bold" style={{ color: appleVibe.accent.primary }}>
            {Math.round(readiness)} / 100
          </span>
        </div>
      </div>

      {/* gap insight */}
      <div
        className="mt-4 flex items-start gap-2 rounded-2xl p-3"
        style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)" }}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: "#EF4444" }} strokeWidth={2.2} />
        <div className="text-[11.5px] leading-snug" style={{ color: "#7F1D1D" }}>
          <strong>{gap.layer.name}</strong> is your biggest gap — it carries{" "}
          <strong>{Math.round(weightOf(gap.layer.ordinal) * 100)}%</strong> of the weight but only{" "}
          <strong>{Math.round(gap.completion * 100)}%</strong> complete, contributing just{" "}
          <strong>{gap.pts.toFixed(1)} pts</strong>. Closing it is the highest-leverage move.
        </div>
      </div>
    </div>
  );
}

// ── Completion bar (Mapped / Addressed / Proven sub-criteria) ────────────
function CompletionBar({
  completion,
  dims,
  color,
}: {
  completion: number;
  dims: ReturnType<typeof layerDims>;
  color: string;
}) {
  const sub: { key: keyof typeof dims; label: string }[] = [
    { key: "mapped", label: "Mapped" },
    { key: "addressed", label: "Addressed" },
    { key: "proven", label: "Proven" },
  ];
  return (
    <div className="flex items-center gap-3">
      {/* overall */}
      <div className="flex items-center gap-2">
        <div className="relative h-2 w-24 overflow-hidden rounded-full" style={{ background: "rgba(15,23,42,0.07)" }}>
          <div className="h-full rounded-full" style={{ width: `${completion * 100}%`, background: color }} />
        </div>
        <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
          {Math.round(completion * 100)}%
        </span>
      </div>
      {/* sub-criteria */}
      <div className="flex items-center gap-2.5">
        {sub.map((s) => (
          <div key={s.key} className="flex items-center gap-1">
            <span className="text-[8.5px] font-semibold uppercase tracking-wide" style={{ color: appleVibe.text.faint }}>
              {s.label[0]}
            </span>
            <div className="relative h-1.5 w-7 overflow-hidden rounded-full" style={{ background: "rgba(15,23,42,0.07)" }}>
              <div className="h-full rounded-full" style={{ width: `${dims[s.key] * 100}%`, background: `${color}AA` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Layer shelf ──────────────────────────────────────────────────────────
function LayerShelf({
  layer,
  meta,
  completion,
  pts,
  dims,
  isGap,
  expanded,
  onToggle,
}: {
  layer: Layer;
  meta: { color: string; Icon: typeof Layers; label: string };
  completion: number;
  pts: number;
  dims: ReturnType<typeof layerDims>;
  isGap: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hero = layer.variables[0];
  const rest = layer.variables.slice(1);
  return (
    <div
      className="group flex-1 rounded-2xl px-4 py-3 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "rgba(255,255,255,0.95)",
        border: `1px solid ${isGap ? "#EF444455" : "rgba(15,23,42,0.07)"}`,
        boxShadow: isGap
          ? "0 0 0 2px rgba(239,68,68,0.12), 0 14px 34px -16px rgba(239,68,68,0.4)"
          : "0 1px 2px rgba(11,18,40,0.05), 0 12px 30px -18px rgba(11,18,40,0.22)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg" style={{ background: `${meta.color}1A`, color: meta.color }}>
            <meta.Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          <span className="text-[14px] font-semibold" style={{ color: appleVibe.text.primary }}>
            {layer.name}
          </span>
          <span className="rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ background: `${meta.color}14`, color: meta.color }}>
            {meta.label}
          </span>
          {isGap && (
            <span className="rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em]" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
              biggest gap
            </span>
          )}
        </div>
        {/* contribution */}
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-medium"
            style={{ color: appleVibe.text.faint }}
            title={`${degreeOf(layer.ordinal)} influence arrows touch this layer`}
          >
            weight {Math.round(weightOf(layer.ordinal) * 100)}% · {degreeOf(layer.ordinal)} links
          </span>
          <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums" style={{ background: `${meta.color}14`, color: meta.color }}>
            {pts.toFixed(1)} pts
          </span>
        </div>
      </div>

      {/* completion composition */}
      <div className="mt-2.5">
        <CompletionBar completion={completion} dims={dims} color={meta.color} />
      </div>

      {/* features */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <VarChip v={hero} color={meta.color} hero />
        {expanded ? (
          <>
            {rest.map((v) => (
              <VarChip key={v.id} v={v} color={meta.color} />
            ))}
            <button type="button" onClick={onToggle} className="text-[11px] font-medium" style={{ color: appleVibe.text.faint }}>
              collapse
            </button>
          </>
        ) : (
          rest.length > 0 && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
              style={{ background: "rgba(15,23,42,0.05)", color: appleVibe.text.secondary }}
            >
              +{rest.length} feature{rest.length === 1 ? "" : "s"}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function VarChip({ v, color, hero }: { v: Variable; color: string; hero?: boolean }) {
  const sm = STATE_META[v.state];
  if (hero) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: color, color: "white" }}>
        <Sparkles className="h-3 w-3" strokeWidth={2.4} />
        {v.name}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
      style={{ background: `${color}10`, color: appleVibe.text.secondary }}
      title={sm.label}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: sm.color }} />
      {v.name}
    </span>
  );
}

// ── Influence connector between shelves ──────────────────────────────────
function InfluenceConnector({ verb }: { verb: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-1" style={{ paddingRight: 312 }}>
      <ArrowUp className="h-3 w-3" style={{ color: "rgba(15,23,42,0.3)" }} strokeWidth={2.4} />
      <span className="text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(15,23,42,0.34)" }}>
        {verb}
      </span>
    </div>
  );
}

// ── Secondary bet row — readable (not a "+N" count) for non-hero bets ────
function BetMiniRow({ bet, color, onClick }: { bet: Bet; color: string; onClick?: () => void }) {
  const healthColor = bet.health >= 0.66 ? "#10B981" : bet.health >= 0.4 ? "#F59E0B" : "#EF4444";
  const span = [...bet.layerOrdinals].sort((a, b) => a - b);
  const isLeverage = span.length > 1;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-transform hover:-translate-y-px"
      style={{ background: "white", border: `1px solid ${color}22`, cursor: "pointer" }}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: healthColor }} />
      <span className="flex-1 truncate text-[11.5px] font-medium" style={{ color: "#0B1228" }}>
        {bet.title}
      </span>
      {isLeverage && <Sparkles className="h-3 w-3 flex-shrink-0" style={{ color }} strokeWidth={2.2} />}
      <span className="flex-shrink-0 text-[9.5px] font-semibold" style={{ color: appleVibe.text.faint }}>
        {Math.round(bet.health * 100)}%
      </span>
      <ChevronRight className="h-3 w-3 flex-shrink-0" style={{ color: "rgba(15,23,42,0.3)" }} strokeWidth={2.2} />
    </motion.button>
  );
}

// ── Bet card ──────────────────────────────────────────────────────────────
function BetCard({
  bet,
  color,
  hero,
  onClick,
}: {
  bet: Bet;
  color: string;
  hero?: boolean;
  onClick?: () => void;
}) {
  const healthColor = bet.health >= 0.66 ? "#10B981" : bet.health >= 0.4 ? "#F59E0B" : "#EF4444";
  const span = [...bet.layerOrdinals].sort((a, b) => a - b);
  const spanLabel =
    span.length === 1
      ? `L${span[0]} · Direct`
      : span[1] - span[0] === 1
        ? `L${span[0]}→L${span[1]} · Bridge`
        : `L${span[0]}+${span[1]} · Span`;
  const isLeverage = span.length > 1;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: 24, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="flex-1 rounded-2xl px-3 py-2.5 text-left transition-transform hover:-translate-y-0.5"
      style={{
        background: "white",
        border: `1px solid ${hero ? color + "55" : "rgba(15,23,42,0.08)"}`,
        boxShadow: hero ? `0 10px 26px -12px ${color}66` : "0 6px 18px -10px rgba(11,18,40,0.2)",
        cursor: "pointer",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-semibold leading-tight" style={{ color: "#0B1228" }}>
          {bet.title}
        </span>
        {isLeverage && <Sparkles className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} strokeWidth={2.2} />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold" style={{ background: `${color}14`, color }}>
          {spanLabel}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: healthColor }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: healthColor }} />
          {Math.round(bet.health * 100)}%
        </span>
        <span className="flex items-center gap-0.5 text-[10px] font-medium" style={{ color: "rgba(15,23,42,0.45)" }}>
          {bet.chains} chain{bet.chains === 1 ? "" : "s"}
          <ChevronRight className="h-3 w-3" strokeWidth={2.2} />
        </span>
      </div>
    </motion.button>
  );
}

// ── D3–D5 — the focused bet's room, progressively detailed ───────────────
//   D3 Levers: inventory columns (pains / mechanisms / outcomes)
//   D4 Plays:  directed causal chains (pain → mechanism → outcome) + loop
//   D5 Proof:  + rigor tier per play, unproven plays ghosted, validated count
// Plain divs (no motion enter) so it never sticks at opacity:0 on remount.
function RoomView({
  bet,
  room,
  depth,
  onBack,
}: {
  bet: Bet;
  room?: Room;
  depth: number;
  onBack: () => void;
}) {
  const depthLabel = depth === 3 ? "Levers" : depth === 4 ? "Plays" : "Proof";
  if (!room) {
    return (
      <div className="mt-10 flex flex-col items-center gap-3">
        <div className="text-[14px] font-semibold" style={{ color: appleVibe.text.secondary }}>
          {bet.title}
        </div>
        <div className="text-[12px]" style={{ color: appleVibe.text.faint }}>
          Levers not mapped for this bet yet — open one with a room (e.g. “Stabilize afternoon glucose”).
        </div>
        <button type="button" onClick={onBack} className="text-[12px] font-semibold" style={{ color: appleVibe.accent.primary }}>
          ← back to bets
        </button>
      </div>
    );
  }
  const cols: { key: keyof Room; title: string; color: string; items: RoomItem[] }[] = [
    { key: "pains", title: "Pains", color: "#EF4444", items: room.pains },
    { key: "mechanisms", title: "Mechanisms", color: "#475569", items: room.mechanisms },
    { key: "outcomes", title: "Outcomes", color: "#10B981", items: room.outcomes },
  ];
  const find = (id: string) =>
    [...room.pains, ...room.mechanisms, ...room.outcomes].find((i) => i.id === id);
  const isValidated = (c: Chain) => {
    const m = room.mechanisms.find((x) => x.id === c.mechId);
    return !!m && (m.state === "proven" || m.state === "addressed");
  };
  const validatedCount = room.chains.filter(isValidated).length;

  return (
    <div className="w-full max-w-[1040px] flex-shrink-0">
      {/* breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-[12px]" style={{ color: appleVibe.text.tertiary }}>
        <button type="button" onClick={onBack} className="font-semibold hover:underline" style={{ color: appleVibe.accent.primary }}>
          Objective
        </button>
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
        <span className="font-semibold" style={{ color: appleVibe.text.primary }}>
          {bet.title}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide" style={{ background: "rgba(71,85,105,0.1)", color: appleVibe.accent.primary }}>
          {depthLabel}
        </span>
        {depth === 5 && (
          <span className="ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(16,185,129,0.1)", color: "#059669" }}>
            {validatedCount}/{room.chains.length} plays validated
          </span>
        )}
      </div>

      {depth === 3 ? (
        /* D3 — inventory columns */
        <div className="flex items-stretch gap-3">
          {cols.map((col, ci) => (
            <div key={col.key} className="flex flex-1 items-center gap-3">
              <div
                className="flex-1 rounded-2xl p-3"
                style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 12px 30px -18px rgba(11,18,40,0.22)" }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: col.color }}>
                    {col.title}
                  </span>
                  <span className="text-[10px] font-medium" style={{ color: appleVibe.text.faint }}>
                    {col.items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {col.items.map((it) => {
                    const isHero = col.key === "mechanisms" && it.id === room.heroMechanismId;
                    const sm = it.state ? STATE_META[it.state] : null;
                    return (
                      <div
                        key={it.id}
                        className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[12px] font-medium"
                        style={{
                          background: isHero ? col.color : `${col.color}0D`,
                          color: isHero ? "white" : "#0B1228",
                          border: isHero ? "none" : `1px solid ${col.color}1F`,
                        }}
                      >
                        <span className="flex items-center gap-1.5">
                          {isHero && <Sparkles className="h-3 w-3" strokeWidth={2.4} />}
                          {it.name}
                        </span>
                        {sm && (
                          <span
                            className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase"
                            style={{
                              background: isHero ? "rgba(255,255,255,0.25)" : `${sm.color}1A`,
                              color: isHero ? "white" : sm.color,
                            }}
                          >
                            {sm.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {ci < cols.length - 1 && (
                <ArrowRight className="h-5 w-5 flex-shrink-0" style={{ color: "rgba(15,23,42,0.25)" }} strokeWidth={2} />
              )}
            </div>
          ))}
        </div>
      ) : (
        /* D4 / D5 — causal chains (pain → mechanism → outcome) */
        <div className="flex flex-col gap-2.5">
          <div className="mb-1 grid grid-cols-[1fr_40px_1fr_40px_1fr] gap-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: appleVibe.text.faint }}>
            <span style={{ color: "#EF4444" }}>Pain</span>
            <span />
            <span style={{ color: "#475569" }}>Mechanism</span>
            <span />
            <span style={{ color: "#10B981" }}>Outcome</span>
          </div>
          {room.chains.map((c) => (
            <ChainRow
              key={c.id}
              chain={c}
              pain={find(c.painId)}
              mech={room.mechanisms.find((m) => m.id === c.mechId)}
              out={find(c.outcomeId)}
              heroMechId={room.heroMechanismId}
              showProof={depth === 5}
              ghosted={depth === 5 && !isValidated(c)}
            />
          ))}
          {room.loopLabel && (
            <div
              className="mt-1 flex items-center gap-2 rounded-2xl px-3.5 py-2.5"
              style={{ background: "rgba(71,85,105,0.06)", border: "1px solid rgba(71,85,105,0.18)" }}
            >
              <RefreshCw className="h-4 w-4 flex-shrink-0" style={{ color: appleVibe.accent.primary }} strokeWidth={2.2} />
              <span className="text-[11.5px]" style={{ color: appleVibe.text.secondary }}>
                <strong style={{ color: appleVibe.accent.primary }}>Reinforcing loop</strong> · {room.loopLabel}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 text-center text-[11px]" style={{ color: appleVibe.text.faint }}>
        {depth === 3 && "Scroll deeper → Plays wires these into directed causal chains + the loop"}
        {depth === 4 && "Scroll deeper → Proof scores each play's rigor and ghosts the unproven"}
        {depth === 5 && "Solid plays are evidence-backed · ghosted plays are still assumptions to test"}
      </div>
    </div>
  );
}

function ChainRow({
  chain,
  pain,
  mech,
  out,
  heroMechId,
  showProof,
  ghosted,
}: {
  chain: Chain;
  pain?: RoomItem;
  mech?: RoomItem;
  out?: RoomItem;
  heroMechId: string;
  showProof: boolean;
  ghosted: boolean;
}) {
  const tier = mech?.state ?? "open";
  const sm = STATE_META[tier];
  const validated = tier === "proven" || tier === "addressed";
  return (
    <div
      className="grid grid-cols-[1fr_40px_1fr_40px_1fr] items-center gap-2 rounded-2xl px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.96)",
        border: `1px ${ghosted ? "dashed" : "solid"} rgba(15,23,42,0.08)`,
        boxShadow: ghosted ? "none" : "0 10px 26px -18px rgba(11,18,40,0.2)",
        opacity: ghosted ? 0.55 : 1,
      }}
    >
      <ChainChip label={pain?.name ?? "?"} color="#EF4444" />
      <ChainArrow polarity={chain.polarity} strength={chain.strength} />
      <ChainChip label={mech?.name ?? "?"} color="#475569" hero={mech?.id === heroMechId} />
      <ChainArrow polarity={chain.polarity} strength={chain.strength} />
      <div className="flex items-center gap-1.5">
        <ChainChip label={out?.name ?? "?"} color="#10B981" />
        {chain.inLoop && (
          <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" style={{ color: appleVibe.accent.primary }} strokeWidth={2.2} />
        )}
        {showProof && (
          <span
            className="flex flex-shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-[8.5px] font-bold uppercase tracking-wide"
            style={{ background: `${sm.color}1A`, color: sm.color }}
          >
            {validated && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
            {sm.label}
          </span>
        )}
      </div>
    </div>
  );
}

function ChainChip({ label, color, hero }: { label: string; color: string; hero?: boolean }) {
  return (
    <span
      className="truncate rounded-xl px-2.5 py-2 text-[12px] font-medium"
      style={{
        background: hero ? color : `${color}0D`,
        color: hero ? "white" : "#0B1228",
        border: hero ? "none" : `1px solid ${color}1F`,
      }}
      title={label}
    >
      {hero ? "★ " : ""}
      {label}
    </span>
  );
}

function ChainArrow({ polarity, strength }: { polarity: "+" | "-"; strength: number }) {
  const color = polarity === "+" ? "#10B981" : "#EF4444";
  return (
    <span
      className="flex items-center justify-center gap-0.5"
      title={`${polarity === "+" ? "positive" : "negative"} · strength ${Math.round(strength * 100)}%`}
    >
      <span className="text-[10px] font-bold leading-none" style={{ color }}>
        {polarity}
      </span>
      <span className="rounded-full" style={{ width: 12, height: 1 + strength * 3, background: color }} />
      <ArrowRight className="-ml-1 h-3.5 w-3.5" style={{ color }} strokeWidth={2.6} />
    </span>
  );
}
