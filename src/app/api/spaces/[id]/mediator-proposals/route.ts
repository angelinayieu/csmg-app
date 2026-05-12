// ── GET /api/spaces/[id]/mediator-proposals ──────────────────────────
//
// Returns the current queue of proposed mediator bridges for a space.
// Consumed by M6's canvas "Bridge gaps" chip + the proposal review panel.
//
// Query params:
//   ?include_speculative=true  (default true)
//                              when false, only validated-status
//                              proposals returned. Speculative ones
//                              are flagged via the `speculative` field
//                              on each proposal.
//
// Returns: MediatorProposalsResponse
//   - proposals[]              — entities with proposal_status =
//                                'proposed_mediator', joined with
//                                their proposed edges
//   - duplicate_suggestions[]  — placeholder for the future rename
//                                flow; empty for now (duplicates are
//                                handled at persist time and don't
//                                land in the queue)
//
// Auth: owner-only via safeAuth + verifySpaceOwnership. Matches the
// pattern used by the rest of /api/spaces/[id]/* routes.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { ValidationVerdict } from "@/lib/prompts/mediator-validator";

export const dynamic = "force-dynamic";

// ── Response shape ──────────────────────────────────────────────────

export interface MediatorProposalEntry {
  /** Entity row id of the proposed bridge. */
  proposed_entity_id: string;
  /** Display name of the proposed bridge (e.g. "Reactive Oxygen Species"). */
  name: string;
  /** Layer slug the proposed entity sits in. */
  layer: string;
  /** Description from the proposer, used by M6 to populate the card body. */
  description: string;
  /** Final confidence post-validation, clamped 0-1. */
  confidence_final: number;
  /** True when verdict.status === 'speculative' — drives warning chip. */
  speculative: boolean;
  /** From M2 — why this bridge mechanistically connects the cluster. */
  mechanism_explanation: string;
  /** From M2 — search queries M3-heavy can run later for full validation. */
  citation_seeds: string[];
  /** From M3 — full validator output for audit + UI display. */
  verdict: ValidationVerdict;
  /** From M1 — the cluster the proposal originated from. */
  cluster_id: string;
  /** From M1 — the names of the orphans this bridge would connect.
   *  M6 reads this directly to render "Bridges X, Y, Z" without an
   *  extra entity lookup. */
  cluster_member_names: string[];
  /** From M1 — which detection pass surfaced the cluster. */
  cluster_pattern_kind: string;
  /** Proposed edges — one per cluster member, all flowing to/from
   *  the proposed entity. */
  proposed_edges: Array<{
    edge_id: string;
    source_entity_id: string;
    target_entity_id: string;
    /** Display name for the source — resolved server-side so M6
     *  doesn't need a second query. */
    source_name: string;
    target_name: string;
    polarity: string;
    relationship_label: string;
    strength: number | null;
  }>;
  /** When this proposal entered the queue (entities.created_at). */
  created_at: string;
}

export interface MediatorProposalsResponse {
  proposals: MediatorProposalEntry[];
  /** Reserved for future rename-flow surfacing — empty array for now. */
  duplicate_suggestions: Array<{
    proposed_name: string;
    duplicate_of_name: string;
    cluster_id: string;
  }>;
  /** Quick stats so M6 can render a summary chip without iterating. */
  counts: {
    total: number;
    validated: number;
    speculative: number;
  };
}

// ── DB row shapes (loosely typed; cast through any) ─────────────────
//
// The columns proposal_status / proposal_evidence / proposed_from_cluster_id
// were added by the 20260509_mediator_proposals.sql migration. The
// generated database.types may or may not be regenerated; we read
// through Record<string, unknown> casts and validate at runtime to
// avoid blocking on type regeneration.

interface RawProposedEntity {
  id: string;
  name: string;
  layer: string | null;
  description: string | null;
  confidence: number | null;
  proposal_evidence: Record<string, unknown> | null;
  proposed_from_cluster_id: string | null;
  created_at: string;
}

interface RawProposedEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  polarity: string | null;
  relationship_type: string | null;
  strength: number | null;
  proposed_by_entity_id: string;
}

interface RawEntityNameLookup {
  id: string;
  name: string;
}

