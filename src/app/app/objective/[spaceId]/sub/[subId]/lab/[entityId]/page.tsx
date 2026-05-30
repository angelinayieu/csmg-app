// ── /app/objective/[spaceId]/sub/[subId]/lab/[entityId] — Lab page ──
//
// Phase 11.2 — the focused evaluation workspace for ONE mechanism.
// URL-addressable so users can deep-link from the chat agent's
// open_experimentation_room tool, from a Category Card's "Open Lab"
// link, or from a notebook event row.
//
// What lives here (per design spec):
//   • Header — mechanism name + current top score + method badge +
//     breadcrumbs + back/discuss links
//   • Indicators table — per-variation × 5 generic criteria
//     (rubric) and per-proxy-indicator rows when outcomes carry
//     indicators (the user's stated "scoring based on proxy
//     indicators" requirement)
//   • Variation Diff — 2-pick side-by-side compare
//   • Evidence table — citations from item-level research (when
//     present; Phase 11.3 fills the grading column)
//   • Simulation Results — when MC has run, p10/p50/p90 + placebo
//   • Actions row — re-run rubric / run simulation / propose real
//     test / open drawer / generate mockup / export prompt
//
// Server-renders the shell + initial data. Client orchestrator
// (LabPageView) handles re-runs, diff state, and route calls.
//
// All actions fire the existing routes (no new endpoints for the
// page itself) and surface as events in the notebook rail above.
// The Lab page is a CONSUMER of the substrate, not a new producer.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { LabPageView } from "@/components/objective/lab/lab-page-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

export const dynamic = "force-dynamic";

interface RouteParams {
  spaceId: string;
  subId: string;
  entityId: string;
}

