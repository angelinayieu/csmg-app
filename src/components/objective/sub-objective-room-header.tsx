"use client";

// ── Sub-Objective Room Header ─────────────────────────────────────
//
// Top-of-page chrome for /app/objective/[spaceId]/sub/[subId]:
//
//   1. Lab-style breadcrumb bar (full-width hairline strip, same
//      chrome as the lab page so the two surfaces feel like one
//      product). Back-link arrow slides on hover.
//
//   2. Annotated title — h1 renders the sub-objective's title with
//      colored inline underlines for each annotation whose offset
//      falls within the title text. The title itself is the canvas
//      for the readings (no separate "title block" + "lens block").
//
//   3. Counters note — a quiet left-ruled statement (no tinted box,
//      no icon chip): a small pain-lane dot + sentence-case "Counters"
//      label + the body sentence in clean, readable type.
//
// Motion: staggered fade-up entrance with the canvas easing curve.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { AnnotatedHeading } from "./annotated-heading";
import { ARCHETYPE_COLOR } from "./objective-stack";
import type { ObjectiveAnnotation } from "@/components/objective/annotated-objective-card";
import type { LayerArchetype } from "@/lib/objective-canvas/layer-model";

interface Props {
  spaceId: string;
  title: string;
  /** Annotations whose offsets fall within the title text. Rendered
   *  as inline colored underlines on the h1. */
  titleAnnotations: ObjectiveAnnotation[];
  /** Room-level pain — the consequence this entire room exists to
   *  counter. Surfaced as the "Counters" callout. */
  topNegativeOutcome?: string | null;
  /** Where this room sits on the outer ObjectiveStack, e.g.
   *  "L3 · Goal Conversion". Rendered as an archetype-colored chip in
   *  the breadcrumb so the room's altitude in the macro causal stack
   *  is visible from inside. Null when the room is untagged / no
   *  stack exists. */
  placement?: { label: string; archetype: LayerArchetype } | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function SubObjectiveRoomHeader({
  spaceId,
  title,
  titleAnnotations,
  topNegativeOutcome,
  placement = null,
}: Props) {
  const reduce = useReducedMotion();
  const placementColor = placement
    ? ARCHETYPE_COLOR[placement.archetype]
    : null;

  return (
    <>
      {/* Breadcrumb bar — lab-style hairline strip. Full-width sits
          flush against the canvas backdrop. */}
      <div
        className="border-b"
        style={{
          background: appleVibe.surface.card,
          borderColor: appleVibe.stroke.hairline,
        }}
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-8 py-3">
          <Link
            href={`/app/objective/${spaceId}`}
            className="group inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors"
            style={{ color: appleVibe.text.tertiary }}
            aria-label="Back to canvas"
          >
            <ArrowLeft
              className="h-3 w-3 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
              strokeWidth={2.4}
            />
            <span className="transition-opacity duration-150 group-hover:opacity-75">
              Back to canvas
            </span>
          </Link>
          <span
            className="text-[11px]"
            style={{ color: appleVibe.text.faint }}
            aria-hidden
          >
            /
          </span>
          <span
            className="truncate text-[11px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
            title={title}
          >
            {title}
          </span>
          <span
            className="text-[11px]"
            style={{ color: appleVibe.text.faint }}
            aria-hidden
          >
            /
          </span>
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.accent.primary }}
          >
            Room
          </span>
          {placement && placementColor && (
            <span
              className="ml-1 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: `${placementColor}12`,
                color: placementColor,
                boxShadow: `inset 0 0 0 1px ${placementColor}2E`,
              }}
              title={`This room operates at ${placement.label} in the objective stack`}
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: placementColor }}
                aria-hidden
              />
              {placement.label}
            </span>
          )}
        </div>
      </div>

      {/* Page header proper — annotated title + Counters callout. */}
      <div className="mx-auto max-w-[1400px] px-8 pb-2 pt-10">
        <div className="max-w-3xl">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <AnnotatedHeading
              text={title}
              annotations={titleAnnotations}
              className="text-[30px] font-semibold leading-[1.15]"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
                letterSpacing: "-0.026em",
              }}
            />
          </motion.div>

          {topNegativeOutcome && (
            <CountersCallout
              text={topNegativeOutcome}
              reduce={Boolean(reduce)}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ── Counters note ─────────────────────────────────────────────────
//
// Modern + simple: no tinted box, no icon chip. A thin pain-lane left
// rule + a small dot + sentence-case "Counters" label, with the body
// sentence as the focus in clean, readable type.

function CountersCallout({
  text,
  reduce,
}: {
  text: string;
  reduce: boolean;
}) {
  const accent = appleVibe.stage.pain;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.08, ease: EASE }}
      className="mt-5 max-w-2xl"
      // No tinted box, no icon chip — just a quiet left rule (the only
      // whisper of the pain lane) + a sentence-case label + readable text.
      style={{ paddingLeft: 16, borderLeft: `2px solid ${accent}40` }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: accent }}
          aria-hidden
        />
        <span
          className="text-[10.5px] font-medium tracking-tight"
          style={{ color: appleVibe.text.tertiary }}
        >
          Counters
        </span>
      </div>
      <p
        className="mt-1.5 text-[15px] font-light leading-[1.5]"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.01em",
        }}
      >
        {text}
      </p>
    </motion.div>
  );
}
