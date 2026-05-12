// POST /api/spaces/[id]/variable-proposals/[proposalId]/approve
//
// Materializes a proposed variable into the entities table and flips the
// proposal's user_status to 'approved'. The entity row carries the
// canonical name/description/metric metadata; the proposal row keeps the
// experimental role (independent/dependent/controlled/confounding) which
// the entities table doesn't represent natively. The two are linked via
// variable_proposals.materialized_entity_id.
//
// Idempotent on already-approved proposals: returns the existing
// materialized_entity_id without double-creating.
//
// Body: optional { entity_id_override?: string } when the user wants to
// link the proposal to an existing entity rather than create a new one
// (useful when the LLM proposed a variable that already exists in the KG).
//
// Returns: { proposal: VariableProposal, entity_id: string }

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import type {
  VariableProposal,
  VariableRole,
} from "@/types/variable-proposals";

export const runtime = "nodejs";

interface RequestBody {
  entity_id_override?: string;
}

/**
 * Map a variable_role to the closest existing entity_type / entity_category /
 * causal_role triple. The experimental roles (independent/dependent/etc.)
 * map to the closest existing semantic type so we don't need to migrate the
 * entity_type CHECK constraint. The original role lives on the proposal
 * row — entities are simpler shapes.
 */
function mapRoleToEntityFields(role: VariableRole): {
  entity_category: string;
  entity_type: string;
  causal_role: string;
} {
  switch (role) {
    // ── Experimental design roles → closest existing entity type ──
    case "independent":
      // What we manipulate ≈ an intervention. Process category, application
      // causal role.
      return {
        entity_category: "process",
        entity_type: "intervention",
        causal_role: "application",
      };
    case "dependent":
      // What we measure ≈ an outcome.
      return {
        entity_category: "abstract",
        entity_type: "outcome",
        causal_role: "outcome",
      };
    case "controlled":
      // Held constant ≈ a boundary condition.
      return {
        entity_category: "abstract",
        entity_type: "condition",
        causal_role: "evidence",
      };
    case "confounding":
      // Uncontrolled variable that influences the DV — neutral variable
      // type with truth role since it represents an unmodeled influence.
      return {
        entity_category: "abstract",
        entity_type: "variable",
        causal_role: "truth",
      };

    // ── Causal-modeling roles → existing entity types (1:1) ──
    case "outcome":
      return {
        entity_category: "abstract",
        entity_type: "outcome",
        causal_role: "outcome",
      };
    case "mediator":
      return {
        entity_category: "process",
        entity_type: "mediator",
        causal_role: "evidence",
      };
    case "modifier":
      return {
        entity_category: "abstract",
        entity_type: "modifier",
        causal_role: "evidence",
      };
    case "instrument":
      return {
        entity_category: "concrete",
        entity_type: "instrument",
        causal_role: "evidence",
      };
    case "condition":
      return {
        entity_category: "abstract",
        entity_type: "condition",
        causal_role: "evidence",
      };

    // ── Fallback ──
    case "unclassified":
    default:
      return {
        entity_category: "abstract",
        entity_type: "variable",
        causal_role: "truth",
      };
  }
}

function makeEntityCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return `vp_${slug || "variable"}_${Date.now().toString(36).slice(-4)}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
) {
  const { id: spaceId, proposalId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body } = await safeJsonParse<RequestBody>(request);
  const overrideEntityId =
    body?.entity_id_override && typeof body.entity_id_override === "string"
      ? body.entity_id_override.trim()
      : null;

  // Fetch the proposal to verify ownership + read role/name/etc.
  const { data: proposal, error: fetchErr } = (await db
    .from("variable_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: VariableProposal | null;
    error: { message: string } | null;
  };

  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to load proposal: ${fetchErr.message}` },
      { status: 500 },
    );
  }
  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 },
    );
  }

  // Idempotency — already approved? Return current state.
  if (proposal.user_status === "approved") {
    return NextResponse.json({
      proposal,
      entity_id: proposal.materialized_entity_id,
      already_approved: true,
    });
  }
  if (proposal.user_status === "rejected") {
    return NextResponse.json(
      { error: "Proposal was rejected; cannot approve" },
      { status: 409 },
    );
  }

  let materializedEntityId: string;

  if (overrideEntityId) {
    // User chose to link to an existing entity — verify it exists and
    // belongs to this space.
    const { data: existingEntity } = await db
      .from("entities")
      .select("entity_id")
      .eq("entity_id", overrideEntityId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (!existingEntity) {
      return NextResponse.json(
        { error: `Override entity ${overrideEntityId} not found in space` },
        { status: 404 },
      );
    }
    materializedEntityId = overrideEntityId;
  } else {
    // Materialize a new entities row from the proposal's metadata.
    const { entity_category, entity_type, causal_role } = mapRoleToEntityFields(
      proposal.variable_role,
    );

    const insertPayload = {
      space_id: spaceId,
      user_id: user.id,
      entity_id: makeEntityCode(proposal.proposed_name),
      name: proposal.proposed_name.trim().slice(0, 200),
      description: proposal.proposed_description?.trim().slice(0, 1000) ?? null,
      entity_type,
      entity_category,
      causal_role,
      source_tag:
        proposal.proposed_by === "manual" ? "explicit" : "implicit",
      authority_level: "unverified",
      confidence: proposal.confidence ?? 0.6,
      importance: "moderate",
      is_leverage_point: false,
      is_risk_point: false,
      knowledge_layer: "internal",
      provenance: {
        author:
          proposal.proposed_by === "manual"
            ? "user_manual_authoring"
            : "synthesis_proposal_approved",
        created_via: "variable_proposals.approve",
        proposal_id: proposal.id,
        variable_role: proposal.variable_role,
        source_field: proposal.source_field,
        source_strategy_version: proposal.source_strategy_version,
        metric_definition: proposal.metric_definition,
        approved_at: new Date().toISOString(),
      },
    };

    const { data: entityRow, error: insertErr } = await db
      .from("entities")
      .insert(insertPayload)
      .select("entity_id")
      .single();

    if (insertErr || !entityRow) {
      return NextResponse.json(
        {
          error: `Failed to materialize entity: ${insertErr?.message ?? "unknown"}`,
        },
        { status: 500 },
      );
    }
    materializedEntityId = (entityRow as { entity_id: string }).entity_id;
  }

  // Flip the proposal to 'approved' + record the materialized entity id.
  const { data: updated, error: updateErr } = (await db
    .from("variable_proposals")
    .update({
      user_status: "approved",
      approved_at: new Date().toISOString(),
      materialized_entity_id: materializedEntityId,
    })
    .eq("id", proposalId)
    .eq("user_id", user.id)
    .select("*")
    .single()) as {
    data: VariableProposal | null;
    error: { message: string } | null;
  };

  if (updateErr || !updated) {
    // Entity is created but proposal flip failed — log and return entity
    // anyway. Caller can retry the flip; the entity is persistent.
    console.warn(
      `[variable-proposals approve] entity created but proposal flip failed for ${proposalId}:`,
      updateErr?.message,
    );
    return NextResponse.json(
      {
        proposal: { ...proposal, materialized_entity_id: materializedEntityId },
        entity_id: materializedEntityId,
        warning:
          "Entity created but proposal status update failed; retry the approve to flip status",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    proposal: updated,
    entity_id: materializedEntityId,
  });
}
