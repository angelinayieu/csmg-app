"use client";

// Phase 36 — Synthesis Feed.
//
// The missing surface from the original review (K4 / "synthesis has no
// home"). A reverse-chronological reactor-glass feed of every piece of
// thinking the user has accumulated in a space. Today's event types:
//
//   - Saved reactions (Phase 11 payload)
//
// Future event types (planned):
//   - Decomposition events (entity.decomposition_probed_at)
//   - Cross-space bridge creation
//   - Ingest events (file → entity materialization)
//   - AI receipts (auto-decompose actions)
//
// Design goals:
//   - First impression: "this is where my thinking lives over time"
//   - Every event is openable back into the working surface (lab/canvas)
//   - Empty state teaches users what produces feed entries
//   - Uses Reactor Glass (Phase 33) end-to-end — one visual language
//
// Non-goals for this phase:
//   - Drag-to-cluster (future: synthesis-of-synthesis)
//   - Pinning / starring / filtering
//   - Editing events (T4 reaction CRUD will add delete+edit)

import {
  useCallback,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  FlaskConical,
  Layers,
  Network,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Bridge, Entity, Space } from "@/types";
import type { Reaction, ReactionType } from "@/types/reactions";
import { ReactorGlass } from "@/components/shared/reactor-glass";
import { ReactionHoverPreview } from "@/components/shared/reaction-preview";
import {
  useSynthesisClusters,
  type ClusterMember,
  type ClusterMemberKind,
  type PersistedCluster,
} from "./use-synthesis-clusters";

const DRAG_MIME = "application/x-synthesis-event";

export interface SynthesisFeedProps {
  space: Space;
  reactions: Reaction[];
  entities: Entity[];
  /**
   * Phase 37: cross-space bridges touching this space. The migration
   * 20260502 adds `created_at` but it isn't in the generated types yet,
   * so the field is widened here.
   */
  bridges?: Array<Bridge & { created_at?: string | null }>;
  /** Phase 37: UUID → display name for partner spaces in bridges. */
  partnerSpaceNames?: Record<string, string>;
  /** Phase 37: hydrated rows for entities referenced by cross-space bridges. */
  partnerEntities?: Entity[];
}

const REACTION_TYPE_COLOR: Record<ReactionType, string> = {
  emergent: "#4ade80",
  reinforcing: "#22d3ee",
  tension: "#f472b6",
  trivial: "#94a3b8",
};
const REACTION_TYPE_TINT: Record<
  ReactionType,
  "green" | "cyan" | "pink" | "violet"
> = {
  emergent: "green",
  reinforcing: "cyan",
  tension: "pink",
  trivial: "violet",
};

type FeedEvent =
  | {
      kind: "reaction";
      id: string;
      at: string;
      reaction: Reaction;
    }
  | {
      kind: "decomposition";
      id: string;
      at: string;
      parent: Entity;
      children: Entity[];
    }
  | {
      kind: "bridge";
      id: string;
      at: string;
      bridge: Bridge & { created_at?: string | null };
      /** True when this space is the source side of the bridge. */
      thisIsSource: boolean;
      /** Partner entity resolved from context; may be null on RLS miss. */
      partner: Entity | null;
      /** Partner-space display name (or "(other space)" fallback). */
      partnerSpaceName: string;
    }
  | {
      kind: "cluster";
      id: string;
      at: string;
      cluster: PersistedCluster;
      /** Resolved member events. Missing refs are dropped silently. */
      memberEvents: FeedEvent[];
    };

const COUPLING_WEIGHT: Record<Bridge["coupling_strength"], number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
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

function sortByAtDesc<T extends { at: string }>(xs: T[]): T[] {
  return [...xs].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}

/**
 * Phase 40 — cycle guard for nested clusters.
 *
 * We're about to add `childId` as a member of `parentId`. That would
 * create a cycle if `parentId` is already a descendant of `childId`
 * (directly or transitively). Walk down from `childId` checking.
 */
