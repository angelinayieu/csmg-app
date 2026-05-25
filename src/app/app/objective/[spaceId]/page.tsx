// ── /app/objective/[spaceId] — single Objective Canvas ──
//
// Server route. Loads the space + initial Objective Canvas state out
// of `synthesis_data.objective_canvas`, then hands off to the client
// orchestrator <ObjectiveCanvasView /> which drives the staged UI.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { ObjectiveCanvasView } from "@/components/objective/objective-canvas-view";
import { ModePill, type PipelineMode } from "@/components/objective/mode-pill";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ObjectiveCanvasPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select(
      "id, name, description, input_text, user_id, archived, synthesis_data, pipeline_mode",
    )
    .eq("id", spaceId)
    .maybeSingle();

  if (!space || space.user_id !== user.id) notFound();
  if (space.archived) redirect("/app/objective");

  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  const state = readObjectiveCanvasState(space.synthesis_data);

  // ── Load sub-objective rows for the "main" stage ───────────────
  // Sub-objectives = improvement_goals rows with parent_goal_id
  // pointing at this space's root goal. Phase 3's confirm route
  // inserts them on pick. For each sub-objective we also fetch the
  // entities that are endpoints of APPROVED cross-layer correlation
  // edges — Phase 8's "approved fork strip" surfaces those under
  // each card.
  let initialMainSubs: MainCanvasSub[] = [];
  if (state.stage === "main" || state.stage === "done") {
    const { data: parentRows } = await db
      .from("improvement_goals")
      .select("id")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const parentGoalId =
      Array.isArray(parentRows) && parentRows.length > 0
        ? (parentRows[0]?.id as string)
        : null;
    if (parentGoalId) {
      const { data: childRows } = await db
        .from("improvement_goals")
        .select(
          "id, title, description, auto_detection_rationale, room_layers_generated_at, created_at",
        )
        .eq("space_id", spaceId)
        .eq("parent_goal_id", parentGoalId)
        .order("created_at", { ascending: true });
      const subs = ((childRows ?? []) as Array<{
        id: string;
        title: string;
        description: string | null;
        auto_detection_rationale: string | null;
        room_layers_generated_at: string | null;
      }>);

      // For each sub-objective, find approved-edge endpoints and the
      // layer those entities belong to. Two queries (edges, then
      // entities) keep each one indexable.
      const { data: layerRows } = await db
        .from("layer_ontology")
        .select("id, slug")
        .eq("space_id", spaceId);
      const slugByLayerId = new Map<string, string>();
      for (const r of (layerRows ?? []) as Array<{ id: string; slug: string }>) {
        slugByLayerId.set(r.id, r.slug);
      }

      const subIds = subs.map((s) => s.id);
      const approvedItemsBySub = new Map<
        string,
        Array<{
          id: string;
          name: string;
          layer: "pain" | "features" | "outcomes" | "objective";
        }>
      >();
      if (subIds.length > 0) {
        const { data: approvedEdges } = await db
          .from("edges")
          .select("source_entity_id, target_entity_id, parent_sub_objective_id")
          .in("parent_sub_objective_id", subIds)
          .not("approved_at", "is", null);

        // Collect unique entity ids across all approved edges.
        const entityToSub = new Map<string, string>(); // entityId → subId
        for (const e of (approvedEdges ?? []) as Array<{
          source_entity_id: string;
          target_entity_id: string;
          parent_sub_objective_id: string;
        }>) {
          entityToSub.set(e.source_entity_id, e.parent_sub_objective_id);
          entityToSub.set(e.target_entity_id, e.parent_sub_objective_id);
        }

        if (entityToSub.size > 0) {
          const { data: entityRows } = await db
            .from("entities")
            .select("id, name, layer_ontology_id, parent_sub_objective_id")
            .in("id", Array.from(entityToSub.keys()));
          for (const e of (entityRows ?? []) as Array<{
            id: string;
            name: string;
            layer_ontology_id: string | null;
            parent_sub_objective_id: string | null;
          }>) {
            const subId = e.parent_sub_objective_id;
            if (!subId) continue;
            const slug = e.layer_ontology_id
              ? slugByLayerId.get(e.layer_ontology_id)
              : undefined;
            if (
              slug !== "pain" &&
              slug !== "features" &&
              slug !== "outcomes" &&
              slug !== "objective"
            ) {
              continue;
            }
            const bucket = approvedItemsBySub.get(subId) ?? [];
            bucket.push({ id: e.id, name: e.name, layer: slug });
            approvedItemsBySub.set(subId, bucket);
          }
        }
      }

      // Layer ordering for chip strip = pain → features → outcomes → objective
      const LAYER_ORDER = {
        pain: 0,
        features: 1,
        outcomes: 2,
        objective: 3,
      } as const;

      initialMainSubs = subs.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        rationale: r.auto_detection_rationale,
        generatedAt: r.room_layers_generated_at,
        approvedItems: (approvedItemsBySub.get(r.id) ?? []).sort(
          (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer],
        ),
      }));
    }
  }

  return (
    <div
      className="relative min-h-screen w-full"
      style={{ background: "#fafafa" }}
    >
      {/* Soft whiteboard grid backdrop, fading at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.045) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.85), transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.85), transparent 75%)",
        }}
      />

      <HomeTabNav />
      <ModePill
        spaceId={spaceId}
        mode={
          space.pipeline_mode === "review_each"
            ? "review_each"
            : ("autopilot" as PipelineMode)
        }
      />

      <div className="relative mx-auto w-full max-w-5xl px-6 pb-24 pt-24">
        <Link
          href="/app/objective"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "rgba(15,23,42,0.55)" }}
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back
        </Link>

        <div className="mt-6">
          <ObjectiveCanvasView
            spaceId={spaceId}
            objective={objective}
            initialStage={state.stage}
            initialClarifying={state.clarifying ?? null}
            initialSubObjectives={state.sub_objectives ?? null}
            initialMainSubs={initialMainSubs}
          />
        </div>
      </div>
    </div>
  );
}
