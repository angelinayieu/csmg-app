"use client";

// ── Annotated Objective Card (v2) ──
//
// Replaces the plain core-objective node on the main canvas with the
// user's typed objective rendered as an annotated artifact — phrases
// wear weighted dotted underlines colored by layer; hovering a
// phrase opens a rich tabbed annotation popover.
//
// Resting:
//   - Phrase weight maps to underline thickness (0.6px → 2.4px)
//     so the text is also a heatmap of what the AI thinks matters
//     most.
//   - When an annotation has a `like` analogy, a tiny faint glyph
//     drifts beside the phrase — pattern handle the eye learns over
//     time ("↻ = loop pattern").
//   - On mount, underlines paint in left-to-right with a subtle
//     shimmer so the user feels the AI reading.
//   - "AI reading · on" pill in the top-right reveals margin notes.
//
// Hover/focus a phrase:
//   - Tabbed popover [Read] [Like] [How] [Stakes] [⚠]
//     Tabs only appear when their content exists. Default tab is the
//     richest one for that annotation.
//   - Phrases this annotation tensions/harmonizes with get a faint
//     glow on the canvas while hovering — surfaces the objective's
//     internal coherence map.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Cog,
  GitCompare,
  Layers as LayersIcon,
  RefreshCw,
  Sparkles,
  Star,
  Target,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { ObjectiveCore } from "@/components/objective/icons/objective-core";
import {
  AnnotationGlyph,
  type GlyphKind,
} from "@/components/objective/icons/annotation-glyphs";
import { AnnotationCompareModal } from "@/components/objective/annotation-compare-modal";
import type {
  AnnotationVersion,
  ArbitrationRecord,
} from "@/lib/objective-canvas/annotation-versions";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";

// ── Types ──────────────────────────────────────────────────────────

export type AnnotationLayerTag =
  | "features"
  | "outcomes"
  | "pain"
  | "objective"
  | null;

export interface AnnotationExtension {
  name: string;
  why: string;
}

export interface AnnotationAnalogy {
  referent: string;
  domain: string;
  glyph: GlyphKind;
  why_same: string;
  why_differs: string | null;
  extensions: AnnotationExtension[];
  generativity: number;
}

export interface AnnotationTension {
  phrase: string;
  kind: "tension" | "harmony";
  note: string;
}

export interface AnnotationFragility {
  when: string;
  why: string;
  sign: string;
}

export type AnnotationScope = "word" | "phrase";

export interface AnnotationDimension {
  name: string;
  why: string;
}

export interface AnnotationChainHop {
  step: string;
  via: string;
}

export interface ObjectiveAnnotation {
  phrase: string;
  start_offset: number;
  end_offset: number;
  scope: AnnotationScope;
  reading: string;
  weight: number;
  /** v3 — factors that compose this concept's meaning. Rich on
   *  word-scope annotations; usually empty for phrase-scope. */
  dimensions: AnnotationDimension[];
  /** v3 — causal hops from this concept to ultimate impact. */
  inference_chain: AnnotationChainHop[];
  not_reading: string | null;
  crystal: string | null;
  confidence: number | null;
  /** 3-5 analogies from distant domains. Replaces the v3 single
   *  `like` field; old payloads with `like` are migrated by the
   *  server into a single-entry `analogies[]`. */
  analogies: AnnotationAnalogy[];
  mechanism: string | null;
  frame: string | null;
  stakes: string | null;
  /** Structured pre-mortem — when / why / sign. Replaces legacy
   *  single-string fragility (still rendered if only `when` is set
   *  for migration of old payloads). */
  fragility: AnnotationFragility | null;
  tensions: AnnotationTension[];
  linked_sub_objective_id: string | null;
  layer_tag: AnnotationLayerTag;
}

interface SubObjectiveStub {
  id: string;
  title: string;
}

interface Props {
  spaceId: string;
  objective: string;
  initialAnnotations: ObjectiveAnnotation[];
  subObjectives: SubObjectiveStub[];
  /** When false, the centered "Core Objective" eyebrow is suppressed so
   *  a host (the main-canvas header) can own the identity label and the
   *  card aligns flush under a single coordinated toolbar. */
  showEyebrow?: boolean;
}

// ── Layer styling ──────────────────────────────────────────────────

const LAYER_COLOR: Record<Exclude<AnnotationLayerTag, null>, string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

const NEUTRAL_COLOR = "rgba(15,23,42,0.45)";

function colorForTag(tag: AnnotationLayerTag): string {
  return tag ? LAYER_COLOR[tag] : NEUTRAL_COLOR;
}

/** Map weight 0..1 → underline thickness in px. Floor at 0.8 so
 *  every annotation is visible; ceiling at 2.4 keeps text legible. */