function wouldCreateCycle(
  clusters: PersistedCluster[],
  parentId: string,
  childId: string,
): boolean {
  if (parentId === childId) return true;
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const stack = [childId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === parentId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    if (!c) continue;
    for (const m of c.members) {
      if (m.kind === "cluster") stack.push(m.id);
    }
  }
  return false;
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Phase 38 — lowercase text bag for search. Keep this a pure function so
// the useMemo in the main component doesn't need to rebuild per keystroke.
// Phase 39: cluster text bag = cluster name + every member's haystack,
// so clusters match search when their content matches.
function buildHaystack(ev: FeedEvent): string {
  const parts: Array<string | null | undefined> = [];
  if (ev.kind === "reaction") {
    parts.push(
      ev.reaction.name,
      ev.reaction.reaction_type,
      ev.reaction.mechanism,
      ev.reaction.implication,
    );
  } else if (ev.kind === "decomposition") {
    parts.push(ev.parent.name, "decomposition probe");
    for (const c of ev.children) parts.push(c.name);
  } else if (ev.kind === "bridge") {
    parts.push(
      ev.bridge.shared_variable_name,
      ev.bridge.bridge_type,
      ev.bridge.description,
      ev.partner?.name,
      ev.partnerSpaceName,
    );
  } else {
    // cluster
    parts.push(ev.cluster.name, "cluster");
    for (const m of ev.memberEvents) parts.push(buildHaystack(m));
  }
  return parts
    .filter((p): p is string => typeof p === "string")
    .join(" ")
    .toLowerCase();
}

export function SynthesisFeed({
  space,
  reactions,
  entities,
  bridges = [],
  partnerSpaceNames = {},
  partnerEntities = [],
}: SynthesisFeedProps) {
  const entitiesByUuid = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) m.set(e.id, e);
    for (const e of partnerEntities) m.set(e.id, e);
    return m;
  }, [entities, partnerEntities]);

  // Phase 37: index children by their parent_entity_id so each
  // decomposition event can surface its produced subunits inline.
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Entity[]>();
    for (const e of entities) {
      const prov = e.provenance as
        | { parent_entity_id?: string | null }
        | null
        | undefined;
      const pid =
        prov && typeof prov === "object" ? prov.parent_entity_id ?? null : null;
      if (!pid) continue;
      const arr = m.get(pid);
      if (arr) arr.push(e);
      else m.set(pid, [e]);
    }
    return m;
  }, [entities]);

  // Phase 39: localStorage-backed clusters (v1). A future phase will
  // swap this for server persistence without changing the interface.
  const {
    clusters,
    createCluster,
    addToCluster,
    deleteCluster,
    renameCluster,
    removeMember,
  } = useSynthesisClusters(space.id);

  // Step 1: materialize the flat (primitive) event stream. Clusters are
  // built on top of this in Step 2.
  const primitiveEvents = useMemo<FeedEvent[]>(() => {
    const list: FeedEvent[] = [];

    for (const r of reactions) {
      list.push({ kind: "reaction", id: r.id, at: r.created_at, reaction: r });
    }

    for (const e of entities) {
      const at = e.decomposition_probed_at;
      if (!at) continue;
      const children = childrenByParent.get(e.id) ?? [];
      if (children.length === 0) continue;
      list.push({
        kind: "decomposition",
        id: `decomp-${e.id}`,
        at,
        parent: e,
        children,
      });
    }

    for (const b of bridges) {
      const at = b.created_at ?? null;
      if (!at) continue;
      const thisIsSource = b.source_space_id === space.id;
      const partnerId = thisIsSource ? b.target_entity_id : b.source_entity_id;
      const partnerSpaceId = thisIsSource
        ? b.target_space_id
        : b.source_space_id;
      list.push({
        kind: "bridge",
        id: `bridge-${b.id}`,
        at,
        bridge: b,
        thisIsSource,
        partner: entitiesByUuid.get(partnerId) ?? null,
        partnerSpaceName: partnerSpaceNames[partnerSpaceId] ?? "(other space)",
      });
    }

    return list;
  }, [
    reactions,
    entities,
    bridges,
    childrenByParent,
    entitiesByUuid,
    partnerSpaceNames,
    space.id,
  ]);

  // Step 2: fold clusters in. Phase 40 — clusters can nest, so this is
  // a two-pass resolution:
  //   1. Build a synthetic "cluster event" for every persisted cluster,
  //      with memberEvents deferred (we don't know nested contents yet).
  //   2. Walk each cluster and resolve members: primitive members come
  //      from primitiveIndex; cluster members come from clusterById.
  //      Track "claimed" so primitives and nested clusters both
  //      disappear from the top level.
  const events = useMemo<FeedEvent[]>(() => {
    if (clusters.length === 0) return sortByAtDesc(primitiveEvents);

    const primitiveIndex = new Map<string, FeedEvent>();
    for (const ev of primitiveEvents) {
      primitiveIndex.set(`${ev.kind}:${ev.id}`, ev);
    }

    // Pass 1 — shell events, memberEvents to be filled.
    const shellById = new Map<
      string,
      FeedEvent & { kind: "cluster"; memberEvents: FeedEvent[] }
    >();
    for (const c of clusters) {
      shellById.set(c.id, {
        kind: "cluster",
        id: `cluster-${c.id}`,
        at: c.updated_at,
        cluster: c,
        memberEvents: [],
      });
    }

    // Pass 2 — resolve members, record what's claimed.
    const claimed = new Set<string>();
    for (const c of clusters) {
      const shell = shellById.get(c.id)!;
      for (const m of c.members) {
        if (m.kind === "cluster") {
          const nestedShell = shellById.get(m.id);
          if (!nestedShell) continue; // stale ref
          claimed.add(`cluster:${m.id}`);
          shell.memberEvents.push(nestedShell);
        } else {
          const k = `${m.kind}:${m.id}`;
          const resolved = primitiveIndex.get(k);
          if (!resolved) continue;
          claimed.add(k);
          shell.memberEvents.push(resolved);
        }
      }
    }

    // Top-level: primitives not claimed + clusters not claimed (i.e.
    // unnested clusters). Clusters with <2 members are hidden at render
    // but remain in storage for explicit delete.
    const topLevel: FeedEvent[] = [];
    for (const ev of primitiveEvents) {
      if (!claimed.has(`${ev.kind}:${ev.id}`)) topLevel.push(ev);
    }
    for (const c of clusters) {
      const shell = shellById.get(c.id)!;
      if (shell.memberEvents.length < 2) continue;
      if (claimed.has(`cluster:${c.id}`)) continue;
      topLevel.push(shell);
    }
    return sortByAtDesc(topLevel);
  }, [primitiveEvents, clusters]);

  const typeCounts = useMemo(() => {
    const c: Record<ReactionType, number> = {
      emergent: 0,
      reinforcing: 0,
      tension: 0,
      trivial: 0,
    };
    for (const r of reactions) c[r.reaction_type] += 1;
    return c;
  }, [reactions]);

  // Phase 37: per-event-kind counts so the header can show a richer
  // summary. Decomposition + bridge events still add to `events.length`;
  // the pip row shows only reaction types for color consistency.
  const kindCounts = useMemo(() => {
    let reaction = 0;
    let decomposition = 0;
    let bridge = 0;
    let cluster = 0;
    for (const e of events) {
      if (e.kind === "reaction") reaction++;
      else if (e.kind === "decomposition") decomposition++;
      else if (e.kind === "bridge") bridge++;
      else cluster++;
    }
    return { reaction, decomposition, bridge, cluster };
  }, [events]);

  // ─── Phase 38: search + filter state ───
  const [query, setQuery] = useState("");
  const [enabledKinds, setEnabledKinds] = useState<
    Record<"reaction" | "decomposition" | "bridge" | "cluster", boolean>
  >({ reaction: true, decomposition: true, bridge: true, cluster: true });
  const [enabledReactionTypes, setEnabledReactionTypes] = useState<
    Record<ReactionType, boolean>
  >({ emergent: true, reinforcing: true, tension: true, trivial: true });
  const [timeWindow, setTimeWindow] = useState<
    "24h" | "7d" | "30d" | "all"
  >("all");

  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const windowMs =
      timeWindow === "24h"
        ? 24 * 3600 * 1000
        : timeWindow === "7d"
          ? 7 * 24 * 3600 * 1000
          : timeWindow === "30d"
            ? 30 * 24 * 3600 * 1000
            : Number.POSITIVE_INFINITY;

    return events.filter((ev) => {
      // Kind filter
      if (!enabledKinds[ev.kind]) return false;

      // Time filter
      if (windowMs !== Number.POSITIVE_INFINITY) {
        const age = now - new Date(ev.at).getTime();
        if (age > windowMs) return false;
      }

      // Reaction-type filter (only applies to reactions)
      if (ev.kind === "reaction") {
        if (!enabledReactionTypes[ev.reaction.reaction_type]) return false;
      }

      // Search — substring match across the card's textual surface.
      if (q.length > 0) {
        const haystack = buildHaystack(ev);
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [events, query, enabledKinds, enabledReactionTypes, timeWindow]);

  const filtersActive =
    query.trim().length > 0 ||
    Object.values(enabledKinds).some((v) => !v) ||
    Object.values(enabledReactionTypes).some((v) => !v) ||
    timeWindow !== "all";

  const clearFilters = () => {
    setQuery("");
    setEnabledKinds({
      reaction: true,
      decomposition: true,
      bridge: true,
      cluster: true,
    });
    setEnabledReactionTypes({
      emergent: true,
      reinforcing: true,
      tension: true,
      trivial: true,
    });
    setTimeWindow("all");
  };

  // Phase 39 + 40: drop handler. Combining rules:
  //   primitive ↔ primitive  → create new cluster containing both
  //   primitive → cluster    → add primitive to cluster
  //   cluster → primitive    → add primitive to cluster (symmetric)
  //   cluster → cluster      → Phase 40: NEST — dropped becomes a member
  //                             of target; guard against A→A and cycles
  //   self-drop              → no-op
  const handleClusterDrop = useCallback(
    (target: ClusterMember, dropped: ClusterMember) => {
      if (target.kind === dropped.kind && target.id === dropped.id) return;
      if (target.kind === "cluster" && dropped.kind === "cluster") {
        // Phase 40 nesting — guard cycles. A cluster can't contain an
        // ancestor of itself (that would loop forever at render).
        if (wouldCreateCycle(clusters, target.id, dropped.id)) return;
        addToCluster(target.id, [dropped]);
        return;
      }
      if (target.kind === "cluster") {
        addToCluster(target.id, [dropped]);
        return;
      }
      if (dropped.kind === "cluster") {
        addToCluster(dropped.id, [target]);
        return;
      }
      createCluster([target, dropped]);
    },
    [addToCluster, createCluster, clusters],
  );

  // Day-grouping runs on the filtered stream so day headers disappear
  // when all their events are filtered out. Declared AFTER filteredEvents
  // to respect TDZ (const bindings can't be referenced before init).
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, FeedEvent[]>();
    for (const e of filteredEvents) {
      const day = new Date(e.at);
      day.setHours(0, 0, 0, 0);
      const key = day.toISOString();
      const arr = groups.get(key);
      if (arr) arr.push(e);
      else groups.set(key, [e]);
    }
    return groups;
  }, [filteredEvents]);

  return (
    <div
      className="reactor-particles flex h-full flex-col overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 30% 10%, rgba(74, 222, 128, 0.06) 0%, transparent 55%), #02050a",
        color: "#e8edf4",
      }}
    >
      {/* ── Header ── */}
      <header
        className="relative flex h-[52px] shrink-0 items-center gap-4 border-b border-[#94a3b8]/[0.08] px-4"
        style={{
          boxShadow: "inset 0 -1px 0 rgba(74,222,128,0.12)",
          background: "rgba(10, 15, 23, 0.72)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          zIndex: 2,
        }}
      >
        <Link
          href={`/app/space/${space.id}`}
          className="group flex items-center gap-1.5 text-[11px] font-semibold text-[#a8b3c4] transition-colors hover:text-[#e8edf4]"
          title={`Back to ${space.name}`}
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
          {space.name}
        </Link>
        <div className="h-6 w-px bg-[#94a3b8]/[0.14]" />
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#4ade80]">
              Synthesis Feed
            </div>
            <div className="text-[16px] font-bold leading-tight text-[#e8edf4]">
              Your thinking over time
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-[#475569]">
            <span>
              {filtersActive ? (
                <>
                  <span style={{ color: "#4ade80" }}>
                    {filteredEvents.length}
                  </span>
                  <span> / {events.length} EVENTS</span>
                </>
              ) : (
                <>{events.length} EVENTS</>
              )}
            </span>
            {kindCounts.reaction > 0 && (
              <>
                <span>·</span>
                <TypePips counts={typeCounts} />
              </>
            )}
            {kindCounts.decomposition > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#a78bfa",
                      boxShadow: "0 0 4px #a78bfa",
                    }}
                  />
                  <span style={{ color: "#a78bfa" }}>
                    {kindCounts.decomposition}
                  </span>
                </span>
              </>
            )}
            {kindCounts.bridge > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#22d3ee",
                      boxShadow: "0 0 4px #22d3ee",
                    }}
                  />
                  <span style={{ color: "#22d3ee" }}>{kindCounts.bridge}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Phase 38 — filter bar. Hidden in the empty-state case so we
          don't mock users with search over zero events. */}
      {events.length > 0 && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          enabledKinds={enabledKinds}
          onKindToggle={(kind) =>
            setEnabledKinds((prev) => ({ ...prev, [kind]: !prev[kind] }))
          }
          kindCounts={kindCounts}
          enabledReactionTypes={enabledReactionTypes}
          onReactionTypeToggle={(t) =>
            setEnabledReactionTypes((prev) => ({ ...prev, [t]: !prev[t] }))
          }
          reactionTypeCounts={typeCounts}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
          filtersActive={filtersActive}
          onClear={clearFilters}
        />
      )}

      {/* ── Feed body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {events.length === 0 ? (
          <EmptyState space={space} />
        ) : filteredEvents.length === 0 ? (
          <NoMatchesState onClear={clearFilters} />
        ) : (
          <div className="mx-auto w-full max-w-[720px]">
            {Array.from(groupedByDay.entries()).map(([dayKey, dayEvents]) => (
              <section key={dayKey} className="mb-8 last:mb-0">
                <DayHeader iso={dayKey} />
                <div className="space-y-3">
                  {dayEvents.map((ev) => (
                    <FeedCard
                      key={ev.id}
                      event={ev}
                      space={space}
                      entitiesByUuid={entitiesByUuid}
                      onDropOnMe={handleClusterDrop}
                      onDeleteCluster={deleteCluster}
                      onRemoveMember={removeMember}
                      onRenameCluster={renameCluster}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypePips({ counts }: { counts: Record<ReactionType, number> }) {
  const entries: Array<{ type: ReactionType; count: number }> = [
    { type: "emergent", count: counts.emergent },
    { type: "reinforcing", count: counts.reinforcing },
    { type: "tension", count: counts.tension },
    { type: "trivial", count: counts.trivial },
  ];
  return (
    <span className="inline-flex items-center gap-2">
      {entries
        .filter((e) => e.count > 0)
        .map((e) => (
          <span key={e.type} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: REACTION_TYPE_COLOR[e.type],
                boxShadow: `0 0 4px ${REACTION_TYPE_COLOR[e.type]}`,
              }}
            />
            <span style={{ color: REACTION_TYPE_COLOR[e.type] }}>
              {e.count}
            </span>
          </span>
        ))}
    </span>
  );
}

function DayHeader({ iso }: { iso: string }) {
  const day = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  let label: string;
  if (day.getTime() === today.getTime()) label = "Today";
  else if (day.getTime() === yesterday.getTime()) label = "Yesterday";
  else {
    label = day.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#4ade80]">
        ◦ {label}
      </span>
      <span className="flex-1 border-b border-dashed border-[#94a3b8]/[0.1]" />
    </div>
  );
}

interface FeedCardSharedProps {
  space: Space;
  entitiesByUuid: Map<string, Entity>;
  onDropOnMe: (selfRef: ClusterMember, dropped: ClusterMember) => void;
  onDeleteCluster: (clusterId: string) => void;
  onRemoveMember: (clusterId: string, m: ClusterMember) => void;
  onRenameCluster: (clusterId: string, name: string) => void;
}

function FeedCard({
  event,
  space,
  entitiesByUuid,
  onDropOnMe,
  onDeleteCluster,
  onRemoveMember,
  onRenameCluster,
}: { event: FeedEvent } & FeedCardSharedProps) {
  if (event.kind === "reaction") {
    return (
      <ReactionFeedCard
        reaction={event.reaction}
        space={space}
        entitiesByUuid={entitiesByUuid}
        onDropOnMe={onDropOnMe}
      />
    );
  }
  if (event.kind === "decomposition") {
    return (
      <DecompositionFeedCard
        parent={event.parent}
        children={event.children}
        at={event.at}
        space={space}
        eventId={event.id}
        onDropOnMe={onDropOnMe}
      />
    );
  }
  if (event.kind === "bridge") {
    return (
      <BridgeFeedCard
        bridge={event.bridge}
        thisIsSource={event.thisIsSource}
        partner={event.partner}
        partnerSpaceName={event.partnerSpaceName}
        at={event.at}
        space={space}
        eventId={event.id}
        onDropOnMe={onDropOnMe}
      />
    );
  }
  if (event.kind === "cluster") {
    return (
      <ClusterFeedCard
        cluster={event.cluster}
        memberEvents={event.memberEvents}
        space={space}
        entitiesByUuid={entitiesByUuid}
        onDropOnMe={onDropOnMe}
        onDeleteCluster={onDeleteCluster}
        onRemoveMember={onRemoveMember}
        onRenameCluster={onRenameCluster}
      />
    );
  }
  return null;
}

function ReactionFeedCard({
  reaction,
  space,
  entitiesByUuid,
  onDropOnMe,
}: {
  reaction: Reaction;
  space: Space;
  entitiesByUuid: Map<string, Entity>;
  onDropOnMe: (selfRef: ClusterMember, dropped: ClusterMember) => void;
}) {
  const color = REACTION_TYPE_COLOR[reaction.reaction_type];
  const tint = REACTION_TYPE_TINT[reaction.reaction_type];
  const prob = Math.round(reaction.probability * 100);
  const participants = reaction.entity_ids.map(
    (id) => entitiesByUuid.get(id) ?? null,
  );
  // Prefer the first participant that actually exists as a real entity
  // as the deep-link target; that ensures ?rxn= lands in its node lab.
  const drillEntity = participants.find((p) => p !== null) ?? null;
  const labHref = drillEntity
    ? `/app/space/${space.id}/entity/${drillEntity.id}/lab?rxn=${reaction.id}`
    : `/app/space/${space.id}/lab?rxn=${reaction.id}`;
  const selfRef: ClusterMember = { kind: "reaction", id: reaction.id };

  return (
    <ReactionHoverPreview
      reaction={reaction}
      participants={participants}
      focalEntityId={null}
      openInLabHref={labHref}
    >
      <DraggableFeedCard
        selfRef={selfRef}
        navHref={labHref}
        onDropOnMe={(dropped) => onDropOnMe(selfRef, dropped)}
      >
        <ReactorGlass
          elevation="ambient"
          tint={tint}
          className="group cursor-pointer"
          style={{ padding: 0 }}
        >
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: "56px 1fr auto",
              gap: 16,
              padding: "16px 18px",
            }}
          >
            {/* Left rail: glyph + time */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  background: `${color}18`,
                  border: `1px solid ${color}44`,
                  boxShadow: `0 0 16px ${color}22`,
                  color,
                }}
                aria-hidden
              >
                <FlaskConical style={{ width: 16, height: 16 }} />
              </span>
              <span
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 8.5,
                  letterSpacing: "0.08em",
                  color: "#64748b",
                }}
                title={new Date(reaction.created_at).toLocaleString()}
              >
                {relativeTime(reaction.created_at)}
              </span>
            </div>

            {/* Middle: content */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px",
                    borderRadius: 3,
                    background: `${color}22`,
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
                      boxShadow: `0 0 6px ${color}`,
                    }}
                  />
                  {reaction.reaction_type}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: "#475569",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    letterSpacing: "0.08em",
                  }}
                >
                  REACTION
                </span>
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  color: "#e8edf4",
                  marginBottom: 4,
                }}
                title={reaction.name}
              >
                {reaction.name}
              </div>
              {reaction.mechanism && (
                <div
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    color: "#a8b3c4",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  {reaction.mechanism}
                </div>
              )}
              {reaction.implication && (
                <div
                  style={{
                    fontSize: 10.5,
                    lineHeight: 1.45,
                    color: "#94a3b8",
                    fontStyle: "italic",
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    marginBottom: 10,
                  }}
                >
                  → {reaction.implication}
                </div>
              )}
              {/* Participant chips */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 10,
                }}
              >
                {reaction.entity_ids.map((eid, i) => {
                  const p = participants[i];
                  return (
                    <span
                      key={`${eid}-${i}`}
                      style={{ display: "inline-flex", alignItems: "center" }}
                    >
                      <span
                        style={{
                          display: "inline-grid",
                          placeItems: "center",
                          minWidth: 24,
                          height: 24,
                          padding: "0 6px",
                          borderRadius: 5,
                          background: "rgba(148, 163, 184, 0.08)",
                          border: "1px solid rgba(148, 163, 184, 0.14)",
                          color: "#a8b3c4",
                          fontWeight: 600,
                        }}
                        title={p?.name ?? "(unknown entity)"}
                      >
                        {p ? initialsFor(p.name) : "?"}
                      </span>
                      {i < reaction.entity_ids.length - 1 && (
                        <span style={{ margin: "0 4px", color: "#475569" }}>+</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Right: probability + open */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                alignItems: "flex-end",
                minWidth: 72,
              }}
            >
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  Probability
                </div>
                <div
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 22,
                    fontWeight: 700,
                    color,
                    lineHeight: 1,
                    marginTop: 2,
                  }}
                >
                  {prob}
                  <span
                    style={{
                      marginLeft: 2,
                      fontSize: 10,
                      color: "#64748b",
                    }}
                  >
                    %
                  </span>
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#4ade80",
                  opacity: 0.75,
                  transition: "opacity 160ms ease, transform 160ms ease",
                }}
                className="group-hover:!opacity-100"
              >
                Open in lab →
              </span>
            </div>
          </div>
        </ReactorGlass>
      </DraggableFeedCard>
    </ReactionHoverPreview>
  );
}

