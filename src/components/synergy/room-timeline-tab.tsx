// ── RoomTimelineTab — chronological event list (no outer shell) ──
//
// Extracted from the original RoomTimelineRail so the right-rail shell
// can swap between Timeline and Chat without re-creating the parent
// component. Renders the filter pills + scrollable list ONLY; the
// shell owns the header and the tab bar.

"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CornerDownLeft,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { abstractAvatarStyle } from "@/lib/synergy/abstract-avatar";
import type { RoomEvent } from "@/hooks/synergy/use-room-events";

interface Props {
  events: RoomEvent[];
  loading: boolean;
  myUserId: string;
  theirDisplayName: string | null;
}

type Filter = "all" | "mine" | "theirs";

export function RoomTimelineTab({
  events,
  loading,
  myUserId,
  theirDisplayName,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "mine") return events.filter((e) => e.actor_id === myUserId);
    return events.filter((e) => e.actor_id !== myUserId);
  }, [events, filter, myUserId]);

  // Newest first feels right in an activity log.
  const displayEvents = useMemo(
    () => filtered.slice().reverse(),
    [filtered],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Filter pills */}
      <div className="border-b border-gray-200/70 px-4 py-2.5">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-gray-50 p-0.5 text-[10px] font-medium">
          {(
            [
              { key: "all", label: "All" },
              { key: "mine", label: "You" },
              { key: "theirs", label: theirDisplayName ?? "Anon" },
            ] as { key: Filter; label: string }[]
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={[
                "rounded-full px-2.5 py-1 transition",
                filter === opt.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:text-gray-900",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 rounded-md bg-gray-50"
                style={{
                  animation: "roomTimelineShimmer 1.6s ease-in-out infinite",
                  animationDelay: `${i * 0.12}s`,
                }}
              />
            ))}
          </div>
        ) : displayEvents.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <ul className="flex flex-col gap-3">
            {displayEvents.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                myUserId={myUserId}
                theirDisplayName={theirDisplayName}
              />
            ))}
          </ul>
        )}
      </div>

      <style jsx global>{`
        @keyframes roomTimelineShimmer {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

function EventRow({
  event,
  myUserId,
  theirDisplayName,
}: {
  event: RoomEvent;
  myUserId: string;
  theirDisplayName: string | null;
}) {
  const mine = event.actor_id === myUserId;
  const actorLabel = mine ? "You" : theirDisplayName ?? "Anon";
  const Icon = ICON_FOR_KIND[event.kind] ?? Activity;
  const verb = VERB_FOR_KIND[event.kind] ?? "did";

  return (
    <li className="flex items-start gap-2.5">
      <div
        style={{
          ...abstractAvatarStyle(event.actor_id, 20),
          flexShrink: 0,
          fontSize: 8.5,
        }}
        title={actorLabel}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-[11.5px] leading-snug">
          <span
            className={[
              "font-semibold",
              mine ? "text-gray-900" : "text-gray-800",
            ].join(" ")}
          >
            {actorLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Icon className="h-3 w-3" strokeWidth={1.75} />
            {verb}
          </span>
        </div>
        <p
          className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-gray-700"
          title={event.summary}
        >
          {event.summary}
        </p>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-gray-400">
          {relativeTime(event.created_at)}
        </div>
      </div>
    </li>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const msg =
    filter === "mine"
      ? "Nothing from you yet."
      : filter === "theirs"
        ? "Nothing from them yet."
        : "No activity yet.";
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Activity className="h-4 w-4 text-gray-300" strokeWidth={1.5} />
      <p className="text-[11.5px] text-gray-500">{msg}</p>
      <p className="max-w-[180px] text-[10px] leading-relaxed text-gray-400">
        Every node added, edited, linked, or removed shows up here in
        chronological order.
      </p>
    </div>
  );
}

// ── Lookup tables ──────────────────────────────────────────────────

const ICON_FOR_KIND: Record<RoomEvent["kind"], typeof Activity> = {
  node_added: Plus,
  node_edited: Pencil,
  node_moved: ArrowRight,
  node_deleted: Trash2,
  node_linked: Link2,
  note: CornerDownLeft,
};

const VERB_FOR_KIND: Record<RoomEvent["kind"], string> = {
  node_added: "added",
  node_edited: "edited",
  node_moved: "moved",
  node_deleted: "removed",
  node_linked: "linked",
  note: "noted",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1_000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
