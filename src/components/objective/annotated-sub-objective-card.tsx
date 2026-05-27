"use client";

// ── Annotated Sub-Objective Card ──────────────────────────────────
//
// Display-only render of the sub-objective's title + description
// with annotation chips inline. Parallel to AnnotatedObjectiveCard
// but stripped of versions / deepen / synthesize machinery — those
// only apply to the parent-objective lens. Sub-objective annotations
// are read-only here; regenerate happens via the API route on user
// trigger or auto-trigger after room generation.
//
// Hovering or clicking a marked phrase reveals a small popover with
// the reading + glyph + fragility + analogy info, scoped tightly.

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import type {
  ObjectiveAnnotation,
  AnnotationLayerTag,
} from "@/components/objective/annotated-objective-card";

interface Props {
  /** The sub-objective text the annotations are scoped to. Must be
   *  the SAME text the generator was given (title + description). */
  objectiveText: string;
  /** Pre-loaded annotations. When empty, renders the plain text only
   *  + a "Lens generating…" hint. The auto-trigger after room gen
   *  populates these server-side. */
  annotations: ObjectiveAnnotation[];
}

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

type Segment =
  | { kind: "text"; value: string }
  | { kind: "mark"; value: string; annotationIndex: number };

function buildSegments(
  text: string,
  annotations: ObjectiveAnnotation[],
): Segment[] {
  if (annotations.length === 0) return [{ kind: "text", value: text }];
  const sorted = annotations
    .map((a, idx) => ({ a, idx }))
    .filter((x) => x.a.start_offset >= 0 && x.a.end_offset > x.a.start_offset)
    .sort((x, y) => x.a.start_offset - y.a.start_offset);

  const out: Segment[] = [];
  let cursor = 0;
  for (const { a, idx } of sorted) {
    if (a.start_offset < cursor) continue; // overlap-skip
    if (a.start_offset > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, a.start_offset) });
    }
    out.push({
      kind: "mark",
      value: text.slice(a.start_offset, a.end_offset),
      annotationIndex: idx,
    });
    cursor = a.end_offset;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", value: text.slice(cursor) });
  }
  return out;
}

export function AnnotatedSubObjectiveCard({
  objectiveText,
  annotations,
}: Props) {
  const reduce = useReducedMotion();
  const safeAnnotations = useMemo(
    () => normalizeAnnotations(annotations),
    [annotations],
  );
  const segments = useMemo(
    () => buildSegments(objectiveText, safeAnnotations),
    [objectiveText, safeAnnotations],
  );
  const [hovered, setHovered] = useState<number | null>(null);

  if (objectiveText.trim().length === 0) return null;

  // Loading hint when text exists but annotations don't yet.
  const isLoading = safeAnnotations.length === 0;

  return (
    <div
      className="rounded-2xl px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.6)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          <Sparkles className="h-2.5 w-2.5" strokeWidth={2} />
          Sub-objective lens
        </span>
        <span
          className="text-[10px] font-light"
          style={{ color: appleVibe.text.faint }}
        >
          {isLoading
            ? "generating…"
            : `${safeAnnotations.length} reading${safeAnnotations.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <p
        className="text-[14.5px] font-light leading-[1.55]"
        style={{ color: appleVibe.text.primary }}
      >
        {segments.map((seg, i) => {
          if (seg.kind === "text") {
            return <span key={i}>{seg.value}</span>;
          }
          const ann = safeAnnotations[seg.annotationIndex];
          const isHovered = hovered === seg.annotationIndex;
          const color = colorForTag(ann.layer_tag);
          const thickness = Math.max(
            1,
            Math.min(2.4, 0.8 + (ann.weight ?? 0.5) * 1.6),
          );
          return (
            <span
              key={i}
              onMouseEnter={() => setHovered(seg.annotationIndex)}
              onMouseLeave={() => setHovered(null)}
              className="relative inline-block cursor-default"
              style={{
                borderBottom: `${thickness}px solid ${color}`,
                paddingBottom: 1,
              }}
            >
              {seg.value}
              {isHovered && (
                <motion.span
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="absolute left-1/2 z-50 -translate-x-1/2 transform"
                  style={{
                    top: "100%",
                    marginTop: 8,
                    width: "min(360px, 80vw)",
                  }}
                >
                  <span
                    className="block rounded-2xl px-3.5 py-2.5"
                    style={{
                      background: "rgba(255,255,255,0.98)",
                      border: `1px solid ${appleVibe.stroke.soft}`,
                      boxShadow: "0 12px 32px -10px rgba(15,23,42,0.18)",
                      borderRadius: appleVibe.radius.md,
                    }}
                  >
                    <span
                      className="block text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color, letterSpacing: "0.1em" }}
                    >
                      {ann.layer_tag ?? "reading"}
                    </span>
                    {ann.reading && (
                      <span
                        className="mt-1 block text-[12.5px] font-light leading-[1.55]"
                        style={{ color: appleVibe.text.primary }}
                      >
                        {ann.reading}
                      </span>
                    )}
                    {ann.fragility?.when && (
                      <span
                        className="mt-1.5 block text-[11.5px] italic leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        <span
                          className="font-semibold uppercase not-italic"
                          style={{
                            color: appleVibe.text.tertiary,
                            fontSize: "9.5px",
                            letterSpacing: "0.12em",
                            marginRight: 4,
                          }}
                        >
                          fragile when
                        </span>
                        {ann.fragility.when}
                      </span>
                    )}
                    {ann.analogies?.[0]?.why_same && (
                      <span
                        className="mt-1.5 block text-[11.5px] italic leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        <span
                          className="font-semibold uppercase not-italic"
                          style={{
                            color: appleVibe.text.tertiary,
                            fontSize: "9.5px",
                            letterSpacing: "0.12em",
                            marginRight: 4,
                          }}
                        >
                          like
                        </span>
                        {ann.analogies[0].referent}
                        {ann.analogies[0].domain
                          ? ` (${ann.analogies[0].domain})`
                          : ""}{" "}
                        — {ann.analogies[0].why_same}
                      </span>
                    )}
                  </span>
                </motion.span>
              )}
            </span>
          );
        })}
      </p>
    </div>
  );
}