function DecompositionFeedCard({
  parent,
  children,
  at,
  space,
  eventId,
  onDropOnMe,
}: {
  parent: Entity;
  children: Entity[];
  at: string;
  space: Space;
  eventId: string;
  onDropOnMe: (selfRef: ClusterMember, dropped: ClusterMember) => void;
}) {
  const color = "#a78bfa"; // violet — reserved for decomposition in the feed palette
  const labHref = `/app/space/${space.id}/entity/${parent.id}/lab`;
  // eventId is the feed event id, shaped `decomp-${parent.id}` — use this
  // as the cluster-member ref so drops survive refreshes.
  const selfRef: ClusterMember = { kind: "decomposition", id: eventId };
  return (
    <DraggableFeedCard
      selfRef={selfRef}
      navHref={labHref}
      onDropOnMe={(dropped) => onDropOnMe(selfRef, dropped)}
    >
      <ReactorGlass
        elevation="ambient"
        tint="violet"
        className="group cursor-pointer"
        style={{ padding: 0 }}
      >
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gridTemplateColumns: "56px 1fr auto",
            gap: 16,
            padding: "16px 18px",
          }}
        >
          {/* Left rail */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 36,
                height: 36,
                borderRadius: 999,
                background: `${color}18`,
                border: `1px solid ${color}44`,
                boxShadow: `0 0 16px ${color}22`,
                color,
              }}
              aria-hidden
            >
              <Sparkles style={{ width: 16, height: 16 }} />
            </span>
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 8.5,
                letterSpacing: "0.08em",
                color: "#64748b",
              }}
              title={new Date(at).toLocaleString()}
            >
              {relativeTime(at)}
            </span>
          </div>

          {/* Middle */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: `${color}22`,
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
                    boxShadow: `0 0 6px ${color}`,
                  }}
                />
                Decomposition
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: "#475569",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  letterSpacing: "0.08em",
                }}
              >
                PROBE
              </span>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.25,
                color: "#e8edf4",
                marginBottom: 4,
              }}
              title={parent.name}
            >
              {parent.name}
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "#a8b3c4",
                marginBottom: 10,
              }}
            >
              Produced {children.length} proxy{" "}
              {children.length === 1 ? "indicator" : "indicators"} at layer{" "}
              <span style={{ color: "#e8edf4", fontWeight: 600 }}>
                {(children[0]?.layer ?? "thread").toString()}
              </span>
              .
            </div>
            {/* Children chips */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 4,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 10,
              }}
            >
              {children.slice(0, 6).map((c) => (
                <span
                  key={c.id}
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    height: 22,
                    padding: "0 7px",
                    borderRadius: 5,
                    background: "rgba(167, 139, 250, 0.08)",
                    border: "1px solid rgba(167, 139, 250, 0.20)",
                    color: "#c4b5fd",
                    fontWeight: 600,
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={c.name}
                >
                  {c.name}
                </span>
              ))}
              {children.length > 6 && (
                <span
                  style={{
                    fontSize: 9.5,
                    color: "#64748b",
                    letterSpacing: "0.06em",
                  }}
                >
                  +{children.length - 6} more
                </span>
              )}
            </div>
          </div>

          {/* Right */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignItems: "flex-end",
              minWidth: 72,
            }}
          >
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Subunits
              </div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 22,
                  fontWeight: 700,
                  color,
                  lineHeight: 1,
                  marginTop: 2,
                }}
              >
                {children.length}
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color,
                opacity: 0.75,
                transition: "opacity 160ms ease",
              }}
              className="group-hover:!opacity-100"
            >
              Open in lab →
            </span>
          </div>
        </div>
      </ReactorGlass>
    </DraggableFeedCard>
  );
}

