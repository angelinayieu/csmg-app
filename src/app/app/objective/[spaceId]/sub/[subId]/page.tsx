// ── /app/objective/[spaceId]/sub/[subId] — Sub-objective room ──
//
// Loads the sub-objective + its 4 layers + already-generated
// entities + cross-layer edges, then mounts the room view. Empty
// state shows a "Generate the room" CTA; populated state shows the
// 4 lanes with items and the ranked correlation list.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import {
  SubObjectiveRoomView,
  type LayerItem,
  type RoomEdge,
  type RoomLane,
} from "@/components/objective/sub-objective-room-view";
import { ModePill, type PipelineMode } from "@/components/objective/mode-pill";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const dynamic = "force-dynamic";

const LAYER_ORDER: Array<"pain" | "features" | "outcomes" | "objective"> = [
  "pain",
  "features",
  "outcomes",
  "objective",
];

// Canonical fallback labels — used only when the room hasn't been
// generated yet (no LLM lane_labels persisted) AND the
// layer_ontology row carries the seed name.
const CANONICAL_LANE_LABELS: Record<(typeof LAYER_ORDER)[number], string> = {
  pain: "Pain points",
  features: "Features",
  outcomes: "Outcomes",
  objective: "Objective",
};

interface Sub {
  id: string;
  title: string;
  description: string | null;
  space_id: string;
  user_id: string;
  parent_goal_id: string | null;
  room_layers_generated_at: string | null;
  top_negative_outcome: string | null;
  /** LLM-picked domain-specific lane labels — overrides the
   *  canonical names when present. Shape:
   *  { pain, features, outcomes, objective }. */
  room_lane_labels: Record<string, string> | null;
}

export default async function SubObjectiveRoomPage({
  params,
}: {
  params: Promise<{ spaceId: string; subId: string }>;
}) {
  const { spaceId, subId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Sub-objective ──
  const { data: sub } = (await db
    .from("improvement_goals")
    .select(
      "id, title, description, space_id, user_id, parent_goal_id, room_layers_generated_at, top_negative_outcome, room_lane_labels",
    )
    .eq("id", subId)
    .maybeSingle()) as { data: Sub | null };

  if (!sub || sub.user_id !== user.id || sub.space_id !== spaceId) {
    notFound();
  }

  // Pipeline mode drives auto-generate behavior in the room view.
  const { data: spaceModeRow } = await db
    .from("spaces")
    .select("pipeline_mode")
    .eq("id", spaceId)
    .maybeSingle();
  const pipelineMode: PipelineMode =
    spaceModeRow?.pipeline_mode === "review_each"
      ? "review_each"
      : "autopilot";

  // ── Layers ──
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug, label, color")
    .eq("space_id", spaceId);
  const layerById = new Map<
    string,
    { slug: string; label: string; color: string | null }
  >();
  const layerBySlug = new Map<string, { id: string; color: string | null }>();
  for (const r of (layerRows ?? []) as Array<{
    id: string;
    slug: string;
    label: string;
    color: string | null;
  }>) {
    layerById.set(r.id, { slug: r.slug, label: r.label, color: r.color });
    layerBySlug.set(r.slug, { id: r.id, color: r.color });
  }

  // ── Entities scoped to this sub-objective ──
  const { data: entityRows } = await db
    .from("entities")
    .select(
      "id, name, description, entity_type, layer_ontology_id, causal_chain",
    )
    .eq("parent_sub_objective_id", subId);

  // Label precedence (highest wins):
  //   1. sub.room_lane_labels[slug]   — domain-adaptive, LLM-picked
  //   2. layer_ontology.label          — per-space seed
  //   3. CANONICAL_LANE_LABELS[slug]   — last-resort fallback
  const laneLabelFor = (slug: (typeof LAYER_ORDER)[number]): string => {
    const adaptive = sub.room_lane_labels?.[slug];
    if (typeof adaptive === "string" && adaptive.trim().length > 0) {
      return adaptive.trim();
    }
    return CANONICAL_LANE_LABELS[slug];
  };

  const lanes: RoomLane[] = LAYER_ORDER.map((slug) => {
    const meta = layerBySlug.get(slug);
    return {
      slug,
      label: laneLabelFor(slug),
      color:
        meta?.color ??
        (slug === "pain"
          ? appleVibe.stage.pain
          : slug === "features"
            ? appleVibe.stage.features
            : slug === "outcomes"
              ? appleVibe.stage.outcomes
              : appleVibe.stage.objective),
      items: [] as LayerItem[],
    };
  });

  const laneIndex = new Map<string, RoomLane>(lanes.map((l) => [l.slug, l]));
  for (const e of (entityRows ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    entity_type: string;
    layer_ontology_id: string | null;
    causal_chain: Record<string, unknown> | null;
  }>) {
    const layer = e.layer_ontology_id
      ? layerById.get(e.layer_ontology_id)
      : undefined;
    if (!layer) continue;
    const lane = laneIndex.get(layer.slug);
    if (!lane) continue;
    lane.items.push({
      id: e.id,
      name: e.name,
      description: e.description,
      entity_type: e.entity_type,
      causal_chain: e.causal_chain,
    });
  }

  // ── Edges scoped to this sub-objective ──
  const { data: edgeRows } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, relationship_type, strength, polarity, conditions, approved_at",
    )
    .eq("parent_sub_objective_id", subId);
  const edges: RoomEdge[] = ((edgeRows ?? []) as RoomEdge[]) ?? [];

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        backgroundPosition: "0 0",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <HomeTabNav />
      <ModePill spaceId={spaceId} mode={pipelineMode} />

      <div className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-24">
        <Link
          href={`/app/objective/${spaceId}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: appleVibe.text.secondary }}
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to canvas
        </Link>

        <div className="mt-6 max-w-2xl">
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.tertiary,
            }}
          >
            <Layers className="h-3 w-3" strokeWidth={2} />
            Sub-objective room
          </div>
          <h1
            className="mt-2 text-[26px] font-semibold leading-tight tracking-tight"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              letterSpacing: "-0.02em",
            }}
          >
            {sub.title}
          </h1>
          {/* Room anchor — the single most-impactful downstream
              consequence across all pains. Replaces the long
              sub-objective description as the header subtitle. */}
          {sub.top_negative_outcome ? (
            <p
              className="mt-2 text-[13px] font-light italic leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              <span
                className="not-italic font-semibold"
                style={{ color: appleVibe.text.tertiary }}
              >
                Counters:
              </span>{" "}
              {sub.top_negative_outcome}
            </p>
          ) : (
            sub.description && (
              <p
                className="mt-2 text-[13px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {sub.description}
              </p>
            )
          )}
        </div>

        <div className="mt-10">
          <SubObjectiveRoomView
            spaceId={spaceId}
            subObjectiveId={subId}
            lanes={lanes}
            edges={edges}
            generatedAt={sub.room_layers_generated_at}
            pipelineMode={pipelineMode}
          />
        </div>
      </div>
    </div>
  );
}
