"use client";

// ── Annotated Heading ─────────────────────────────────────────────
//
// Renders a block of text with inline colored underlines for each
// annotation whose offset falls within the text. Hovering (or
// focusing) an underlined phrase reveals its reading in a small
// popover anchored under the phrase.
//
// Defaults to an <h1> (the sub-objective title), but `as` lets it
// render body prose too (e.g. the Definition paragraph in the room
// hero) so title + body share ONE underline renderer instead of two.
//
// Underline thickness scales with annotation.weight (matches the lens
// body) so heavy readings read more present. Lane color is pulled from
// the same LAYER_COLOR mapping the lens uses.

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { useAnnotationsVisible } from "@/components/objective/annotations-visibility";
import type {
  ObjectiveAnnotation,
  AnnotationLayerTag,
} from "@/components/objective/annotated-objective-card";

const EASE = [0.22, 1, 0.36, 1] as const;

const LAYER_COLOR: Record<Exclude<AnnotationLayerTag, null>, string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};
const LAYER_LABEL: Record<Exclude<AnnotationLayerTag, null>, string> = {
  pain: "Problem",
  features: "Mechanism",
  outcomes: "Outcome",
  objective: "Objective",
};
const NEUTRAL_COLOR = "rgba(15,23,42,0.45)";
function colorForTag(tag: AnnotationLayerTag): string {
  return tag ? LAYER_COLOR[tag] : NEUTRAL_COLOR;
}

type Segment =
  | { kind: "text"; value: string }
  | {
      kind: "mark";
      value: string;
      weight: number;
      color: string;
      tag: AnnotationLayerTag;
      reading: string;
    };

function buildSegments(
  text: string,
  annotations: ObjectiveAnnotation[],
): Segment[] {
  if (annotations.length === 0) return [{ kind: "text", value: text }];
  const sorted = annotations
    .filter(
      (a) =>
        a.start_offset >= 0 &&
        a.end_offset > a.start_offset &&
        a.start_offset < text.length,
    )
    .sort((a, b) => a.start_offset - b.start_offset);

  const out: Segment[] = [];
  let cursor = 0;
  for (const a of sorted) {
    if (a.start_offset < cursor) continue; // overlap-skip
    if (a.start_offset > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, a.start_offset) });
    }
    out.push({
      kind: "mark",
      value: text.slice(a.start_offset, Math.min(a.end_offset, text.length)),
      weight: a.weight ?? 0.5,
      color: colorForTag(a.layer_tag),
      tag: a.layer_tag,
      reading: (a.reading ?? "").trim(),
    });
    cursor = Math.min(a.end_offset, text.length);
  }
  if (cursor < text.length) {
    out.push({ kind: "text", value: text.slice(cursor) });
  }
  return out;
}

interface Props {
  text: string;
  annotations: ObjectiveAnnotation[];
  /** Tailwind className for the text wrapper. */
  className?: string;
  /** Inline style for the text wrapper. */
  style?: React.CSSProperties;
  /** Wrapper element. Defaults to "h1" (title use); pass "p" for body
   *  prose like the room hero's Definition paragraph. */
  as?: "h1" | "h2" | "h3" | "p" | "div";
}

export function AnnotatedHeading({
  text,
  annotations,
  className,
  style,
  as = "h1",
}: Props) {
  const Tag = as;
  const reduce = useReducedMotion();
  // Global "annotations off" reading mode: feed zero annotations so
  // buildSegments returns one plain text segment (no marks, no popovers).
  const annotationsVisible = useAnnotationsVisible();
  const safe = useMemo(
    () => (annotationsVisible ? normalizeAnnotations(annotations) : []),
    [annotations, annotationsVisible],
  );
  const segments = useMemo(() => buildSegments(text, safe), [text, safe]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [anchorX, setAnchorX] = useState(0);

  const activeSeg =
    active !== null && segments[active]?.kind === "mark"
      ? (segments[active] as Extract<Segment, { kind: "mark" }>)
      : null;

  // Anchor the popover under the centre of the hovered phrase, clamped
  // so it never overflows the heading's box. Half a 320px popover.
  function reveal(i: number, el: HTMLElement) {
    const wrap = wrapRef.current;
    if (wrap) {
      const wr = wrap.getBoundingClientRect();
      const mr = el.getBoundingClientRect();
      const half = 160;
      const center = mr.left + mr.width / 2 - wr.left;
      setAnchorX(Math.max(half, Math.min(center, wr.width - half)));
    }
    setActive(i);
  }

  return (
    <div ref={wrapRef} className="relative">
      <Tag className={className} style={style}>
        {segments.map((seg, i) => {
          if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
          const thickness = Math.max(1.5, Math.min(3, 1.2 + seg.weight * 2));
          const interactive = seg.reading.length > 0;
          return (
            <motion.span
              key={i}
              {...(interactive
                ? {
                    role: "button",
                    tabIndex: 0,
                    onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
                      reveal(i, e.currentTarget),
                    onMouseLeave: () => setActive(null),
                    onFocus: (e: React.FocusEvent<HTMLElement>) =>
                      reveal(i, e.currentTarget),
                    onBlur: () => setActive(null),
                  }
                : {})}
              initial={reduce ? false : { backgroundSize: `0% ${thickness}px` }}
              animate={{ backgroundSize: `100% ${thickness}px` }}
              transition={{
                duration: 0.55,
                delay: 0.15 + i * 0.06,
                ease: EASE,
              }}
              className="relative inline transition-opacity duration-150"
              style={{
                backgroundImage: `linear-gradient(${seg.color}, ${seg.color})`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "0 100%",
                backgroundSize: `100% ${thickness}px`,
                paddingBottom: 3,
                cursor: interactive ? "pointer" : "default",
                opacity: active !== null && active !== i ? 0.55 : 1,
                outline: "none",
              }}
            >
              {seg.value}
            </motion.span>
          );
        })}
      </Tag>

      {/* Hover/focus reading popover — anchored under the phrase. */}
      <AnimatePresence>
        {activeSeg && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="pointer-events-none absolute z-50"
            style={{
              left: anchorX,
              top: "100%",
              transform: "translateX(-50%)",
              marginTop: 8,
              width: 320,
              maxWidth: "90vw",
              background: "rgba(255,255,255,0.98)",
              border: `1px solid ${appleVibe.stroke.soft}`,
              borderRadius: 12,
              boxShadow: appleVibe.shadow.card,
              padding: "10px 12px",
            }}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: activeSeg.color }}
                aria-hidden
              />
              <span
                className={appleVibe.label.className}
                style={{ color: appleVibe.text.tertiary }}
              >
                {activeSeg.tag ? LAYER_LABEL[activeSeg.tag] : "Reading"}
              </span>
            </div>
            <p
              className="text-[12.5px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary, letterSpacing: "-0.005em" }}
            >
              {activeSeg.reading}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