// ── Route ───────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const includeSpeculative = url.searchParams.get("include_speculative") !== "false";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 1. Fetch all proposed-mediator entities for this space ────────
  const { data: rawEntities, error: entErr } = (await db
    .from("entities")
    .select(
      "id, name, layer, description, confidence, proposal_evidence, proposed_from_cluster_id, created_at",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("proposal_status", "proposed_mediator")
    .order("created_at", { ascending: false })) as {
    data: RawProposedEntity[] | null;
    error: { message?: string } | null;
  };

  if (entErr) {
    return NextResponse.json(
      {
        error: "Failed to load proposed mediators",
        detail: entErr.message ?? "(no detail)",
      },
      { status: 500 },
    );
  }
  const proposedEntities = rawEntities ?? [];

  // Early return when queue is empty — saves the edge fetch + name
  // lookup round-trips.
  if (proposedEntities.length === 0) {
    const empty: MediatorProposalsResponse = {
      proposals: [],
      duplicate_suggestions: [],
      counts: { total: 0, validated: 0, speculative: 0 },
    };
    return NextResponse.json(empty);
  }

  // ── 2. Fetch all proposed edges in one shot ───────────────────────
  const proposedByEntityIds = proposedEntities.map((e) => e.id);
  const { data: rawEdges } = (await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, polarity, relationship_type, strength, proposed_by_entity_id",
    )
    .eq("space_id", spaceId)
    .eq("proposal_status", "proposed")
    .in("proposed_by_entity_id", proposedByEntityIds)) as {
    data: RawProposedEdge[] | null;
  };
  const proposedEdges = rawEdges ?? [];

  // ── 3. Resolve all entity names referenced by edges ───────────────
  // Endpoints can be either the proposed entity itself OR a cluster
  // member entity. Build a set of all referenced ids and fetch names
  // in one round-trip.
  const allReferencedIds = new Set<string>();
  for (const e of proposedEdges) {
    allReferencedIds.add(e.source_entity_id);
    allReferencedIds.add(e.target_entity_id);
  }
  // Also include the proposed entities themselves (some queries may
  // miss them when they're only on one side of an edge).
  for (const e of proposedEntities) allReferencedIds.add(e.id);

  const nameById = new Map<string, string>();
  if (allReferencedIds.size > 0) {
    const { data: rawNames } = (await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(allReferencedIds))) as {
      data: RawEntityNameLookup[] | null;
    };
    for (const row of rawNames ?? []) nameById.set(row.id, row.name);
  }

  // ── 4. Group edges by their parent proposed entity ────────────────
  const edgesByProposedEntity = new Map<string, RawProposedEdge[]>();
  for (const e of proposedEdges) {
    const arr = edgesByProposedEntity.get(e.proposed_by_entity_id);
    if (arr) arr.push(e);
    else edgesByProposedEntity.set(e.proposed_by_entity_id, [e]);
  }

  // ── 5. Build response ─────────────────────────────────────────────
  const proposals: MediatorProposalEntry[] = [];
  let validatedCount = 0;
  let speculativeCount = 0;

  for (const ent of proposedEntities) {
    const evidence = ent.proposal_evidence ?? {};
    const verdict = (evidence.verdict ?? null) as ValidationVerdict | null;
    const speculative = Boolean(evidence.speculative);

    // Filter when include_speculative=false
    if (!includeSpeculative && speculative) continue;

    if (speculative) speculativeCount++;
    else validatedCount++;

    const edges = edgesByProposedEntity.get(ent.id) ?? [];
    const proposedEdgesView = edges.map((edge) => ({
      edge_id: edge.id,
      source_entity_id: edge.source_entity_id,
      target_entity_id: edge.target_entity_id,
      source_name: nameById.get(edge.source_entity_id) ?? "(unknown)",
      target_name: nameById.get(edge.target_entity_id) ?? "(unknown)",
      polarity: edge.polarity ?? "positive",
      relationship_label: edge.relationship_type ?? "drives",
      strength: typeof edge.strength === "number" ? edge.strength : null,
    }));

    proposals.push({
      proposed_entity_id: ent.id,
      name: ent.name,
      layer: ent.layer ?? "",
      description: ent.description ?? "",
      confidence_final:
        typeof evidence.confidence_final === "number"
          ? evidence.confidence_final
          : (ent.confidence ?? 0),
      speculative,
      mechanism_explanation:
        typeof evidence.mechanism_explanation === "string"
          ? evidence.mechanism_explanation
          : "",
      citation_seeds: Array.isArray(evidence.citation_seeds)
        ? (evidence.citation_seeds as string[])
        : [],
      verdict:
        verdict ??
        ({
          status: "speculative",
          confidence_adjustment: 0.5,
          supporting_evidence_summary: "",
          counter_evidence_summary: null,
          rejected_reason: null,
          duplicate_of_name: null,
          notes: ["proposal_evidence missing verdict — likely pre-M3 row"],
        } as ValidationVerdict),
      cluster_id: ent.proposed_from_cluster_id ?? "",
      cluster_member_names: Array.isArray(evidence.cluster_member_names)
        ? (evidence.cluster_member_names as string[])
        : [],
      cluster_pattern_kind:
        typeof evidence.cluster_pattern_kind === "string"
          ? evidence.cluster_pattern_kind
          : "",
      proposed_edges: proposedEdgesView,
      created_at: ent.created_at,
    });
  }

  const response: MediatorProposalsResponse = {
    proposals,
    duplicate_suggestions: [],
    counts: {
      total: proposals.length,
      validated: validatedCount,
      speculative: speculativeCount,
    },
  };

  return NextResponse.json(response);
}
