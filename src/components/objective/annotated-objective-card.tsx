"use client";

// ── Annotated Objective Card ──
//
// Replaces the plain CoreNode on the main canvas with the user's
// typed objective text + AI-extracted phrase annotations.
//
// At rest:
//   - Phrases wear a soft dotted underline colored by layer tag
//   - A small "AI reading · ON/OFF" toggle pill in the top-right
//   - On mount, underlines paint in left-to-right (80ms stagger,
//     each gets a subtle shimmer) so the user feels the AI reading
//
// Hover/focus a phrase:
//   - A floating annotation popover appears below it (above on
//     small viewports) with: phrase, AI's reading, a link to the
//     anchored sub-objective if any, and thumbs feedback
//
// "AI reading" toggle ON:
//   - Each annotation also renders as a margin note to the right
//     of its line, with a thin connector line. Mobile-friendly
//     because no hover required.
//
// Lazy generation:
//   - If the server-rendered annotations array is empty, the
//     component POSTs to /api/brainstorm/annotations/generate on
//     mount. While the request is in flight the text shows
//     plainly. Annotations stream in with the paint-in animation.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";

// ── Types ──────────────────────────────────────────────────────────

export type AnnotationLayerTag =
  | "features"
  | "outcomes"
  | "pain"
  | "objective"
  | null;

export interface ObjectiveAnnotation {
  phrase: string;
  start_offset: number;
  end_offset: number;
  note: string;
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
  /** Annotations from the server (improvement_goals.annotations).
   *  Empty array = not yet generated; component will lazy-generate
   *  on mount. */
  initialAnnotations: ObjectiveAnnotation[];
  /** Sub-objectives in this space — used to resolve linked ids to
   *  titles for the popover. */
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
  if (!tag) return NEUTRAL_COLOR;
  return LAYER_COLOR[tag];
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
  const [reading, setReading] = useState(false); // "AI reading" toggle
  const [hovered, setHovered] = useState<number | null>(null);
  const [paintedCount, setPaintedCount] = useState(
    initialAnnotations.length > 0 ? 0 : 0,
  );
  const [loading, setLoading] = useState(initialAnnotations.length === 0);
  const fetchedRef = useRef(false);

  const subTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subObjectives) m.set(s.id, s.title);
    return m;
  }, [subObjectives]);

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
        setTimeout(() => setPaintedCount((c) => Math.max(c, i + 1)), 220 + i * interval),
      );
    });
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [annotations, reduce]);

  // ── Render the text with interleaved marks ──
  const segments = useMemo(() => buildSegments(objective, annotations), [
    objective,
    annotations,
  ]);

  const linkedCount = annotations.filter((a) => a.linked_sub_objective_id).length;

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
              ? "Hide margin notes (annotations stay on hover)"
              : "Show all AI annotations as margin notes"
          }
        >
          <Sparkles className="h-2.5 w-2.5" strokeWidth={2.25} />
          AI reading {reading ? "on" : "off"}
        </button>

        {/* Body: text + margin notes (when reading=on) */}
        <div
          className={
            reading
              ? "grid gap-x-8 md:grid-cols-[1fr_minmax(220px,260px)]"
              : ""
          }
        >
          {/* Annotated text */}
          <p
            className="text-[18px] font-medium leading-[1.55] tracking-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.005em",
            }}
          >
            {segments.map((seg, i) => {
              if (seg.type === "text") {
                return <span key={i}>{seg.value}</span>;
              }
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
                  onHoverChange={(h) => setHovered(h ? idx : (cur) => (cur === idx ? null : cur))}
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

          {/* Margin notes column — only when AI reading toggle is on */}
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
                      </div>
                      <p
                        className="mt-1 text-[11.5px] font-light leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {a.note}
                      </p>
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
              Hover any underline to see the AI&rsquo;s reading
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline mark with hover popover ─────────────────────────────────

function AnnotatedMark({
  annotation,
  index,
  painted,
  hovered,
  onHoverChange,
  subTitle,
  spaceId,
}: {
  annotation: ObjectiveAnnotation;
  index: number;
  painted: boolean;
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  subTitle: string | null;
  spaceId: string;
}) {
  const color = colorForTag(annotation.layer_tag);
  const reduce = useReducedMotion();
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

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
          color: hovered ? color : "inherit",
          transition: "color 220ms ease",
        }}
      >
        {annotation.phrase}
        {/* Dotted underline — paint-in via scaleX from 0 → 1, then
            shimmer once for the "AI just read this" moment. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-0.5"
          style={{
            transformOrigin: "left center",
            height: 0,
            borderBottom: `1.5px dotted ${color}`,
          }}
          initial={false}
          animate={
            reduce
              ? { scaleX: painted ? 1 : 0 }
              : painted
                ? {
                    scaleX: 1,
                    opacity: [0, 1, 0.6, 1],
                  }
                : { scaleX: 0, opacity: 0 }
          }
          transition={{
            scaleX: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.7, times: [0, 0.4, 0.7, 1] },
          }}
        />
      </motion.span>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute left-1/2 top-full z-20 mt-2 w-[300px] -translate-x-1/2"
            role="tooltip"
          >
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
                  &ldquo;{annotation.phrase}&rdquo;
                </span>
              </div>
              <p
                className="mt-1.5 text-[12.5px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {annotation.note}
              </p>

              {annotation.linked_sub_objective_id && subTitle && (
                <Link
                  href={`/app/objective/${spaceId}/sub/${annotation.linked_sub_objective_id}`}
                  className="mt-2.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: "rgba(15,23,42,0.04)",
                    color,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(15,23,42,0.07)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "rgba(15,23,42,0.04)")
                  }
                >
                  {subTitle}
                  <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
                </Link>
              )}

              {/* Feedback */}
              <div
                className="mt-3 flex items-center justify-between pt-2"
                style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
              >
                <span
                  className="text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Read this right?
                </span>
                <div className="flex items-center gap-1">
                  <FeedbackButton
                    active={feedback === "up"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFeedback("up");
                    }}
                    label="👍"
                  />
                  <FeedbackButton
                    active={feedback === "down"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFeedback("down");
                    }}
                    label="👎"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span aria-hidden style={{ display: "none" }}>
        {index}
      </span>
    </span>
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

// ── Segment builder ──
// Walks the source text + sorted annotations and produces a flat
// list of {text} and {mark} segments. Renderer just maps these.

type Segment =
  | { type: "text"; value: string }
  | { type: "mark"; value: string; annotationIndex: number };

function buildSegments(
  text: string,
  annotations: ObjectiveAnnotation[],
): Segment[] {
  if (annotations.length === 0) return [{ type: "text", value: text }];
  // Annotations come in sorted by start_offset. Walk the cursor.
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