function underlineThickness(weight: number): number {
  const w = Math.max(0, Math.min(1, weight));
  return Math.round((0.8 + w * 1.6) * 10) / 10;
}

// ── Component ─────────────────────────────────────────────────────

export function AnnotatedObjectiveCard({
  spaceId,
  objective,
  initialAnnotations,
  subObjectives,
  showEyebrow = true,
}: Props) {
  const reduce = useReducedMotion();
  // Defense-in-depth: normalize on the way in even though the server route
  // already normalizes. Cheap, and guards against props passed by other
  // hosts (the embedded contract in [spaceId]/page.tsx exposes this card
  // to integration points that may not run the normalizer themselves).
  const [annotations, setAnnotations] = useState<ObjectiveAnnotation[]>(() =>
    normalizeAnnotations(initialAnnotations),
  );
  const [reading, setReading] = useState(false); // margin-notes toggle
  const [hovered, setHovered] = useState<number | null>(null);
  const [paintedCount, setPaintedCount] = useState(0);
  const [loading, setLoading] = useState(initialAnnotations.length === 0);
  const fetchedRef = useRef(false);

  // ── Versions state (Deepen / Compare / Synthesize loop) ──
  const [versions, setVersions] = useState<AnnotationVersion[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [deepening, setDeepening] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [deepenError, setDeepenError] = useState<string | null>(null);

  async function loadVersions() {
    if (versions !== null || versionsLoading) return;
    setVersionsLoading(true);
    try {
      const res = await fetch(
        `/api/brainstorm/annotations/versions?spaceId=${encodeURIComponent(spaceId)}`,
      );
      const json = await res.json();
      if (res.ok && Array.isArray(json.versions)) {
        setVersions(json.versions);
      }
    } catch (err) {
      console.warn("[AnnotatedObjective] versions load failed", err);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function runDeepen() {
    setDeepening(true);
    setDeepenError(null);
    try {
      const res = await fetch("/api/brainstorm/annotations/deepen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDeepenError(json?.error ?? "Deepen failed.");
        return;
      }
      setAnnotations(json.annotations);
      // Force version reload next time the user interacts.
      setVersions(null);
    } catch (err) {
      setDeepenError(
        err instanceof Error ? err.message : "Network error.",
      );
    } finally {
      setDeepening(false);
    }
  }

  function openCompare() {
    setCompareOpen(true);
    void loadVersions();
  }

  function handleSynthesized(
    newAnnotations: ObjectiveAnnotation[],
    arbitration: ArbitrationRecord[],
    newVersionId: string,
  ) {
    setAnnotations(newAnnotations);
    setVersions(null);
    // arbitration + newVersionId are unused at this layer — they
    // live in the version history loaded on next compare. Voiding
    // here to keep the typecheck honest.
    void arbitration;
    void newVersionId;
  }

  const subTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subObjectives) m.set(s.id, s.title);
    return m;
  }, [subObjectives]);

  // Map phrase text → annotation index so tensions can resolve which
  // phrases to glow when hovering.
  const indexByPhrase = useMemo(() => {
    const m = new Map<string, number>();
    annotations.forEach((a, i) => {
      m.set(a.phrase.toLowerCase().trim(), i);
    });
    return m;
  }, [annotations]);

  // Set of annotation indices to highlight as "linked" (tension or
  // harmony) when something is hovered.
  const linkedIndices = useMemo(() => {
    if (hovered === null) return new Set<number>();
    const out = new Set<number>();
    const a = annotations[hovered];
    if (!a) return out;
    for (const t of a.tensions) {
      const idx = indexByPhrase.get(t.phrase.toLowerCase().trim());
      if (idx !== undefined && idx !== hovered) out.add(idx);
    }
    return out;
  }, [hovered, annotations, indexByPhrase]);

  // ── Lazy generation ──
  useEffect(() => {
    if (fetchedRef.current) return;
    if (initialAnnotations.length > 0) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/brainstorm/annotations/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, mode: "initial" }),
        });
        const json = await res.json();
        if (res.ok && Array.isArray(json.annotations)) {
          // API cache short-circuit returns raw DB annotations untouched —
          // may be in v2 shape. Normalize before handing to the renderer.
          setAnnotations(normalizeAnnotations(json.annotations));
        }
      } catch (err) {
        console.warn("[AnnotatedObjective] lazy generate failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [spaceId, initialAnnotations.length]);

  // ── Sequential paint-in ──
  useEffect(() => {
    if (annotations.length === 0) {
      setPaintedCount(0);
      return;
    }
    if (reduce) {
      setPaintedCount(annotations.length);
      return;
    }
    setPaintedCount(0);
    const interval = 80;
    const timers: ReturnType<typeof setTimeout>[] = [];
    annotations.forEach((_, i) => {
      timers.push(
        setTimeout(
          () => setPaintedCount((c) => Math.max(c, i + 1)),
          220 + i * interval,
        ),
      );
    });
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [annotations, reduce]);

  const segments = useMemo(
    () => buildSegments(objective, annotations),
    [objective, annotations],
  );
  const linkedCount = annotations.filter(
    (a) => a.linked_sub_objective_id,
  ).length;

  return (
    <div
      className="relative mx-auto w-full max-w-3xl"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* Eyebrow — suppressed when the host owns the identity label
          (e.g. the main-canvas unified header). */}
      {showEyebrow && (
        <div className="mb-3 flex items-center justify-center gap-2">
          {/* Luminous glass orb on a soft pedestal — tied to the objective
              layer by a violet bloom, not a bordered pill. Mirrors the
              unified header identity on the main canvas. */}
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: "rgba(255,255,255,0.72)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.9) inset, 0 5px 14px -6px rgba(124,58,237,0.5)",
            }}
            aria-hidden
          >
            <ObjectiveCore className="h-4 w-4" />
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "rgba(91,33,182,0.9)" }}
          >
            Core Objective
          </span>
        </div>
      )}

      {/* Card */}
      <div
        className="relative rounded-3xl"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.card,
          borderRadius: appleVibe.radius.xl,
          padding: "32px 36px 26px",
        }}
      >
        {/* Body */}
        <div
          className={
            reading
              ? "grid gap-x-8 md:grid-cols-[1fr_minmax(240px,280px)]"
              : ""
          }
        >
          <p
            className="text-[18px] font-medium leading-[1.65] tracking-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.005em",
            }}
          >
            {segments.map((seg, i) => {
              if (seg.type === "text") return <span key={i}>{seg.value}</span>;
              const idx = seg.annotationIndex;
              const a = annotations[idx];
              const painted = paintedCount > idx;
              if (!a) return <span key={i}>{seg.value}</span>;
              return (
                <AnnotatedMark
                  key={i}
                  annotation={a}
                  index={idx}
                  painted={painted}
                  hovered={hovered === idx}
                  linked={linkedIndices.has(idx)}
                  onHoverChange={(h) =>
                    setHovered(
                      h ? idx : (cur) => (cur === idx ? null : cur),
                    )
                  }
                  subTitle={
                    a.linked_sub_objective_id
                      ? subTitleById.get(a.linked_sub_objective_id) ?? null
                      : null
                  }
                  spaceId={spaceId}
                />
              );
            })}
          </p>

          {reading && (
            <div className="hidden md:block">
              <ul className="space-y-3">
                {annotations.map((a, idx) => {
                  const subTitle = a.linked_sub_objective_id
                    ? subTitleById.get(a.linked_sub_objective_id) ?? null
                    : null;
                  const color = colorForTag(a.layer_tag);
                  return (
                    <li
                      key={idx}
                      className="rounded-2xl p-3 transition-colors"
                      style={{
                        background:
                          hovered === idx
                            ? "rgba(15,23,42,0.04)"
                            : linkedIndices.has(idx)
                              ? "rgba(15,23,42,0.02)"
                              : "transparent",
                        border: `1px solid ${
                          hovered === idx
                            ? appleVibe.stroke.hairline
                            : "transparent"
                        }`,
                      }}
                      onMouseEnter={() => setHovered(idx)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          style={{ background: color }}
                          aria-hidden
                        />
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {a.phrase}
                        </span>
                        {a.crystal && (
                          <span
                            className="ml-auto rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
                            style={{
                              background: `${color}14`,
                              color,
                            }}
                          >
                            {a.crystal}
                          </span>
                        )}
                      </div>
                      <p
                        className="mt-1 text-[11.5px] font-light leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {a.reading}
                      </p>
                      {a.not_reading && (
                        <p
                          className="mt-0.5 text-[10.5px] font-light italic leading-snug"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          Not: {a.not_reading}
                        </p>
                      )}
                      {subTitle && a.linked_sub_objective_id && (
                        <Link
                          href={`#sub-${a.linked_sub_objective_id}`}
                          className="mt-1.5 inline-flex items-center gap-0.5 text-[10.5px] font-semibold"
                          style={{ color }}
                        >
                          {subTitle}
                          <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer — meta + Deepen / Compare controls */}
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4"
          style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <span
            className="text-[10.5px] font-medium uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {loading
              ? "Reading…"
              : annotations.length > 0
                ? `${annotations.length} phrases · ${linkedCount} link to sub-objectives`
                : "No annotations yet"}
          </span>
          {annotations.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setReading((v) => !v)}
                aria-pressed={reading}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors"
                style={{
                  background: reading
                    ? "rgba(15,23,42,0.92)"
                    : appleVibe.surface.chip,
                  color: reading
                    ? appleVibe.text.onAccent
                    : appleVibe.text.secondary,
                }}
                title={
                  reading
                    ? "Hide margin notes (hover a phrase still works)"
                    : "Show every AI reading as a note in the margin"
                }
              >
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2.25} />
                {reading ? "Notes on" : "Margin notes"}
              </button>
              <button
                type="button"
                onClick={runDeepen}
                disabled={deepening}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                style={{
                  background: deepening
                    ? appleVibe.surface.chip
                    : "rgba(15,23,42,0.06)",
                  color: appleVibe.text.secondary,
                  cursor: deepening ? "wait" : "pointer",
                }}
                title="Run the 7 deepening probes on this reading"
              >
                <RefreshCw
                  className="h-2.5 w-2.5"
                  strokeWidth={2}
                  style={{
                    transform: deepening ? "rotate(360deg)" : "none",
                    transition: "transform 1.6s linear",
                  }}
                />
                {deepening ? "Deepening…" : "Deepen"}
              </button>
              <button
                type="button"
                onClick={openCompare}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.secondary,
                }}
                title="Compare annotation versions side-by-side"
              >
                <GitCompare className="h-2.5 w-2.5" strokeWidth={2} />
                Compare versions
              </button>
            </div>
          )}
        </div>
        {deepenError && (
          <div
            role="alert"
            className="mt-2 rounded-lg px-3 py-2 text-[11.5px]"
            style={{
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.18)",
              color: "rgba(127,29,29,0.95)",
            }}
          >
            {deepenError}
          </div>
        )}
      </div>

      {/* Compare modal */}
      <AnnotationCompareModal
        open={compareOpen}
        spaceId={spaceId}
        versions={versions ?? []}
        onClose={() => setCompareOpen(false)}
        onSynthesized={handleSynthesized}
      />
    </div>
  );
}