function BridgeFeedCard({
  bridge,
  thisIsSource,
  partner,
  partnerSpaceName,
  at,
  space,
  eventId,
  onDropOnMe,
}: {
  bridge: Bridge & { created_at?: string | null };
  thisIsSource: boolean;
  partner: Entity | null;
  partnerSpaceName: string;
  at: string;
  space: Space;
  eventId: string;
  onDropOnMe: (selfRef: ClusterMember, dropped: ClusterMember) => void;
}) {
  const color = "#22d3ee"; // cyan — reserved for bridges
  const arrow =
    bridge.coupling_direction === "source_to_target"
      ? "→"
      : bridge.coupling_direction === "target_to_source"
        ? "←"
        : "↔";
  const strength = bridge.coupling_strength;
  const strengthBars = COUPLING_WEIGHT[strength] ?? 1;
  // Click lands on the partner's space lab (we don't know a local focal
  // to deep-link into). Users can always drill further from there.
  const partnerHref = partner
    ? `/app/space/${partner.space_id}/entity/${partner.id}/lab`
    : `/app/space/${thisIsSource ? bridge.target_space_id : bridge.source_space_id}`;
  const selfRef: ClusterMember = { kind: "bridge", id: eventId };

  return (
    <DraggableFeedCard
      selfRef={selfRef}
      navHref={partnerHref}
      onDropOnMe={(dropped) => onDropOnMe(selfRef, dropped)}
    >
      <ReactorGlass
        elevation="ambient"
        tint="cyan"
        className="group cursor-pointer"
        style={{ padding: 0 }}
      >
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gridTemplateColumns: "56px 1fr auto",
            gap: 16,
            padding: "16px 18px",
          }}
        >
          {/* Left rail */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 36,
                height: 36,
                borderRadius: 999,
                background: `${color}18`,
                border: `1px solid ${color}44`,
                boxShadow: `0 0 16px ${color}22`,
                color,
              }}
              aria-hidden
            >
              <Network style={{ width: 16, height: 16 }} />
            </span>
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 8.5,
                letterSpacing: "0.08em",
                color: "#64748b",
              }}
              title={new Date(at).toLocaleString()}
            >
              {relativeTime(at)}
            </span>
          </div>

          {/* Middle */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: `${color}22`,
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
                    boxShadow: `0 0 6px ${color}`,
                  }}
                />
                {bridge.bridge_type}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: "#475569",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  letterSpacing: "0.08em",
                }}
              >
                BRIDGE
              </span>
              {/* Coupling strength as 3 bars */}
              <span
                aria-label={`${strength} coupling`}
                title={`${strength} coupling`}
                style={{ display: "inline-flex", gap: 2, marginLeft: 2 }}
              >
                {[1, 2, 3].map((i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      width: 4,
                      height: 10,
                      borderRadius: 1,
                      background:
                        i <= strengthBars
                          ? color
                          : "rgba(34, 211, 238, 0.14)",
                      boxShadow:
                        i <= strengthBars ? `0 0 4px ${color}55` : "none",
                    }}
                  />
                ))}
              </span>
            </div>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 700,
                lineHeight: 1.3,
                color: "#e8edf4",
                marginBottom: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
              title={bridge.shared_variable_name}
            >
              <span style={{ color: "#4ade80" }}>{space.name}</span>
              <span style={{ color: "#475569", fontWeight: 500 }}>{arrow}</span>
              <span style={{ color }}>{partnerSpaceName}</span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "#a8b3c4",
                marginBottom: 8,
              }}
            >
              Shared variable:{" "}
              <span style={{ color: "#e8edf4", fontWeight: 600 }}>
                {bridge.shared_variable_name}
              </span>
            </div>
            {bridge.description && (
              <div
                style={{
                  fontSize: 10.5,
                  lineHeight: 1.45,
                  color: "#94a3b8",
                  fontStyle: "italic",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  marginBottom: 8,
                }}
              >
                {bridge.description}
              </div>
            )}
            {partner && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  partner
                </span>
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    height: 22,
                    padding: "0 7px",
                    borderRadius: 5,
                    background: "rgba(34, 211, 238, 0.08)",
                    border: "1px solid rgba(34, 211, 238, 0.2)",
                    color: "#7dd3fc",
                    fontWeight: 600,
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={partner.name}
                >
                  {partner.name}
                </span>
              </div>
            )}
          </div>

          {/* Right */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignItems: "flex-end",
              minWidth: 72,
            }}
          >
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Confidence
              </div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 22,
                  fontWeight: 700,
                  color,
                  lineHeight: 1,
                  marginTop: 2,
                }}
              >
                {Math.round(((bridge.confidence as number | null) ?? 0.7) * 100)}
                <span
                  style={{
                    marginLeft: 2,
                    fontSize: 10,
                    color: "#64748b",
                  }}
                >
                  %
                </span>
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color,
                opacity: 0.75,
                transition: "opacity 160ms ease",
              }}
              className="group-hover:!opacity-100"
            >
              Open partner →
            </span>
          </div>
        </div>
      </ReactorGlass>
    </DraggableFeedCard>
  );
}

