"use client";

// ── Situation View (wrapper) ───────────────────────────────────────
//
// Hosts the two coordinated situation-model surfaces the user specced:
//
//   • "Model"    — the radial KG (SituationModelView) PLUS View 2: a
//                  draggable time-scrub that rewinds the graph through
//                  the iteration snapshots (fewer nodes = earlier state),
//                  so you literally watch complexity grow.
//   • "Timeline" — View 1: the iteration timeline (growth per Deepen → v2).
//
// Both read the structure-snapshot ledger
// (/api/brainstorm/space/[id]/structure-snapshot). The scrub filters the
// LIVE radial to nodes that existed at the chosen snapshot (matched by
// entity / room id) — no historical re-layout, no duplicated lane logic.
// A growing model means past snapshots are subsets of the current one.

import { useEffect, useMemo, useState } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { SituationModelView } from "@/components/objective/situation-model-view";
import {
  SituationTimelineView,
  type SnapshotLite,
  type HealthPoint,
} from "@/components/objective/situation-timeline-view";
import {
  OBJECTIVE_NODE_ID,
  featureNodeId,
  subNodeId,
  type SituationModel,
} from "@/lib/objective-canvas/build-situation-model";

type Mode = "model" | "timeline";

interface Props {
  model: SituationModel;
  spaceId: string;
  /** Harness escape-hatch — skip the authed fetch and seed the ledger. */
  initialSnapshots?: SnapshotLite[];
  initialHealthPoints?: HealthPoint[];
}

function fmtStop(s: SnapshotLite): string {
  const d = new Date(s.created_at);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** snapshot ids → situation-model node ids (objective + sub + feature). */
function buildVisible(entityIds: string[], goalIds: string[]): Set<string> {
  const set = new Set<string>([OBJECTIVE_NODE_ID]);
  goalIds.forEach((id) => set.add(subNodeId(id)));
  entityIds.forEach((id) => set.add(featureNodeId(id)));
  return set;
}

export function SituationView({
  model,
  spaceId,
  initialSnapshots,
  initialHealthPoints,
}: Props) {
  const [mode, setMode] = useState<Mode>("model");
  const [snapshots, setSnapshots] = useState<SnapshotLite[]>(
    initialSnapshots ?? [],
  );
  const [healthPoints, setHealthPoints] = useState<HealthPoint[]>(
    initialHealthPoints ?? [],
  );
  // scrub position: snapshots.length === "Now" (live); 0..n-1 = a snapshot.
  const [scrubIndex, setScrubIndex] = useState<number>(
    (initialSnapshots ?? []).length,
  );
  const [detailCache, setDetailCache] = useState<Map<string, Set<string>>>(
    new Map(),
  );

  // Oldest→newest so the scrub reads left=earliest, right=now.
  const asc = useMemo(
    () =>
      [...snapshots].sort(
        (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
      ),
    [snapshots],
  );

  // Load the ledger (unless seeded by the harness).
  useEffect(() => {
    if (initialSnapshots) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/brainstorm/space/${spaceId}/structure-snapshot?activities=1`)
        .then((r) => r.json())
        .catch(() => ({ snapshots: [] })),
      fetch(`/api/spaces/${spaceId}/snapshots/history`)
        .then((r) => r.json())
        .catch(() => ({ points: [] })),
    ]).then(([listJson, healthJson]) => {
      if (cancelled) return;
      const list = (listJson?.snapshots ?? []) as SnapshotLite[];
      setSnapshots(list);
      setScrubIndex(list.length); // default to "Now"
      setHealthPoints((healthJson?.points ?? []) as HealthPoint[]);
    });
    return () => {
      cancelled = true;
    };
  }, [spaceId, initialSnapshots]);

  const atNow = scrubIndex >= asc.length;
  const selected = atNow ? null : asc[scrubIndex] ?? null;

  // Derive the visible-node set during render — null (= show all) at "Now",
  // inline ids (harness), or the fetched/cached set.
  const visibleNodeIds = useMemo<Set<string> | null>(() => {
    if (!selected) return null;
    if (selected.entityIds || selected.goalIds) {
      return buildVisible(selected.entityIds ?? [], selected.goalIds ?? []);
    }
    return detailCache.get(selected.id) ?? null;
  }, [selected, detailCache]);

  // Fetch the snapshot detail when it isn't inline or cached. Only the async
  // resolver writes state (the render reads it) — no sync setState in effect.
  useEffect(() => {
    if (!selected || selected.entityIds || selected.goalIds) return;
    if (detailCache.has(selected.id)) return;
    let cancelled = false;
    fetch(
      `/api/brainstorm/space/${spaceId}/structure-snapshot?id=${selected.id}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const snap = j?.snapshot;
        if (!snap) return;
        const set = buildVisible(snap.entityIds ?? [], snap.goalIds ?? []);
        setDetailCache((prev) => {
          if (prev.has(selected.id)) return prev;
          const next = new Map(prev);
          next.set(selected.id, set);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected, spaceId, detailCache]);

  const hasHistory = asc.length > 0;

  return (
    <div className="w-full">
      {/* Mode toggle + (in Model mode) the time-scrub. */}
      <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        <div
          className="flex items-center rounded-full p-0.5"
          style={{
            background: appleVibe.surface.chip,
            border: `1px solid ${appleVibe.stroke.soft}`,
          }}
        >
          {(["model", "timeline"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background: active ? appleVibe.surface.card : "transparent",
                  color: active
                    ? appleVibe.text.primary
                    : appleVibe.text.tertiary,
                  boxShadow: active ? appleVibe.shadow.chip : "none",
                }}
                aria-pressed={active}
              >
                {m === "model" ? "Model" : "Timeline"}
              </button>
            );
          })}
        </div>

        {mode === "model" && hasHistory && (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <span
              className="flex-shrink-0 text-[10.5px] font-medium tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
            >
              {atNow
                ? "Now"
                : `v${scrubIndex + 1} · ${selected ? fmtStop(selected) : ""}`}
            </span>
            <input
              type="range"
              min={0}
              max={asc.length}
              step={1}
              value={scrubIndex}
              onChange={(e) => setScrubIndex(Number(e.target.value))}
              className="h-1 w-40 max-w-[40vw] cursor-pointer"
              style={{ accentColor: "rgba(234,88,12,0.95)" }}
              aria-label="Rewind the situation model through deepen iterations"
              title="Drag to rewind the model through deepen iterations"
            />
          </div>
        )}
      </div>

      {mode === "timeline" ? (
        <SituationTimelineView snapshots={snapshots} healthPoints={healthPoints} />
      ) : (
        <SituationModelView
          model={model}
          spaceId={spaceId}
          visibleNodeIds={visibleNodeIds}
        />
      )}
    </div>
  );
}