// ── Inline mark with tabbed popover ────────────────────────────────

type TabKey = "read" | "layers" | "like" | "how" | "stakes" | "warn";

function availableTabs(a: ObjectiveAnnotation): TabKey[] {
  const tabs: TabKey[] = ["read"];
  if (a.dimensions.length > 0 || a.inference_chain.length > 0)
    tabs.push("layers");
  if (a.analogies.length > 0) tabs.push("like");
  if (a.mechanism || a.frame) tabs.push("how");
  if (a.stakes) tabs.push("stakes");
  if (a.fragility || a.tensions.some((t) => t.kind === "tension"))
    tabs.push("warn");
  return tabs;
}

/** Pick the tab that's richest for THIS annotation as default.
 *  Word-scope annotations strongly prefer Layers when present —
 *  it's the structured semantic breakdown the user is asking for. */
function defaultTab(a: ObjectiveAnnotation): TabKey {
  if (
    a.scope === "word" &&
    (a.dimensions.length > 0 || a.inference_chain.length > 0)
  ) {
    return "layers";
  }
  if (a.dimensions.length > 0 || a.inference_chain.length > 0)
    return "layers";
  if (a.analogies.length > 0) return "like";
  if (a.mechanism || a.frame) return "how";
  if (a.stakes) return "stakes";
  return "read";
}