// ─── Phase 39 — drag-to-cluster ───
//
// A pure HTML5 DnD wrapper: every feed card wraps in a <DraggableFeedCard>
// so the user can drag one card onto another to cluster them. The
// wrapper handles:
//   - draggable=true + custom MIME type so we only accept feed events
//   - dragStart writes the selfRef; dragEnd clears visual state
//   - dragOver + dragLeave paint a glowing drop indicator
//   - drop parses the incoming ref, calls onDropOnMe
//   - click (mouseup without drag) navigates via router.push
//   - "justDragged" guard suppresses the phantom click browsers
//     sometimes fire right after a drag
//
// The wrapper is intentionally unstyled — it only adds a transient
// outline + a tiny scale on drag/hover so the underlying ReactorGlass
// elevation system stays authoritative.

function DraggableFeedCard({
  selfRef,
  navHref,
  onDropOnMe,
  children,
}: {
  selfRef: ClusterMember;
  navHref?: string;
  onDropOnMe: (dropped: ClusterMember) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isDragging, setIsDragging] = useState(false);
  const [isDropHover, setIsDropHover] = useState(false);
  const [justDragged, setJustDragged] = useState(false);

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // Ignore clicks that happen right after a drag (Firefox / some browsers).
      if (justDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!navHref) return;
      // Honor modifier clicks — open in new tab.
      if (e.metaKey || e.ctrlKey || e.button === 1) {
        window.open(navHref, "_blank");
        return;
      }
      router.push(navHref);
    },
    [justDragged, navHref, router],
  );

  return (
    <div
      draggable
      role={navHref ? "link" : undefined}
      tabIndex={navHref ? 0 : -1}
      aria-label={navHref ? `Open: ${selfRef.kind}` : undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(selfRef));
        e.dataTransfer.effectAllowed = "move";
        setIsDragging(true);
        setJustDragged(true);
      }}
      onDragEnd={() => {
        setIsDragging(false);
        // Let the current microtask settle before clearing the click-guard.
        window.setTimeout(() => setJustDragged(false), 30);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!isDropHover) setIsDropHover(true);
      }}
      onDragLeave={() => setIsDropHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDropHover(false);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as ClusterMember;
          if (
            !parsed ||
            typeof parsed.kind !== "string" ||
            typeof parsed.id !== "string"
          )
            return;
          onDropOnMe(parsed);
        } catch {
          /* malformed payload — ignore */
        }
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!navHref) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(navHref);
        }
      }}
      style={{
        cursor: isDragging ? "grabbing" : navHref ? "pointer" : "grab",
        opacity: isDragging ? 0.45 : 1,
        transform: isDragging
          ? "scale(0.98)"
          : isDropHover
            ? "scale(1.005)"
            : "none",
        transition:
          "opacity 140ms cubic-bezier(0.25, 1, 0.5, 1), transform 140ms cubic-bezier(0.25, 1, 0.5, 1), box-shadow 180ms cubic-bezier(0.25, 1, 0.5, 1)",
        boxShadow: isDropHover
          ? "0 0 0 2px rgba(74, 222, 128, 0.55), 0 0 24px rgba(74, 222, 128, 0.25)"
          : undefined,
        borderRadius: 14,
        outline: "none",
      }}
    >
      {children}
    </div>
  );
}

