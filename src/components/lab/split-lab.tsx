"use client";

// ── Split lab (A/B comparator render) ──
//
// Renders two `SpaceLab` instances side-by-side. Each gets its own
// narrowed entities + edges + heroes (the lab page does the
// per-system narrowing before passing them in). Both run their own
// state independently — what-if scenarios, mode picker, chamber
// view all isolated per side. Users compare by running the same
// scenario on each side and reading the two distributions.
//
// Mounted by the lab page when `?systemId=<A>&systemB=<B>` is
// present in the URL. Exits to single-system mode by clicking
// "Single view" in the split chrome strip → drops the systemB
// param and re-renders as a normal scoped lab.
//
// The two-column CSS grid divides viewport in half. SpaceLab uses
// `h-full w-full` internally so each side scales correctly. The
// only thing the split context provides on top of the existing
// SpaceLab is the chrome strip + the divider.

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeftRight, X } from "lucide-react";
import { SpaceLab } from "./space-lab";
import type { Entity, Edge, Bridge, Space } from "@/types";
import type { Reaction } from "@/types/reactions";
import type { System } from "@/types/system";

export interface SplitLabSide {
  /** The saved system this side is scoped to. */
  system: System;
  /** Hero entities pre-computed for this side's narrowed entity set. */
  heroes: Entity[];
  /** Entities narrowed to system.entity_ids (matches the system's
   *  composition). */
  entities: Entity[];
  /** Edges narrowed to system.edge_ids. */
  edges: Edge[];
}

export interface SplitLabProps {
  space: Space;
  /** Reactions are space-wide; both sides see the same set. Filtering
   *  to a system's reactions would require joining reactions to
   *  entity_ids — defer to a follow-up. */
  reactions: Reaction[];
  /** Bridges are space-wide too. */
  bridges: Bridge[];
  /** Partner entities for cross-space bridges — same on both sides. */
  partnerEntities: Entity[];

  sideA: SplitLabSide;
  sideB: SplitLabSide;
}

export function SplitLab({
  space,
  reactions,
  bridges,
  partnerEntities,
  sideA,
  sideB,
}: SplitLabProps) {
  // Hrefs used by the chrome strip — single-view drops `systemB`,
  // swap-flip swaps which side is "active" (the URL param order
  // determines visual order in this layout, so a swap flips the
  // visual columns).
  const hrefSideAOnly = `/app/space/${space.id}/lab?systemId=${sideA.system.id}`;
  const hrefSideBOnly = `/app/space/${space.id}/lab?systemId=${sideB.system.id}`;
  const hrefSwap = `/app/space/${space.id}/lab?systemId=${sideB.system.id}&systemB=${sideA.system.id}`;

  // Quick summary line for the strip — characterizes the comparison
  // dimensionally so users see what's actually being contrasted.
  const contrastLabel = useMemo(() => {
    const aFlags: string[] = [];
    const bFlags: string[] = [];
    if (sideA.system.is_complex) aFlags.push("complex");
    if (sideA.system.is_probabilistic) aFlags.push("probabilistic");
    if (sideA.system.is_open) aFlags.push("open");
    if (sideB.system.is_complex) bFlags.push("complex");
    if (sideB.system.is_probabilistic) bFlags.push("probabilistic");
    if (sideB.system.is_open) bFlags.push("open");
    const aStr = aFlags.length > 0 ? aFlags.join("·") : "simple";
    const bStr = bFlags.length > 0 ? bFlags.join("·") : "simple";
    if (aStr === bStr) return `both: ${aStr}`;
    return `${aStr} vs ${bStr}`;
  }, [sideA.system, sideB.system]);

  return (
    // Phase A — force light theme on SplitLab.
    <div data-theme="blue" className="flex h-full w-full flex-col bg-[var(--lab-bg)]">
      {/* ── Split chrome strip ───────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--lab-border)] bg-[rgba(8,145,178,0.10)] px-4 py-2 text-[11px] text-cyan-100">
        <span className="font-bold uppercase tracking-[0.14em] text-cyan-300">
          A/B split
        </span>
        <span className="text-cyan-400/60">·</span>
        <span className="font-medium">
          <span className="text-cyan-50">{sideA.system.name}</span>
          <span className="mx-1.5 text-cyan-400/60">↔</span>
          <span className="text-cyan-50">{sideB.system.name}</span>
        </span>
        <span className="text-cyan-400/60">·</span>
        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono tabular-nums text-[10px] text-cyan-200">
          {contrastLabel}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Link
            href={hrefSwap}
            className="inline-flex items-center gap-1 rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
            title="Swap which system sits in column A vs column B"
          >
            <ArrowLeftRight className="h-3 w-3" /> Swap columns
          </Link>
          <Link
            href={hrefSideAOnly}
            className="rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] font-medium text-cyan-100 transition hover:bg-cyan-500/20"
            title="Exit split — show only column A"
          >
            Single A
          </Link>
          <Link
            href={hrefSideBOnly}
            className="rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] font-medium text-cyan-100 transition hover:bg-cyan-500/20"
            title="Exit split — show only column B"
          >
            Single B
          </Link>
          <Link
            href={`/app/space/${space.id}/lab`}
            className="inline-flex items-center gap-1 rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] font-medium text-cyan-100 transition hover:bg-cyan-500/20"
            title="Exit comparison and the system scope"
          >
            <X className="h-3 w-3" />
            Exit
          </Link>
        </span>
      </div>

      {/* ── Split body ────────────────────────────────────────────── */}
      <div
        className="grid flex-1 overflow-hidden"
        style={{ gridTemplateColumns: "1fr 2px 1fr" }}
      >
        <div className="min-w-0 overflow-hidden">
          <SpaceLab
            space={space}
            heroes={sideA.heroes}
            entities={sideA.entities}
            edges={sideA.edges}
            reactions={reactions}
            bridges={bridges}
            partnerEntities={partnerEntities}
            scopedSystem={sideA.system}
            // No comparedSystem here — the SplitLab chrome IS the
            // comparator surface. The single-side A/B nav pill
            // (which shows up only when scopedSystem + comparedSystem
            // are both set on a SpaceLab in single mode) is
            // intentionally suppressed.
          />
        </div>
        {/* Vertical divider — subtle gradient so it doesn't compete
            with the chamber visuals. */}
        <div
          aria-hidden
          className="h-full bg-gradient-to-b from-cyan-500/25 via-cyan-300/20 to-cyan-500/25"
        />
        <div className="min-w-0 overflow-hidden">
          <SpaceLab
            space={space}
            heroes={sideB.heroes}
            entities={sideB.entities}
            edges={sideB.edges}
            reactions={reactions}
            bridges={bridges}
            partnerEntities={partnerEntities}
            scopedSystem={sideB.system}
          />
        </div>
      </div>
    </div>
  );
}