function AnnotatedMark({
  annotation,
  index,
  painted,
  hovered,
  linked,
  onHoverChange,
  subTitle,
  spaceId,
}: {
  annotation: ObjectiveAnnotation;
  index: number;
  painted: boolean;
  hovered: boolean;
  /** True when this mark is hovered indirectly because another
   *  hovered annotation has a tension/harmony with it. */
  linked: boolean;
  onHoverChange: (hovered: boolean) => void;
  subTitle: string | null;
  spaceId: string;
}) {
  const color = colorForTag(annotation.layer_tag);
  const reduce = useReducedMotion();
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab(annotation));

  const tabs = useMemo(() => availableTabs(annotation), [annotation]);
  // If the active tab vanished (shouldn't normally happen), snap back.
  useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0]!);
  }, [tabs, activeTab]);

  const thickness = underlineThickness(annotation.weight);
  const isWord = annotation.scope === "word";

  return (
    <span
      className="relative inline"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      tabIndex={0}
    >
      <motion.span
        className="relative inline cursor-help"
        style={{
          color: hovered || linked ? color : "inherit",
          // Word-scope pill: saturated semi-transparent fill in the
          // layer color, like a real pastel highlighter mark on
          // paper. Earlier alphas (~9%) were too faint to read as
          // highlights — bumped to ~30-45% so the pill is
          // immediately visible without being obnoxious.
          //   resting → ~30% alpha   (hex 4D)
          //   hovered → ~52% alpha   (hex 85) — pulls forward on focus
          //   linked  → ~22% alpha   (hex 38) — paired across phrases
          background: isWord
            ? painted
              ? hovered
                ? `${color}85`
                : linked
                  ? `${color}38`
                  : `${color}4D`
              : "transparent"
            : "transparent",
          borderRadius: isWord ? 6 : 0,
          padding: isWord ? "1px 5px" : "0",
          margin: isWord ? "0 1px" : "0",
          boxShadow: isWord && hovered ? `inset 0 0 0 1px ${color}66` : "none",
          transition:
            "background 220ms ease, color 220ms ease, box-shadow 220ms ease",
        }}
      >
        {annotation.phrase}
        {/* Phrase-scope: weighted dotted underline */}
        {!isWord && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-0.5"
            style={{
              transformOrigin: "left center",
              height: 0,
              borderBottom: `${thickness}px dotted ${color}`,
            }}
            initial={false}
            animate={
              reduce
                ? { scaleX: painted ? 1 : 0 }
                : painted
                  ? { scaleX: 1, opacity: [0, 1, 0.6, 1] }
                  : { scaleX: 0, opacity: 0 }
            }
            transition={{
              scaleX: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
              opacity: { duration: 0.7, times: [0, 0.4, 0.7, 1] },
            }}
          />
        )}
        {/* Linked-glow when another hovered annotation tensions/harmonies */}
        <AnimatePresence>
          {linked && !hovered && !isWord && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-x-[-3px] inset-y-[-2px] rounded-md"
              style={{ background: `${color}1A` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            />
          )}
        </AnimatePresence>
        {/* Faint glyph beside the phrase using the TOP analogy's
            glyph (highest generativity — already sorted by the
            generator). Indicates "this concept has analogies" at a
            glance; the count of dots inside the popover communicates
            how many lenses are available. */}
        {annotation.analogies.length > 0 && painted && (
          <span
            className="ml-0.5 inline-flex translate-y-[-1px] items-center"
            aria-hidden
            style={{
              color: `${color}80`,
              opacity: hovered ? 1 : 0.55,
              transition: "opacity 220ms ease",
            }}
          >
            <AnnotationGlyph
              kind={annotation.analogies[0]!.glyph}
              size={12}
            />
          </span>
        )}
      </motion.span>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute left-1/2 top-full z-30 mt-2 w-[400px] -translate-x-1/2"
            role="tooltip"
          >
            <PopoverCard
              annotation={annotation}
              color={color}
              activeTab={activeTab}
              tabs={tabs}
              onTab={setActiveTab}
              subTitle={subTitle}
              spaceId={spaceId}
              feedback={feedback}
              onFeedback={setFeedback}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <span aria-hidden style={{ display: "none" }}>
        {index}
      </span>
    </span>
  );
}