// ─── Phase 39 — cluster card ───
//
// Renders a user-created cluster of feed events as its own card. Default
// state is COLLAPSED — shows count, kind-mix dots, and a header. Click
// the chevron to expand, revealing one compact row per member. The
// cluster itself is also draggable (so it can be clustered further in
// Phase 40 when nesting ships) and droppable (so more events can be
// dragged in). A Trash button appears on hover for deletion.

function ClusterFeedCard({
  cluster,
  memberEvents,
  space,
  entitiesByUuid,
  onDropOnMe,
  onDeleteCluster,
  onRemoveMember,
  onRenameCluster,
}: {
  cluster: PersistedCluster;
  memberEvents: FeedEvent[];
  space: Space;
  entitiesByUuid: Map<string, Entity>;
  onDropOnMe: (selfRef: ClusterMember, dropped: ClusterMember) => void;
  onDeleteCluster: (clusterId: string) => void;
  onRemoveMember: (clusterId: string, m: ClusterMember) => void;
  onRenameCluster: (clusterId: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(cluster.name);
  const selfRef: ClusterMember = { kind: "cluster", id: cluster.id };

  const commitRename = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== cluster.name) {
      onRenameCluster(cluster.id, trimmed);
    } else {
      // Snap back to the stored name so draft doesn't drift.
      setDraftName(cluster.name);
    }
    setEditingName(false);
  }, [draftName, cluster.name, cluster.id, onRenameCluster]);

  const cancelRename = useCallback(() => {
    setDraftName(cluster.name);
    setEditingName(false);
  }, [cluster.name]);

  // Phase 40 — mix of kinds inside, including nested clusters.
  const kindMix = useMemo(() => {
    const c: Record<
      "reaction" | "decomposition" | "bridge" | "cluster",
      number
    > = { reaction: 0, decomposition: 0, bridge: 0, cluster: 0 };
    for (const ev of memberEvents) {
      if (ev.kind === "reaction") c.reaction++;
      else if (ev.kind === "decomposition") c.decomposition++;
      else if (ev.kind === "bridge") c.bridge++;
      else c.cluster++;
    }
    return c;
  }, [memberEvents]);

  return (
    <DraggableFeedCard
      selfRef={selfRef}
      onDropOnMe={(dropped) => onDropOnMe(selfRef, dropped)}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <ReactorGlass
          elevation={expanded ? "attentive" : "ambient"}
          style={{
            padding: 0,
            // A color-mix border so clusters are visually distinct from
            // primitives. Uses the main reactor-glass base plus a dashed
            // overlay — the visual grammar for "aggregate."
            borderStyle: "dashed",
            borderColor: "rgba(148, 163, 184, 0.25)",
          }}
        >
          <div style={{ position: "relative", zIndex: 1 }}>
            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: 16,
                padding: "14px 18px",
                cursor: "default",
              }}
            >
              {/* Left rail */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                  aria-label={expanded ? "Collapse cluster" : "Expand cluster"}
                  title={expanded ? "Collapse" : "Expand"}
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: "rgba(148, 163, 184, 0.08)",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    color: "#e8edf4",
                    cursor: "pointer",
                    transition: "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)",
                  }}
                >
                  <Layers style={{ width: 16, height: 16 }} />
                </button>
                <span
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 8.5,
                    letterSpacing: "0.08em",
                    color: "#64748b",
                  }}
                  title={new Date(cluster.updated_at).toLocaleString()}
                >
                  {relativeTime(cluster.updated_at)}
                </span>
              </div>

              {/* Middle */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: "rgba(148, 163, 184, 0.1)",
                      color: "#a8b3c4",
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                    }}
                  >
                    Cluster
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "#475569",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {memberEvents.length}{" "}
                    {memberEvents.length === 1 ? "ITEM" : "ITEMS"}
                  </span>
                  <span
                    aria-hidden
                    style={{ display: "inline-flex", gap: 3, marginLeft: 2 }}
                  >
                    {kindMix.reaction > 0 && (
                      <KindDot color="#4ade80" n={kindMix.reaction} />
                    )}
                    {kindMix.decomposition > 0 && (
                      <KindDot color="#a78bfa" n={kindMix.decomposition} />
                    )}
                    {kindMix.bridge > 0 && (
                      <KindDot color="#22d3ee" n={kindMix.bridge} />
                    )}
                    {kindMix.cluster > 0 && (
                      <KindDot color="#e8edf4" n={kindMix.cluster} />
                    )}
                  </span>
                </div>
                {editingName ? (
                  <input
                    type="text"
                    value={draftName}
                    autoFocus
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    aria-label="Rename cluster"
                    style={{
                      width: "100%",
                      background: "rgba(74, 222, 128, 0.08)",
                      border: "1px solid rgba(74, 222, 128, 0.35)",
                      borderRadius: 5,
                      padding: "4px 8px",
                      color: "#e8edf4",
                      fontSize: 15,
                      fontWeight: 700,
                      lineHeight: 1.25,
                      outline: "none",
                    }}
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setDraftName(cluster.name);
                      setEditingName(true);
                    }}
                    title={`${cluster.name} · double-click to rename`}
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      lineHeight: 1.25,
                      color: "#e8edf4",
                      cursor: "text",
                      padding: "2px 0",
                      borderRadius: 3,
                      transition: "background 140ms ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "rgba(148, 163, 184, 0.06)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {cluster.name}
                  </div>
                )}
              </div>

              {/* Right */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "flex-end",
                  gap: 6,
                  minWidth: 72,
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                  aria-label={
                    expanded ? "Collapse cluster" : "Expand cluster"
                  }
                  className="group/toggle"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 5,
                    background: "rgba(148, 163, 184, 0.08)",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    color: "#e8edf4",
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  <ChevronRight
                    style={{
                      width: 10,
                      height: 10,
                      transition:
                        "transform 220ms cubic-bezier(0.25, 1, 0.5, 1)",
                      transform: expanded
                        ? "rotate(90deg)"
                        : "rotate(0deg)",
                    }}
                  />
                  {expanded ? "Collapse" : "Expand"}
                </button>
                {hovered && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCluster(cluster.id);
                    }}
                    aria-label="Delete cluster"
                    title="Delete cluster (members remain in the feed)"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      borderRadius: 5,
                      background: "rgba(244, 114, 182, 0.08)",
                      border: "1px solid rgba(244, 114, 182, 0.3)",
                      color: "#f472b6",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    <Trash2 style={{ width: 10, height: 10 }} />
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* Expanded member list */}
            {expanded && (
              <div
                style={{
                  borderTop: "1px dashed rgba(148, 163, 184, 0.12)",
                  padding: "10px 18px 14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {memberEvents.map((ev) => (
                  <ClusterMemberRow
                    key={ev.id}
                    event={ev}
                    space={space}
                    entitiesByUuid={entitiesByUuid}
                    onRemove={() =>
                      onRemoveMember(cluster.id, memberKeyFor(ev))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </ReactorGlass>
      </div>
    </DraggableFeedCard>
  );
}

function KindDot({ color, n }: { color: string; n: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 9,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color,
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
          boxShadow: `0 0 4px ${color}`,
        }}
      />
      {n}
    </span>
  );
}

function memberKeyFor(ev: FeedEvent): ClusterMember {
  if (ev.kind === "reaction")
    return { kind: "reaction", id: ev.id };
  if (ev.kind === "decomposition")
    return { kind: "decomposition", id: ev.id };
  if (ev.kind === "bridge") return { kind: "bridge", id: ev.id };
  return { kind: "cluster", id: ev.cluster.id };
}

function ClusterMemberRow({
  event,
  space,
  entitiesByUuid,
  onRemove,
}: {
  event: FeedEvent;
  space: Space;
  entitiesByUuid: Map<string, Entity>;
  onRemove: () => void;
}) {
  const meta = memberRowMeta(event, space, entitiesByUuid);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        borderRadius: 4,
        background: "rgba(148, 163, 184, 0.04)",
        border: "1px solid rgba(148, 163, 184, 0.08)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: meta.color,
          boxShadow: `0 0 4px ${meta.color}`,
        }}
      />
      {meta.href ? (
        <Link
          href={meta.href}
          style={{
            fontSize: 11.5,
            color: "#e8edf4",
            textDecoration: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={meta.title}
        >
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: meta.color,
              marginRight: 6,
            }}
          >
            {meta.kindLabel}
          </span>
          {meta.title}
        </Link>
      ) : (
        // Phase 40 nested cluster — not navigable (the nested cluster
        // has no standalone page). Render as plain text with the same
        // visual grammar. Users can remove-X to un-nest and interact.
        <span
          style={{
            fontSize: 11.5,
            color: "#e8edf4",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={meta.title}
        >
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: meta.color,
              marginRight: 6,
            }}
          >
            {meta.kindLabel}
          </span>
          {meta.title}
        </span>
      )}
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 9,
          color: "#64748b",
        }}
      >
        {relativeTime(event.at)}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove from cluster"
        title="Remove from cluster"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: 3,
          background: "transparent",
          border: "1px solid transparent",
          color: "#64748b",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#f472b6";
          e.currentTarget.style.borderColor = "rgba(244, 114, 182, 0.3)";
          e.currentTarget.style.background = "rgba(244, 114, 182, 0.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#64748b";
          e.currentTarget.style.borderColor = "transparent";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <X style={{ width: 10, height: 10 }} />
      </button>
    </div>
  );
}