export default async function LabPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { spaceId, subId, entityId } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(`/sign-in?next=/app/objective/${spaceId}/sub/${subId}/lab/${entityId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // ── Load entity + ownership check ──
  // expanded_detail is the heart of the page — variations + rubric
  // criteria + indicator_scores + sim envelope all live there.
  // causal_chain carries first_principles + positive_outcome for the
  // header context block. detail_research is the Evidence table's
  // source (when present).
  const { data: entity } = await supabase
    .from("entities")
    .select(
      "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain, expanded_detail, detail_research",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) notFound();

  // Ownership via space.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id, description, input_text")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== user.id) notFound();
  if (space.id !== spaceId) {
    // URL spaceId doesn't match entity's space — wrong path. Redirect
    // to the canonical URL so bookmarks self-heal.
    redirect(
      `/app/objective/${space.id}/sub/${entity.parent_sub_objective_id ?? ""}/lab/${entityId}`,
    );
  }

  // ── Load sub-objective + parent goal for header context ──
  let subObjectiveTitle = "Room";
  let coreObjectiveText =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (entity.parent_sub_objective_id) {
    const { data: sub } = await supabase
      .from("improvement_goals")
      .select("title, parent_goal_id")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    if (sub) {
      subObjectiveTitle = sub.title ?? "Room";
      if (sub.parent_goal_id) {
        const { data: parent } = await supabase
          .from("improvement_goals")
          .select("title, description")
          .eq("id", sub.parent_goal_id)
          .maybeSingle();
        if (parent?.description) coreObjectiveText = parent.description;
        else if (parent?.title) coreObjectiveText = parent.title;
      }
    }
  }
  // Guard against URL drift between path subId and entity's actual sub.
  if (entity.parent_sub_objective_id && entity.parent_sub_objective_id !== subId) {
    redirect(
      `/app/objective/${spaceId}/sub/${entity.parent_sub_objective_id}/lab/${entityId}`,
    );
  }

  // ── Load room peer outcomes + room siblings + edges + decision log ──
  //
  // MECHANISM_PAGE_CONSOLIDATION_PLAN — Phase 1. Lab is now the
  // canonical mechanism page, so it serves the read-oriented sections
  // (Overview / Spec / Inspiration / Planning / Chains / Decisions)
  // in addition to its original focused-evaluation sections.
  //
  // - peerOutcomes (existing): drives the indicator names in the
  //   IndicatorsTable + ProxyIndicatorsTable.
  // - siblings (new): every entity in the room — pains + outcomes —
  //   so chain labels can resolve incoming/outgoing edge endpoints.
  // - edges (new): every edge in the room — used to derive linked
  //   chains through this mechanism (pain → feature → outcome).
  // - decisions (new): every sub_objective_decisions row keyed by
  //   proposal_id=entityId — drives the Decisions section's audit log.
  //
  // All four queries are wave-1-parallel: they only depend on
  // parent_sub_objective_id which we already have from the entity load.
  let peerOutcomes: Array<{
    id: string;
    name: string;
    indicators: string[];
  }> = [];
  let siblingRows: Array<{
    id: string;
    name: string;
    entity_type: string;
    causal_chain: Record<string, unknown> | null;
  }> = [];
  let edgeRows: Array<{
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    strength: number | null;
    polarity: string | null;
    approved_at: string | null;
  }> = [];

  if (entity.parent_sub_objective_id) {
    const [siblingsRes, edgesRes] = await Promise.all([
      supabase
        .from("entities")
        .select("id, name, entity_type, causal_chain")
        .eq("parent_sub_objective_id", entity.parent_sub_objective_id),
      supabase
        .from("edges")
        .select(
          "id, source_entity_id, target_entity_id, strength, polarity, approved_at",
        )
        .eq("parent_sub_objective_id", entity.parent_sub_objective_id),
    ]);
    siblingRows = (siblingsRes.data ?? []) as typeof siblingRows;
    edgeRows = (edgesRes.data ?? []) as typeof edgeRows;

    // Slice peer outcomes off the sibling rows (one less round trip).
    peerOutcomes = siblingRows
      .filter((s) => s.entity_type === "outcome")
      .map((o) => ({
        id: o.id,
        name: o.name,
        indicators: Array.isArray(o.causal_chain?.indicators)
          ? (o.causal_chain.indicators as unknown[])
              .filter(
                (x): x is string => typeof x === "string" && x.length > 0,
              )
              .slice(0, 6)
          : [],
      }));
  }

  // Decision audit log for this entity — last 50, most recent first.
  // Proposal_id == entityId because the canvas's logDecision threads the
  // entity id into proposal_id on every per-item event (elect / reject /
  // score / mechanism_spec_generated / etc).
  const { data: decisionRows } = await supabase
    .from("sub_objective_decisions")
    .select("id, action, proposal_id, metadata, created_at")
    .eq("proposal_id", entityId)
    .order("created_at", { ascending: false })
    .limit(50);
  const decisions = (decisionRows ?? []) as Array<{
    id: string;
    action: string;
    proposal_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;

  // Derive linked chains: every (incoming, outgoing) pair through this
  // feature is one chain (pain → feature → outcome). Strength = mean of
  // the two edge strengths × 100.
  const nameById = new Map<string, string>();
  for (const s of siblingRows) nameById.set(s.id, s.name);
  const incoming = edgeRows.filter((e) => e.target_entity_id === entityId);
  const outgoing = edgeRows.filter((e) => e.source_entity_id === entityId);
  const linkedChains: Array<{
    id: string;
    label: string;
    pct: number;
    approved: boolean;
  }> = [];
  for (const inE of incoming) {
    const painName = nameById.get(inE.source_entity_id);
    if (!painName) continue;
    for (const outE of outgoing) {
      const outName = nameById.get(outE.target_entity_id);
      if (!outName) continue;
      const inS = typeof inE.strength === "number" ? inE.strength : 0.5;
      const outS = typeof outE.strength === "number" ? outE.strength : 0.5;
      linkedChains.push({
        id: `${inE.id}::${outE.id}`,
        label: `${painName} → ${outName}`,
        pct: Math.round(((inS + outS) / 2) * 100),
        approved: !!inE.approved_at && !!outE.approved_at,
      });
    }
  }
  linkedChains.sort((a, b) => b.pct - a.pct);

  const expanded = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;

  return (
    <>
      {/* Flow content — the objective layout's ObjectiveCanvasShell wraps
          this Lab in the room-window over the persistent whiteboard floor,
          so the Lab is a consistent overlay regardless of entry route.
          HomeTabNav is rendered once at the layout level (above the shell). */}
      <div className="pb-12" style={{ fontFamily: appleVibe.font.stack }}>
          {/* Breadcrumb strip — hairline divider beneath, on the window glass. */}
          <div
            className="border-b"
            style={{ borderColor: appleVibe.stroke.hairline }}
          >
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
              <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/app/objective/${spaceId}/sub/${subId}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors hover:text-[rgba(15,23,42,0.92)]"
              style={{ color: appleVibe.text.tertiary }}
              aria-label="Back to room"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2.4} />
              Back to room
            </Link>
            <span
              className="text-[11px]"
              style={{ color: appleVibe.text.faint }}
            >
              /
            </span>
            <Link
              href={`/app/objective/${spaceId}/sub/${subId}`}
              className="truncate text-[11px] font-medium transition-colors hover:text-[rgba(15,23,42,0.92)]"
              style={{ color: appleVibe.text.tertiary }}
              title={subObjectiveTitle}
            >
              {subObjectiveTitle}
            </Link>
            <span
              className="text-[11px]"
              style={{ color: appleVibe.text.faint }}
            >
              /
            </span>
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: appleVibe.accent.primary }}
            >
              Lab
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="#discuss"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors hover:bg-[rgba(15,23,42,0.04)]"
              style={{
                color: appleVibe.text.secondary,
                border: `1px solid ${appleVibe.stroke.hairline}`,
              }}
              title="Open this mechanism in the notebook chat"
            >
              <MessageCircle className="h-3 w-3" strokeWidth={2} />
              Discuss
            </a>
          </div>
        </div>
      </div>

          {/* Page body — the Lab itself. Client orchestrator owns state
              for diff picker + action dispatch. Server-rendered data is
              the source of truth on first load; re-runs replace it. */}
          <LabPageView
            spaceId={spaceId}
            subObjectiveId={subId}
            entityId={entityId}
            entityName={entity.name}
            entityType={entity.entity_type}
            causalChain={entity.causal_chain ?? null}
            expandedDetail={expanded}
            detailResearch={entity.detail_research ?? null}
            peerOutcomes={peerOutcomes}
            coreObjectiveText={coreObjectiveText}
            subObjectiveTitle={subObjectiveTitle}
            linkedChains={linkedChains}
            decisions={decisions}
          />
      </div>
    </>
  );
}
