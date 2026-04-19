"use client";

// Phase 42 — Continue row for the studio dashboard.
//
// Surfaces the user's most-recent reactions across *every* space they
// own, so returning to /app lands them directly back into their thinking
// without hunting through the space list first.
//
// Design goals:
//   - Fits the existing light-glass dashboard aesthetic
//   - Carries the reaction-type color grammar established in the lab &
//     synthesis feed (emergent=green, reinforcing=cyan, tension=pink,
//     trivial=violet) so the visual language is unified
//   - One click = back in the lab with ?rxn=<id> pre-focused (Phase 27
//     URL state picks it up)
//   - Degrades gracefully: if a reaction's home space is missing,
//     fallback to the space-lab route; if both are missing, link to /app
//
// Non-goals (future phases):
//   - Aggregating non-reaction event types (decompositions, bridges)
//   - Recency-weighted ordering across event kinds
//   - Pinning / starring / dismissing

import Link from "next/link";
import { Clock, FlaskConical } from "lucide-react";
import type { Space } from "@/types";
import type { Reaction, ReactionType } from "@/types/reactions";

export interface StudioContinueRowProps {
  reactions: Reaction[];
  spaces: Space[];
}

const REACTION_TYPE_COLOR: Record<ReactionType, string> = {
  emergent: "#16a34a",        // green-600 — darker for light-bg contrast
  reinforcing: "#0891b2",     // cyan-600
  tension: "#db2777",          // pink-600
  trivial: "#64748b",          // slate-500
};
const REACTION_TYPE_BG: Record<ReactionType, string> = {
  emergent: "#dcfce7",        // green-100
  reinforcing: "#cffafe",     // cyan-100
  tension: "#fce7f3",         // pink-100
  trivial: "#f1f5f9",         // slate-100
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 8) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export function StudioContinueRow({
  reactions,
  spaces,
}: StudioContinueRowProps) {
  const spacesById = new Map(spaces.map((s) => [s.id, s]));
  // Cap at 4 so the row stays scannable even on 1440px widths.
  const visible = reactions.slice(0, 4);

  return (
    <div className="w-full max-w-[1040px]">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-3 w-3 text-gray-400" />
        <h2 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gray-500">
          Continue your thinking
        </h2>
        <div className="h-px flex-1 bg-gray-200/70" />
        <span className="text-[10px] font-medium text-gray-400">
          {reactions.length === 1
            ? "1 recent reaction"
            : `${reactions.length} recent`}
        </span>
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(visible.length, 4)}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((r) => (
          <ContinueTile
            key={r.id}
            reaction={r}
            space={spacesById.get(r.space_id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function ContinueTile({
  reaction,
  space,
}: {
  reaction: Reaction;
  space: Space | null;
}) {
  const color = REACTION_TYPE_COLOR[reaction.reaction_type];
  const bg = REACTION_TYPE_BG[reaction.reaction_type];
  const prob = Math.round(reaction.probability * 100);

  // Deep-link: prefer the first participant entity's node lab with the
  // reaction focused; fall back to the space lab; last resort /app.
  const drillEntityId = reaction.entity_ids[0];
  const href = space?.id && drillEntityId
    ? `/app/space/${space.id}/entity/${drillEntityId}/lab?rxn=${reaction.id}`
    : space?.id
      ? `/app/space/${space.id}/lab?rxn=${reaction.id}`
      : "/app";

  return (
    <Link
      href={href}
      className="glass-tile group relative"
      style={{
        // Override the default glass-tile horizontal layout — this
        // variant is denser and stacks vertically.
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
        padding: "12px 14px",
        minHeight: 112,
        textDecoration: "none",
      }}
      title={`${reaction.name} · ${space?.name ?? "(space)"}`}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          zIndex: 1,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 3,
            background: bg,
            color,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: color,
            }}
          />
          {reaction.reaction_type}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "#94a3b8",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.08em",
            marginLeft: "auto",
          }}
        >
          {relativeTime(reaction.created_at)}
        </span>
      </div>

      <div
        style={{
          position: "relative",
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.3,
          color: "#0f172a",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          zIndex: 1,
          flex: 1,
        }}
      >
        {reaction.name}
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10,
          color: "#64748b",
          zIndex: 1,
        }}
      >
        <FlaskConical
          style={{ width: 10, height: 10, color: "#94a3b8" }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {space?.name ?? "(space)"}
        </span>
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontWeight: 700,
            color,
          }}
        >
          {prob}%
        </span>
      </div>
    </Link>
  );
}