function memberRowMeta(
  ev: FeedEvent,
  space: Space,
  entitiesByUuid: Map<string, Entity>,
): {
  color: string;
  href: string;
  title: string;
  kindLabel: string;
} {
  if (ev.kind === "reaction") {
    const participants = ev.reaction.entity_ids
      .map((id) => entitiesByUuid.get(id) ?? null)
      .filter((e): e is Entity => e !== null);
    const drill = participants[0];
    const href = drill
      ? `/app/space/${space.id}/entity/${drill.id}/lab?rxn=${ev.reaction.id}`
      : `/app/space/${space.id}/lab?rxn=${ev.reaction.id}`;
    return {
      color: REACTION_TYPE_COLOR[ev.reaction.reaction_type],
      href,
      title: ev.reaction.name,
      kindLabel: ev.reaction.reaction_type,
    };
  }
  if (ev.kind === "decomposition") {
    return {
      color: "#a78bfa",
      href: `/app/space/${space.id}/entity/${ev.parent.id}/lab`,
      title: `${ev.parent.name} · ${ev.children.length} subunits`,
      kindLabel: "decomposition",
    };
  }
  if (ev.kind === "bridge") {
    const href = ev.partner
      ? `/app/space/${ev.partner.space_id}/entity/${ev.partner.id}/lab`
      : `/app/space/${ev.thisIsSource ? ev.bridge.target_space_id : ev.bridge.source_space_id}`;
    return {
      color: "#22d3ee",
      href,
      title: `${ev.bridge.shared_variable_name} · ${ev.partnerSpaceName}`,
      kindLabel: "bridge",
    };
  }
  // Phase 40 — nested cluster row. No drill-in target yet; users can
  // remove-X to un-nest and interact at top level. The label carries
  // the item count so users see what's inside without expanding.
  return {
    color: "#e8edf4",
    href: "",
    title: `${ev.cluster.name} · ${ev.memberEvents.length} items`,
    kindLabel: "cluster",
  };
}

// ─── Phase 38 — filter bar ───
//
// Sits between the header and the feed body. Six controls, left→right:
//   1. Search input (fuzzy substring against reaction/parent/bridge text)
//   2. Kind toggles (Reactions · Decompositions · Bridges)
//   3. Reaction-type chips (Emergent · Reinforcing · Tension · Trivial)
//   4. Time window (24h · 7d · 30d · All)
//   5. Clear (only when any filter is active)
//
// Design: single horizontal row, reactor-glass background, no dropdowns
// (everything is visible at once) because the feed is a canvas-class
// surface — investors need to see filters as first-class objects.

