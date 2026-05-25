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
  Cog,
  Layers as LayersIcon,
  Sparkles,
  Target,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";
import {
  AnnotationGlyph,
  type GlyphKind,
} from "@/components/objective/icons/annotation-glyphs";

// ── Types ──────────────────────────────────────────────────────────

export type AnnotationLayerTag =
  | "features"
  | "outcomes"
  | "pain"
  | "objective"
  | null;

export interface AnnotationAnalogy {
  referent: string;
  why_same: string;
  glyph: GlyphKind;
}

export interface AnnotationTension {
  phrase: string;
  kind: "tension" | "harmony";
  note: string;
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
  like: AnnotationAnalogy | null;
  mechanism: string | null;
  frame: string | null;
  stakes: string | null;
  fragility: string | null;
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
}: Props) {
  const reduce = useReducedMotion();
  const [annotations, setAnnotations] = useState<ObjectiveAnnotation[]>(
    initialAnnotations,
  );
  const [reading, setReading] = useState(false); // margin-notes toggle
  const [hovered, setHovered] = useState<number | null>(null);
  const [paintedCount, setPaintedCount] = useState(0);
  const [loading, setLoading] = useState(initialAnnotations.length === 0);
  const fetchedRef = useRef(false);

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
          setAnnotations(json.annotations);
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
      {/* Eyebrow */}
      <div className="mb-3 flex items-center justify-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{
            background: "rgba(124,58,237,0.08)",
            color: "rgba(91,33,182,0.95)",
            border: "1px solid rgba(124,58,237,0.18)",
          }}
        >
          <Sparkle className="h-2.5 w-2.5" />
          Core Objective
        </span>
      </div>

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
        {/* AI reading toggle */}
        <button
          type="button"
          onClick={() => setReading((v) => !v)}
          aria-pressed={reading}
          className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors"
          style={{
            background: reading
              ? "rgba(15,23,42,0.92)"
              : "rgba(15,23,42,0.04)",
            color: reading
              ? appleVibe.text.onAccent
              : appleVibe.text.secondary,
            border: reading
              ? "1px solid rgba(15,23,42,0.92)"
              : `1px solid ${appleVibe.stroke.hairline}`,
            cursor: "pointer",
          }}
          title={
            reading
              ? "Hide margin notes (hover still works)"
              : "Show all AI annotations as margin notes"
          }
        >
          <Sparkles className="h-2.5 w-2.5" strokeWidth={2.25} />
          AI reading {reading ? "on" : "off"}
        </button>

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

        {/* Footer meta */}
        <div
          className="mt-5 flex items-center justify-between pt-4"
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
          {annotations.length > 0 && !reading && (
            <span
              className="hidden text-[10.5px] font-light md:inline"
              style={{ color: appleVibe.text.tertiary }}
            >
              Hover any underline to read the AI&rsquo;s mind
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline mark with tabbed popover ────────────────────────────────

type TabKey = "read" | "layers" | "like" | "how" | "stakes" | "warn";

function availableTabs(a: ObjectiveAnnotation): TabKey[] {
  const tabs: TabKey[] = ["read"];
  if (a.dimensions.length > 0 || a.inference_chain.length > 0)
    tabs.push("layers");
  if (a.like) tabs.push("like");
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
  if (a.like) return "like";
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
          // Word-scope pill: soft background fill in layer color,
          // narrow rounded shape. The pill says "this concept is
          // being semantically unpacked" — distinct from the
          // dotted-underline interpretive treatment of phrases.
          background: isWord
            ? painted
              ? hovered
                ? `${color}26`
                : `${color}18`
              : "transparent"
            : "transparent",
          borderRadius: isWord ? 6 : 0,
          padding: isWord ? "1px 5px" : "0",
          margin: isWord ? "0 1px" : "0",
          boxShadow: isWord && hovered ? `inset 0 0 0 1px ${color}3D` : "none",
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
        {/* Faint glyph beside the phrase when an analogy exists.
            For word-scope pills we render the glyph after the closing
            pill edge, not inside, so the pill doesn't grow. */}
        {annotation.like && painted && (
          <span
            className="ml-0.5 inline-flex translate-y-[-1px] items-center"
            aria-hidden
            style={{
              color: `${color}80`,
              opacity: hovered ? 1 : 0.55,
              transition: "opacity 220ms ease",
            }}
          >
            <AnnotationGlyph kind={annotation.like.glyph} size={12} />
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
            className="absolute left-1/2 top-full z-30 mt-2 w-[340px] -translate-x-1/2"
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
  warn: "⚠",
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

  if (tab === "like" && annotation.like) {
    return (
      <div className="space-y-2">
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
            <AnnotationGlyph kind={annotation.like.glyph} size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[12px] font-semibold leading-snug"
              style={{ color: appleVibe.text.primary }}
            >
              Like {annotation.like.referent}
            </div>
            <p
              className="mt-0.5 text-[11.5px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {annotation.like.why_same}
            </p>
          </div>
        </div>
      </div>
    );
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
    return (
      <div className="space-y-2">
        {annotation.fragility && (
          <p
            className="text-[12px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            <span
              className="font-semibold"
              style={{ color: "rgba(127,29,29,0.95)" }}
            >
              Fragile when:
            </span>{" "}
            {annotation.fragility}
          </p>
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