// ── Popover card with tabs ────────────────────────────────────────

const TAB_ICONS: Record<TabKey, React.ReactNode> = {
  read: <BookOpen className="h-3 w-3" strokeWidth={2} />,
  layers: <LayersIcon className="h-3 w-3" strokeWidth={2} />,
  like: <Sparkles className="h-3 w-3" strokeWidth={2} />,
  how: <Cog className="h-3 w-3" strokeWidth={2} />,
  stakes: <Target className="h-3 w-3" strokeWidth={2} />,
  warn: <AlertTriangle className="h-3 w-3" strokeWidth={2} />,
};

const TAB_LABEL: Record<TabKey, string> = {
  read: "Read",
  layers: "Layers",
  like: "Like",
  how: "How",
  stakes: "Stakes",
  // Renamed from "⚠" so the unicode triangle doesn't render
  // alongside the AlertTriangle icon (was rendering as double-icon).
  warn: "Risk",
};

function PopoverCard({
  annotation,
  color,
  activeTab,
  tabs,
  onTab,
  subTitle,
  spaceId,
  feedback,
  onFeedback,
}: {
  annotation: ObjectiveAnnotation;
  color: string;
  activeTab: TabKey;
  tabs: TabKey[];
  onTab: (t: TabKey) => void;
  subTitle: string | null;
  spaceId: string;
  feedback: "up" | "down" | null;
  onFeedback: (v: "up" | "down") => void;
}) {
  const confidencePct =
    annotation.confidence !== null
      ? Math.round(annotation.confidence * 100)
      : null;

  return (
    <div
      className="rounded-2xl p-3.5"
      style={{
        background: "rgba(255,255,255,0.98)",
        border: `1px solid ${appleVibe.stroke.medium}`,
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.95) inset, 0 24px 50px -20px rgba(11,18,40,0.35)",
        borderRadius: appleVibe.radius.lg,
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Header: dot, phrase, crystal chip, confidence bar */}
      <div className="flex items-start gap-2">
        <span
          className="mt-1 block h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span
              className="text-[11.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              &ldquo;{annotation.phrase}&rdquo;
            </span>
            {annotation.crystal && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
                style={{ background: `${color}14`, color }}
              >
                {annotation.crystal}
              </span>
            )}
          </div>
          {confidencePct !== null && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className="text-[9px] font-semibold uppercase tracking-wider"
                style={{ color: appleVibe.text.tertiary }}
              >
                Confidence
              </span>
              <span
                className="block h-1 flex-1 overflow-hidden rounded-full"
                style={{ background: "rgba(15,23,42,0.06)" }}
              >
                <span
                  className="block h-full"
                  style={{
                    width: `${confidencePct}%`,
                    background: color,
                  }}
                />
              </span>
              <span
                className="font-mono text-[9.5px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
              >
                {confidencePct}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tab strip — only show tabs the annotation has content for */}
      {tabs.length > 1 && (
        <div className="mt-3 flex items-center gap-1 border-b pb-2"
          style={{ borderColor: appleVibe.stroke.hairline }}
        >
          {tabs.map((t) => {
            const active = t === activeTab;
            return (
              <button
                key={t}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTab(t);
                }}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all"
                style={{
                  background: active
                    ? "rgba(15,23,42,0.92)"
                    : "transparent",
                  color: active
                    ? appleVibe.text.onAccent
                    : appleVibe.text.secondary,
                }}
              >
                {TAB_ICONS[t]}
                <span>{TAB_LABEL[t]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Tab body */}
      <div className="mt-3 min-h-[64px]">
        <TabBody tab={activeTab} annotation={annotation} color={color} />
      </div>

      {/* Footer: sub-link + feedback */}
      <div
        className="mt-3 flex items-center justify-between gap-2 pt-2"
        style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        {annotation.linked_sub_objective_id && subTitle ? (
          <Link
            href={`/app/objective/${spaceId}/sub/${annotation.linked_sub_objective_id}`}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold transition-colors"
            style={{ background: `${color}14`, color }}
          >
            {subTitle}
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
          </Link>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          <span
            className="text-[9.5px] font-medium uppercase tracking-wider"
            style={{ color: appleVibe.text.tertiary }}
          >
            Right read?
          </span>
          <FeedbackButton
            active={feedback === "up"}
            onClick={(e) => {
              e.stopPropagation();
              onFeedback("up");
            }}
            label="👍"
          />
          <FeedbackButton
            active={feedback === "down"}
            onClick={(e) => {
              e.stopPropagation();
              onFeedback("down");
            }}
            label="👎"
          />
        </div>
      </div>
    </div>
  );
}

function TabBody({
  tab,
  annotation,
  color,
}: {
  tab: TabKey;
  annotation: ObjectiveAnnotation;
  color: string;
}) {
  if (tab === "read") {
    return (
      <div className="space-y-2">
        <p
          className="text-[12.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {annotation.reading}
        </p>
        {annotation.not_reading && (
          <p
            className="text-[11.5px] font-light italic leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            <span
              className="not-italic font-semibold"
              style={{ color: appleVibe.text.tertiary }}
            >
              Not:
            </span>{" "}
            {annotation.not_reading}
          </p>
        )}
        {annotation.frame && (
          <p
            className="text-[11px] font-light leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            <span className="font-semibold">Frame:</span> {annotation.frame}
          </p>
        )}
      </div>
    );
  }

  if (tab === "layers") {
    return (
      <div className="space-y-3">
        {annotation.dimensions.length > 0 && (
          <div>
            <div
              className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              Composed of
            </div>
            <ul className="space-y-1.5">
              {annotation.dimensions.map((d, i) => (
                <li
                  key={i}
                  className="rounded-lg px-2.5 py-1.5"
                  style={{
                    background: `${color}0F`,
                    border: `1px solid ${color}24`,
                  }}
                >
                  <div
                    className="flex items-center gap-1.5 text-[11.5px] font-semibold"
                    style={{ color: appleVibe.text.primary }}
                  >
                    <span
                      className="block h-1 w-1 flex-shrink-0 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                    {d.name}
                  </div>
                  <p
                    className="mt-0.5 pl-2.5 text-[11px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {d.why}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {annotation.inference_chain.length > 0 && (
          <div>
            <div
              className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              Inference chain
            </div>
            <ol className="space-y-1">
              {annotation.inference_chain.map((hop, i) => {
                const isLast = i === annotation.inference_chain.length - 1;
                return (
                  <li key={i} className="relative pl-4">
                    {/* Step dot + connector */}
                    <span
                      className="absolute left-0 top-1 block h-1.5 w-1.5 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                    {!isLast && (
                      <span
                        className="absolute left-[2.5px] top-3 block w-px"
                        style={{
                          height: "calc(100% + 4px)",
                          background: `${color}40`,
                        }}
                        aria-hidden
                      />
                    )}
                    <div
                      className="text-[11.5px] font-semibold leading-snug"
                      style={{ color: appleVibe.text.primary }}
                    >
                      {hop.step}
                    </div>
                    {!isLast && (
                      <div
                        className="text-[10.5px] font-light italic leading-snug"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        via {hop.via}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (tab === "like" && annotation.analogies.length > 0) {
    return <AnalogyCarousel analogies={annotation.analogies} color={color} />;
  }

  if (tab === "how") {
    return (
      <div className="space-y-2">
        {annotation.mechanism && (
          <p
            className="text-[12px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            <span
              className="font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              Mechanism:
            </span>{" "}
            {annotation.mechanism}
          </p>
        )}
        {annotation.frame && (
          <p
            className="text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            <span className="font-semibold">Frame:</span> {annotation.frame}
          </p>
        )}
      </div>
    );
  }

  if (tab === "stakes" && annotation.stakes) {
    return (
      <p
        className="text-[12px] font-light leading-snug"
        style={{ color: appleVibe.text.secondary }}
      >
        <span
          className="font-semibold"
          style={{ color: appleVibe.text.primary }}
        >
          Why this matters:
        </span>{" "}
        {annotation.stakes}
      </p>
    );
  }

  if (tab === "warn") {
    const fr = annotation.fragility;
    return (
      <div className="space-y-3">
        {fr && (fr.when || fr.why || fr.sign) && (
          <div
            className="rounded-lg p-2.5"
            style={{
              background: "rgba(220,38,38,0.05)",
              border: "1px solid rgba(220,38,38,0.18)",
            }}
          >
            <div
              className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: "rgba(127,29,29,0.85)" }}
            >
              Pre-mortem
            </div>
            {fr.when && (
              <div className="mb-1.5">
                <div
                  className="text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(127,29,29,0.85)" }}
                >
                  When
                </div>
                <p
                  className="mt-0.5 text-[11.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {fr.when}
                </p>
              </div>
            )}
            {fr.why && (
              <div className="mb-1.5">
                <div
                  className="text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(127,29,29,0.85)" }}
                >
                  Why it breaks
                </div>
                <p
                  className="mt-0.5 text-[11.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {fr.why}
                </p>
              </div>
            )}
            {fr.sign && (
              <div>
                <div
                  className="text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(127,29,29,0.85)" }}
                >
                  Early signal
                </div>
                <p
                  className="mt-0.5 text-[11.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {fr.sign}
                </p>
              </div>
            )}
          </div>
        )}
        {annotation.tensions
          .filter((t) => t.kind === "tension")
          .map((t, i) => (
            <p
              key={i}
              className="text-[11.5px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              <span
                className="font-semibold"
                style={{ color: "rgba(127,29,29,0.85)" }}
              >
                Tension with &ldquo;{t.phrase}&rdquo;:
              </span>{" "}
              {t.note}
            </p>
          ))}
        {annotation.tensions
          .filter((t) => t.kind === "harmony")
          .map((t, i) => (
            <p
              key={i}
              className="text-[11.5px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              <span
                className="font-semibold"
                style={{ color: appleVibe.text.tertiary }}
              >
                Harmony with &ldquo;{t.phrase}&rdquo;:
              </span>{" "}
              {t.note}
            </p>
          ))}
      </div>
    );
  }

  // Fallback (shouldn't hit — defaultTab + availableTabs guard).
  return (
    <p
      className="text-[12px] font-light leading-snug"
      style={{ color: appleVibe.text.tertiary }}
    >
      No content for this lens.
    </p>
  );
}

// ── Analogy carousel (Like / Unlike tab body) ──
//
// Stacked navigator across the polyhedron of analogies for one
// annotation. Each card shows: domain chip + glyph, why_same, the
// "BUT unlike…" disanalogy (if present), 2-4 candidate extensions
// (generative payoff), generativity star rating. Prev/next + dot
// indicator at the bottom.

function AnalogyCarousel({
  analogies,
  color,
}: {
  analogies: AnnotationAnalogy[];
  color: string;
}) {
  const [cursor, setCursor] = useState(0);
  const total = analogies.length;
  // Safety: keep cursor in bounds when analogies change.
  useEffect(() => {
    if (cursor >= total) setCursor(0);
  }, [cursor, total]);
  const a = analogies[cursor]!;
  const stars = Math.max(1, Math.round(a.generativity * 5));

  return (
    <div className="flex flex-col gap-3">
      {/* Domain chip + glyph header */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: `${color}10`,
            color,
            border: `1px solid ${color}30`,
          }}
          aria-hidden
        >
          <AnnotationGlyph kind={a.glyph} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
              style={{ background: `${color}1A`, color }}
            >
              {a.domain}
            </span>
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              {cursor + 1} of {total}
            </span>
          </div>
          <div
            className="mt-1 text-[12px] font-semibold leading-snug"
            style={{ color: appleVibe.text.primary }}
          >
            Like {a.referent}
          </div>
          <p
            className="mt-0.5 text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {a.why_same}
          </p>
        </div>
      </div>

      {/* Disanalogy: "BUT unlike…" — where the analogy breaks */}
      {a.why_differs && (
        <div
          className="rounded-lg p-2.5"
          style={{
            background: "rgba(220,38,38,0.04)",
            border: "1px solid rgba(220,38,38,0.16)",
          }}
        >
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "rgba(127,29,29,0.85)" }}
          >
            But unlike
          </div>
          <p
            className="mt-0.5 text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {a.why_differs}
          </p>
        </div>
      )}

      {/* Generative extensions — candidate features the analogy implies */}
      {a.extensions.length > 0 && (
        <div>
          <div
            className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            If this holds, build
          </div>
          <ul className="space-y-1">
            {a.extensions.map((e, i) => (
              <li
                key={i}
                className="rounded-md px-2 py-1.5"
                style={{
                  background: appleVibe.surface.base,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                <div
                  className="text-[11.5px] font-semibold leading-snug"
                  style={{ color: appleVibe.text.primary }}
                >
                  {e.name}
                </div>
                <p
                  className="mt-0.5 text-[10.5px] font-light italic leading-snug"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {e.why}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer: prev / dots / generativity stars / next */}
      <div
        className="flex items-center justify-between pt-1"
        style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCursor((c) => (c - 1 + total) % total);
          }}
          disabled={total < 2}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          style={{
            background: total < 2 ? "transparent" : appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
            opacity: total < 2 ? 0.3 : 1,
          }}
          aria-label="Previous analogy"
        >
          <ChevronLeft className="h-3 w-3" strokeWidth={2.5} />
        </button>

        <div className="flex items-center gap-1.5">
          {/* Dot indicator */}
          <span className="flex items-center gap-0.5">
            {analogies.map((_, i) => (
              <span
                key={i}
                className="block h-1 w-1 rounded-full transition-colors"
                style={{
                  background:
                    i === cursor ? color : "rgba(15,23,42,0.18)",
                }}
                aria-hidden
              />
            ))}
          </span>
          {/* Generativity stars */}
          <span
            className="ml-1 flex items-center"
            aria-label={`Generativity ${stars} of 5`}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <Star
                key={i}
                className="h-2.5 w-2.5"
                strokeWidth={1.75}
                style={{
                  color: i < stars ? color : "rgba(15,23,42,0.18)",
                  fill: i < stars ? color : "transparent",
                }}
              />
            ))}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCursor((c) => (c + 1) % total);
          }}
          disabled={total < 2}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          style={{
            background: total < 2 ? "transparent" : appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
            opacity: total < 2 ? 0.3 : 1,
          }}
          aria-label="Next analogy"
        >
          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function FeedbackButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md text-[12px] transition-all"
      style={{
        background: active ? "rgba(15,23,42,0.06)" : "transparent",
        border: `1px solid ${
          active ? appleVibe.stroke.medium : "transparent"
        }`,
      }}
    >
      {label}
    </button>
  );
}

// ── Segment builder ────────────────────────────────────────────────

type Segment =
  | { type: "text"; value: string }
  | { type: "mark"; value: string; annotationIndex: number };

function buildSegments(
  text: string,
  annotations: ObjectiveAnnotation[],
): Segment[] {
  if (annotations.length === 0) return [{ type: "text", value: text }];
  const out: Segment[] = [];
  let cursor = 0;
  annotations.forEach((a, i) => {
    if (a.start_offset > cursor) {
      out.push({ type: "text", value: text.slice(cursor, a.start_offset) });
    }
    out.push({
      type: "mark",
      value: text.slice(a.start_offset, a.end_offset),
      annotationIndex: i,
    });
    cursor = a.end_offset;
  });
  if (cursor < text.length) {
    out.push({ type: "text", value: text.slice(cursor) });
  }
  return out;
}