function FilterBar({
  query,
  onQueryChange,
  enabledKinds,
  onKindToggle,
  kindCounts,
  enabledReactionTypes,
  onReactionTypeToggle,
  reactionTypeCounts,
  timeWindow,
  onTimeWindowChange,
  filtersActive,
  onClear,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  enabledKinds: Record<ClusterMemberKind, boolean>;
  onKindToggle: (kind: ClusterMemberKind) => void;
  kindCounts: {
    reaction: number;
    decomposition: number;
    bridge: number;
    cluster: number;
  };
  enabledReactionTypes: Record<ReactionType, boolean>;
  onReactionTypeToggle: (t: ReactionType) => void;
  reactionTypeCounts: Record<ReactionType, number>;
  timeWindow: "24h" | "7d" | "30d" | "all";
  onTimeWindowChange: (w: "24h" | "7d" | "30d" | "all") => void;
  filtersActive: boolean;
  onClear: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-[#94a3b8]/[0.08] px-4 py-2.5"
      style={{
        background: "rgba(10, 15, 23, 0.6)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        zIndex: 1,
      }}
    >
      {/* Search input */}
      <div
        className="flex items-center gap-2 rounded-[6px] border border-[#94a3b8]/[0.1] bg-[#141b26] px-2.5 transition-colors focus-within:border-[#4ade80]/40"
        style={{ height: 30, minWidth: 220 }}
      >
        <Search
          className="h-3 w-3"
          style={{ color: query ? "#4ade80" : "#475569" }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search names, mechanisms, bridges…"
          aria-label="Search the synthesis feed"
          className="flex-1 bg-transparent font-mono text-[11px] text-[#e8edf4] placeholder:text-[#475569] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            title="Clear search"
            className="text-[#64748b] hover:text-[#a8b3c4]"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Kind toggles */}
      <div className="flex items-center gap-1">
        <KindToggle
          label="RX"
          fullLabel="Reactions"
          count={kindCounts.reaction}
          enabled={enabledKinds.reaction}
          accent="#4ade80"
          onClick={() => onKindToggle("reaction")}
        />
        <KindToggle
          label="DC"
          fullLabel="Decompositions"
          count={kindCounts.decomposition}
          enabled={enabledKinds.decomposition}
          accent="#a78bfa"
          onClick={() => onKindToggle("decomposition")}
        />
        <KindToggle
          label="BR"
          fullLabel="Bridges"
          count={kindCounts.bridge}
          enabled={enabledKinds.bridge}
          accent="#22d3ee"
          onClick={() => onKindToggle("bridge")}
        />
        <KindToggle
          label="CL"
          fullLabel="Clusters"
          count={kindCounts.cluster}
          enabled={enabledKinds.cluster}
          accent="#e8edf4"
          onClick={() => onKindToggle("cluster")}
        />
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-[#94a3b8]/[0.1]" />

      {/* Reaction-type chips — only meaningful when reactions are enabled */}
      <div className="flex items-center gap-1">
        <TypeChip
          type="emergent"
          label="Emergent"
          count={reactionTypeCounts.emergent}
          enabled={enabledReactionTypes.emergent}
          dim={!enabledKinds.reaction}
          onClick={() => onReactionTypeToggle("emergent")}
        />
        <TypeChip
          type="reinforcing"
          label="Reinforcing"
          count={reactionTypeCounts.reinforcing}
          enabled={enabledReactionTypes.reinforcing}
          dim={!enabledKinds.reaction}
          onClick={() => onReactionTypeToggle("reinforcing")}
        />
        <TypeChip
          type="tension"
          label="Tension"
          count={reactionTypeCounts.tension}
          enabled={enabledReactionTypes.tension}
          dim={!enabledKinds.reaction}
          onClick={() => onReactionTypeToggle("tension")}
        />
        <TypeChip
          type="trivial"
          label="Trivial"
          count={reactionTypeCounts.trivial}
          enabled={enabledReactionTypes.trivial}
          dim={!enabledKinds.reaction}
          onClick={() => onReactionTypeToggle("trivial")}
        />
      </div>

      {/* Divider + time window */}
      <div className="ml-auto flex items-center gap-1">
        {(["24h", "7d", "30d", "all"] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onTimeWindowChange(w)}
            aria-pressed={timeWindow === w}
            className="rounded-[4px] border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors"
            style={{
              height: 22,
              borderColor:
                timeWindow === w
                  ? "rgba(74, 222, 128, 0.45)"
                  : "rgba(148, 163, 184, 0.1)",
              background:
                timeWindow === w ? "rgba(74, 222, 128, 0.1)" : "#141b26",
              color: timeWindow === w ? "#4ade80" : "#64748b",
            }}
          >
            {w === "all" ? "All" : w}
          </button>
        ))}

        {filtersActive && (
          <button
            type="button"
            onClick={onClear}
            className="ml-1 flex items-center gap-1 rounded-[4px] border border-[#f472b6]/30 bg-[#f472b6]/[0.06] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#f472b6] transition-colors hover:bg-[#f472b6]/[0.12]"
            style={{ height: 22 }}
            title="Clear all filters"
          >
            <X className="h-2.5 w-2.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function KindToggle({
  label,
  fullLabel,
  count,
  enabled,
  accent,
  onClick,
}: {
  label: string;
  fullLabel: string;
  count: number;
  enabled: boolean;
  accent: string;
  onClick: () => void;
}) {
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={enabled}
      title={
        disabled
          ? `No ${fullLabel.toLowerCase()} yet`
          : enabled
            ? `Hide ${fullLabel.toLowerCase()}`
            : `Show ${fullLabel.toLowerCase()}`
      }
      className="flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] transition-all disabled:cursor-not-allowed disabled:opacity-35"
      style={{
        height: 22,
        borderColor: enabled ? `${accent}55` : "rgba(148, 163, 184, 0.12)",
        background: enabled ? `${accent}15` : "#141b26",
        color: enabled ? accent : "#64748b",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: accent,
          boxShadow: enabled ? `0 0 4px ${accent}` : "none",
          opacity: enabled ? 1 : 0.4,
        }}
      />
      <span>{label}</span>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 9,
          color: enabled ? accent : "#475569",
          opacity: 0.85,
        }}
      >
        {count}
      </span>
    </button>
  );
}

const REACTION_TYPE_COLOR_SWATCH = REACTION_TYPE_COLOR;

function TypeChip({
  type,
  label,
  count,
  enabled,
  dim,
  onClick,
}: {
  type: ReactionType;
  label: string;
  count: number;
  enabled: boolean;
  dim: boolean;
  onClick: () => void;
}) {
  const accent = REACTION_TYPE_COLOR_SWATCH[type];
  const disabled = count === 0 || dim;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={enabled}
      title={dim ? "Reactions are hidden" : enabled ? `Hide ${label}` : `Show ${label}`}
      className="flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] transition-all disabled:cursor-not-allowed disabled:opacity-35"
      style={{
        height: 22,
        borderColor: enabled && !dim ? `${accent}55` : "rgba(148, 163, 184, 0.1)",
        background: enabled && !dim ? `${accent}12` : "#141b26",
        color: enabled && !dim ? accent : "#475569",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: accent,
          boxShadow: enabled && !dim ? `0 0 3px ${accent}` : "none",
          opacity: enabled && !dim ? 1 : 0.4,
        }}
      />
      <span>{label}</span>
      <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="mx-auto mt-20 w-full max-w-[480px] text-center">
      <ReactorGlass
        elevation="attentive"
        tint="pink"
        style={{ padding: "28px 24px" }}
      >
        <div style={{ position: "relative", zIndex: 1 }}>
          <div
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "rgba(244, 114, 182, 0.08)",
              border: "1px solid rgba(244, 114, 182, 0.3)",
              color: "#f472b6",
              marginBottom: 12,
            }}
            aria-hidden
          >
            <Search style={{ width: 18, height: 18 }} />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e8edf4",
              marginBottom: 6,
            }}
          >
            No matches
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: "#94a3b8",
              marginBottom: 14,
            }}
          >
            No events match your current filters. Widen the window, toggle
            more kinds back on, or clear to see everything.
          </div>
          <button
            type="button"
            onClick={onClear}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              borderRadius: 5,
              background: "rgba(244, 114, 182, 0.12)",
              border: "1px solid rgba(244, 114, 182, 0.4)",
              color: "#f472b6",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <X style={{ width: 10, height: 10 }} />
            Clear filters
          </button>
        </div>
      </ReactorGlass>
    </div>
  );
}

function EmptyState({ space }: { space: Space }) {
  const canvasHref = `/app/space/${space.id}`;
  return (
    <div className="mx-auto mt-16 w-full max-w-[520px] text-center">
      <ReactorGlass
        elevation="attentive"
        tint="green"
        className="reactor-particles"
        style={{ padding: "40px 28px" }}
      >
        <div style={{ position: "relative", zIndex: 1 }}>
          <div
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 56,
              height: 56,
              borderRadius: 999,
              background: "rgba(74, 222, 128, 0.1)",
              border: "1px solid rgba(74, 222, 128, 0.3)",
              boxShadow: "0 0 24px rgba(74, 222, 128, 0.15)",
              color: "#4ade80",
              marginBottom: 16,
            }}
            aria-hidden
          >
            <Sparkles style={{ width: 24, height: 24 }} />
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#e8edf4",
              marginBottom: 8,
            }}
          >
            No synthesis yet
          </div>
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "#a8b3c4",
              marginBottom: 20,
              maxWidth: 420,
              margin: "0 auto 20px",
            }}
          >
            This is where your thinking accumulates. Combine two or more
            entities on the canvas and hit{" "}
            <span style={{ color: "#4ade80", fontWeight: 600 }}>
              Save as Reaction
            </span>
            . Every reaction lands here — the probability space of your
            knowledge graph, written over time.
          </div>
          <Link
            href={canvasHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 6,
              background: "rgba(74, 222, 128, 0.12)",
              border: "1px solid rgba(74, 222, 128, 0.4)",
              color: "#4ade80",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            <X style={{ width: 12, height: 12, transform: "rotate(45deg)" }} />
            Start on canvas
          </Link>
        </div>
      </ReactorGlass>
    </div>
  );
}
