"use client";

// ── Sub-Objective Room View (v2) ──
//
// Renders the 4 lanes (Pain → Features → Outcomes → Objective)
// using the new causal-chain card components. Adds:
//
//   • Shared-cause pill strip above the Pain lane (with count badges)
//   • Influence-rank sort + Root ⭐ badge on the top pain
//   • Keystone badge on the feature countering the most pains
//   • Inline expand-on-click cards with root causes / first principles
//   • Cross-lane cause↔pain highlight when hovering a shared pill
//
// Correlation side panel still lives on the right; edges feed
// the "addressed by" / "counters pains" lists inside expanded cards.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { CorrelationSidePanel } from "./correlation-side-panel";
import { PainCard, type PainCardItem } from "./cards/pain-card";
import { FeatureCard, type FeatureCardItem } from "./cards/feature-card";
import { OutcomeCard, type OutcomeCardItem } from "./cards/outcome-card";
import { SharedCausesStrip } from "./cards/shared-causes-strip";
import type { PipelineMode } from "./mode-pill";

export interface LayerItem {
  id: string;
  name: string;
  description: string | null;
  entity_type: string;
  /** v2 — pain: { negative_outcome, root_causes[], influence_rank }
   *        feature: { positive_outcome, first_principles[] }
   *        outcome: { measured_by }
   *  Falls through to description-only rendering for legacy
   *  entities that pre-date the migration. */
  causal_chain?: Record<string, unknown> | null;
}

export interface RoomEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  polarity: string | null;
  conditions: string | null;
  approved_at?: string | null;
}

export interface RoomLane {
  slug: "pain" | "features" | "outcomes" | "objective";
  label: string;
  color: string;
  items: LayerItem[];
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  lanes: RoomLane[];
  edges: RoomEdge[];
  generatedAt: string | null;
  pipelineMode: PipelineMode;
}

export function SubObjectiveRoomView({
  spaceId,
  subObjectiveId,
  lanes,
  edges,
  generatedAt,
  pipelineMode,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [highlightedCauses, setHighlightedCauses] = useState<Set<string>>(
    new Set(),
  );
  const [approvedEdgeIds, setApprovedEdgeIds] = useState<Set<string>>(() => {
    return new Set(
      edges.filter((e) => e.approved_at != null).map((e) => e.id),
    );
  });

  const isEmpty = lanes.every(
    (l) =>
      l.items.length === 0 ||
      (l.items.length === 1 && l.slug === "objective"),
  );

  // ── Index every entity by id so panel hover can map id → layer
  const entityIndex = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        layer: "pain" | "features" | "outcomes" | "objective";
      }
    >();
    for (const lane of lanes) {
      for (const item of lane.items) {
        map.set(item.id, { id: item.id, name: item.name, layer: lane.slug });
      }
    }
    return map;
  }, [lanes]);

  // ── Derive typed lane items from causal_chain payloads ──
  const painItems: PainCardItem[] = useMemo(
    () =>
      lanes
        .find((l) => l.slug === "pain")!
        .items.map((it) => {
          const cc = (it.causal_chain ?? {}) as Record<string, unknown>;
          return {
            id: it.id,
            name: it.name,
            negative_outcome:
              typeof cc.negative_outcome === "string"
                ? cc.negative_outcome
                : it.description ?? undefined,
            root_causes: Array.isArray(cc.root_causes)
              ? (cc.root_causes as unknown[])
                  .filter((s): s is string => typeof s === "string")
                  .slice(0, 4)
              : [],
            influence_rank:
              typeof cc.influence_rank === "number"
                ? cc.influence_rank
                : 2.5,
          };
        })
        .sort((a, b) => b.influence_rank - a.influence_rank),
    [lanes],
  );

  const featureItems: FeatureCardItem[] = useMemo(
    () =>
      lanes
        .find((l) => l.slug === "features")!
        .items.map((it) => {
          const cc = (it.causal_chain ?? {}) as Record<string, unknown>;
          return {
            id: it.id,
            name: it.name,
            positive_outcome:
              typeof cc.positive_outcome === "string"
                ? cc.positive_outcome
                : it.description ?? undefined,
            first_principles: Array.isArray(cc.first_principles)
              ? (cc.first_principles as unknown[])
                  .filter((s): s is string => typeof s === "string")
                  .slice(0, 4)
              : [],
          };
        }),
    [lanes],
  );

  const outcomeItems: OutcomeCardItem[] = useMemo(
    () =>
      lanes
        .find((l) => l.slug === "outcomes")!
        .items.map((it) => {
          const cc = (it.causal_chain ?? {}) as Record<string, unknown>;
          return {
            id: it.id,
            name: it.name,
            measured_by:
              typeof cc.measured_by === "string"
                ? cc.measured_by
                : it.description ?? undefined,
          };
        }),
    [lanes],
  );

  const objectiveItems = useMemo(
    () => lanes.find((l) => l.slug === "objective")?.items ?? [],
    [lanes],
  );

  // ── Shared root-cause counts across pains ──
  const painSharedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of painItems) {
      for (const c of p.root_causes) {
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    return counts;
  }, [painItems]);

  const sharedPainsList = useMemo(
    () =>
      Object.entries(painSharedCounts)
        .filter(([, count]) => count >= 2)
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count),
    [painSharedCounts],
  );

  // ── Same for feature first-principles ──
  const featureSharedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of featureItems) {
      for (const p of f.first_principles) {
        counts[p] = (counts[p] ?? 0) + 1;
      }
    }
    return counts;
  }, [featureItems]);
  const [highlightedPrinciples, setHighlightedPrinciples] = useState<
    Set<string>
  >(new Set());

  // ── Edge-derived addressed-by / counters maps ──
  // Pain → list of features that address it (sorted by strength).
  const addressedByMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; pct: number }>
    >();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      // pain → feature OR feature → pain both count
      const pain =
        src.layer === "pain" ? src : tgt.layer === "pain" ? tgt : null;
      const feat =
        src.layer === "features"
          ? src
          : tgt.layer === "features"
            ? tgt
            : null;
      if (!pain || !feat) continue;
      const list = map.get(pain.id) ?? [];
      list.push({
        id: feat.id,
        name: feat.name,
        pct: Math.round((e.strength ?? 0) * 100),
      });
      map.set(pain.id, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.pct - a.pct);
    return map;
  }, [edges, entityIndex]);

  // Feature → list of pains it counters.
  const countersPainsMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; pct: number }>
    >();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      const pain =
        src.layer === "pain" ? src : tgt.layer === "pain" ? tgt : null;
      const feat =
        src.layer === "features"
          ? src
          : tgt.layer === "features"
            ? tgt
            : null;
      if (!pain || !feat) continue;
      const list = map.get(feat.id) ?? [];
      list.push({
        id: pain.id,
        name: pain.name,
        pct: Math.round((e.strength ?? 0) * 100),
      });
      map.set(feat.id, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.pct - a.pct);
    return map;
  }, [edges, entityIndex]);

  // Identify the keystone feature (counters most pains).
  const keystoneFeatureId = useMemo(() => {
    let best: string | null = null;
    let bestCount = 0;
    for (const f of featureItems) {
      const cnt = (countersPainsMap.get(f.id) ?? []).length;
      if (cnt > bestCount) {
        bestCount = cnt;
        best = f.id;
      }
    }
    return bestCount >= 2 ? best : null;
  }, [featureItems, countersPainsMap]);

  // Top pain by influence (root).
  const rootPainId = painItems[0]?.id ?? null;

  // ── Autopilot auto-fire ──
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (pipelineMode !== "autopilot") return;
    if (generatedAt) return;
    autoFiredRef.current = true;
    void generate("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineMode, generatedAt]);

  function generate(mode: "initial" | "regenerate") {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/room/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, subObjectiveId, mode }),
        });
        const json = await res.json();
        if (!res.ok) {
          const base = json?.error ?? "Generation failed. Try again.";
          setError(json?.detail ? `${base} — ${json.detail}` : base);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error. Try again.",
        );
      }
    });
  }

  function handleApprovalChange(edgeId: string, approved: boolean) {
    setApprovedEdgeIds((prev) => {
      const next = new Set(prev);
      if (approved) next.add(edgeId);
      else next.delete(edgeId);
      return next;
    });
  }

  function handleSharedCauseHover(cause: string | null) {
    setHighlightedCauses(cause ? new Set([cause]) : new Set());
  }

  const hasEdges = edges.length > 0;
  const approvedCount = approvedEdgeIds.size;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Header bar with Generate / Regenerate */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            4-stage room
          </div>
          {generatedAt ? (
            <p
              className="mt-1 text-[12.5px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              Cards collapsed by default. Click any card to reveal its
              root causes / first principles and the connections it
              participates in.
            </p>
          ) : (
            <p
              className="mt-1 text-[12.5px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              We&rsquo;ll spin out pain points first, then outcomes, then
              the features that bridge them. Cross-layer correlations
              live in the side panel.
            </p>
          )}
          {generatedAt && approvedCount > 0 && (
            <p
              className="mt-1 text-[11.5px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              {approvedCount} correlation{approvedCount === 1 ? "" : "s"}{" "}
              approved.
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {generatedAt && (
            <button
              type="button"
              onClick={() => generate("regenerate")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
              Regenerate
            </button>
          )}
          {!generatedAt && (
            <button
              type="button"
              onClick={() => generate("initial")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12.5px] font-semibold"
              style={{
                background: appleVibe.accent.primary,
                color: appleVibe.text.onAccent,
                borderRadius: appleVibe.radius.md,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Sparkle className="h-3.5 w-3.5" />
              <span>{busy ? "Generating…" : "Generate the room"}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl px-3.5 py-2.5 text-[12.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}

      {/* Two-column layout: lanes + side panel */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* PAIN lane */}
            <Lane
              slug="pain"
              label="Pain points"
              color={lanes.find((l) => l.slug === "pain")!.color}
              count={painItems.length}
              loading={busy && isEmpty}
            >
              <SharedCausesStrip
                shared={sharedPainsList}
                highlighted={highlightedCauses}
                onHover={handleSharedCauseHover}
              />
              {painItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {painItems.map((p) => (
                  <PainCard
                    key={p.id}
                    item={p}
                    isRoot={p.id === rootPainId}
                    sharedCounts={painSharedCounts}
                    highlightedCauses={highlightedCauses}
                    onHoverCause={handleSharedCauseHover}
                    addressedBy={addressedByMap.get(p.id) ?? []}
                  />
                ))}
              </ul>
            </Lane>

            {/* FEATURE lane */}
            <Lane
              slug="features"
              label="Features"
              color={lanes.find((l) => l.slug === "features")!.color}
              count={featureItems.length}
              loading={busy && isEmpty}
            >
              {featureItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {featureItems.map((f) => (
                  <FeatureCard
                    key={f.id}
                    item={f}
                    isKeystone={f.id === keystoneFeatureId}
                    sharedCounts={featureSharedCounts}
                    highlightedPrinciples={highlightedPrinciples}
                    onHoverPrinciple={(p) =>
                      setHighlightedPrinciples(p ? new Set([p]) : new Set())
                    }
                    countersPains={countersPainsMap.get(f.id) ?? []}
                  />
                ))}
              </ul>
            </Lane>

            {/* OUTCOME lane */}
            <Lane
              slug="outcomes"
              label="Outcomes"
              color={lanes.find((l) => l.slug === "outcomes")!.color}
              count={outcomeItems.length}
              loading={busy && isEmpty}
            >
              {outcomeItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {outcomeItems.map((o) => (
                  <OutcomeCard key={o.id} item={o} />
                ))}
              </ul>
            </Lane>

            {/* OBJECTIVE lane */}
            <Lane
              slug="objective"
              label="Objective"
              color={lanes.find((l) => l.slug === "objective")!.color}
              count={objectiveItems.length}
              loading={busy && isEmpty}
            >
              {objectiveItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {objectiveItems.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-2xl px-4 py-3"
                    style={{
                      background: "rgba(255,255,255,0.65)",
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                      borderRadius: appleVibe.radius.md,
                    }}
                  >
                    <h4
                      className="text-[13.5px] font-semibold leading-snug tracking-tight"
                      style={{ color: appleVibe.text.primary }}
                    >
                      {o.name}
                    </h4>
                  </li>
                ))}
              </ul>
            </Lane>
          </div>
        </div>

        {hasEdges && (
          <CorrelationSidePanel
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
            edges={edges}
            entityIndex={entityIndex}
            approvedEdgeIds={approvedEdgeIds}
            onApprovalChange={handleApprovalChange}
            onHighlightChange={setHighlightedIds}
          />
        )}
      </div>

      {/* Subtle highlight indicator — used by the side panel hover */}
      {highlightedIds.size > 0 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-2 z-30 text-center text-[10.5px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
        >
          {/* visual signal that hover-highlight is active — lane cards
              dim individually elsewhere in a future polish. */}
        </div>
      )}
    </div>
  );
}

// ── Lane shell ─────────────────────────────────────────────────────

function Lane({
  slug,
  label,
  color,
  count,
  loading,
  children,
}: {
  slug: "pain" | "features" | "outcomes" | "objective";
  label: string;
  color: string;
  count: number;
  loading: boolean;
  children: React.ReactNode;
}) {
  void slug;
  return (
    <div
      className="flex min-h-[260px] flex-col rounded-3xl p-4"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
          <h3
            className="text-[13px] font-semibold tracking-tight"
            style={{ color: appleVibe.text.primary }}
          >
            {label}
          </h3>
        </div>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          {count}
        </span>
      </div>

      <div className="mt-3 flex-1">
        {loading ? (
          <div className="flex flex-col gap-2">
            <SkeletonItem />
            <SkeletonItem />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function SkeletonItem() {
  return (
    <div
      className="h-14 rounded-2xl"
      style={{
        background: appleVibe.surface.chip,
        borderRadius: appleVibe.radius.md,
      }}
    />
  );
}

function EmptyHint() {
  return (
    <div
      className="rounded-2xl border border-dashed px-3 py-3 text-center text-[11.5px] font-light"
      style={{
        borderColor: appleVibe.stroke.hairline,
        color: appleVibe.text.tertiary,
        borderRadius: appleVibe.radius.md,
      }}
    >
      empty
    </div>
  );
}
