// POST /api/spaces/[id]/entities/manual
//
// Researcher-authored entity creation. Bypasses the decompose LLM
// pipeline and writes directly to the entities table with:
//   • source_tag = "explicit" (the user typed it)
//   • authority_level = "unverified" (no evidence backs it yet)
//   • causal_role + entity_category mapped from a small "kind" enum
//     (intervention | variable | hypothesis)
//   • layer_ontology_id resolved from the optional layer_slug when
//     the space has an approved plan with materialized ontology rows
//
// Body:
//   {
//     name: string,
//     kind: "intervention" | "variable" | "hypothesis",
//     variable_kind?: "outcome" | "mediator" | "modifier" | "instrument" | "condition",
//     layer_slug?: string,
//     description?: string,
//   }
//
// Returns: { entity: Entity }
//
// Used by the +Intervention / +Variable / +Hypothesis canvas
// add-buttons. Gated client-side by spaces.manual_authoring_enabled.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import {
  loadLayerOntology,
  resolveLayerOntologyId,
} from "@/lib/pipeline/active-plan-loader";

export const runtime = "nodejs";

type ManualKind = "intervention" | "variable" | "hypothesis";
type VariableKind =
  | "outcome"
  | "mediator"
  | "modifier"
  | "instrument"
  | "condition";

interface RequestBody {
  name?: string;
  kind?: ManualKind;
  variable_kind?: VariableKind;
  layer_slug?: string;
  description?: string;
}

// Map (kind, variable_kind) → (entity_category, causal_role,
// entity_type). Kept tight + soft so future kinds slot in without
// schema changes.
function mapKindToFields(kind: ManualKind, variableKind?: VariableKind): {
  entity_category: string;
  entity_type: string;
  causal_role: string;
} {
  if (kind === "intervention") {
    return {
      entity_category: "process",
      entity_type: "intervention",
      causal_role: "application",
    };
  }
  if (kind === "hypothesis") {
    return {
      entity_category: "epistemic",
      entity_type: "hypothesis",
      causal_role: "truth",
    };
  }
  // kind === "variable" — sub-dispatch on variable_kind.
  switch (variableKind) {
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
    default:
      // Unspecified variable subkind — default to a neutral abstract
      // node. The user can edit category later via the entity drawer.
      return {
        entity_category: "abstract",
        entity_type: "variable",
        causal_role: "truth",
      };
  }
}

function makeEntityCode(name: string): string {
  // Cheap stable-ish id from name + timestamp suffix. Decompose's
  // sanitize uses a similar pattern.
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return `m_${slug || "entity"}_${Date.now().toString(36).slice(-4)}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<RequestBody>(request);
  if (bodyErr) return bodyErr;
  if (!body?.name || typeof body.name !== "string" || body.name.trim().length < 1) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }
  if (!body.kind || !["intervention", "variable", "hypothesis"].includes(body.kind)) {
    return NextResponse.json(
      { error: "kind must be one of: intervention | variable | hypothesis" },
      { status: 400 },
    );
  }

  const { entity_category, entity_type, causal_role } = mapKindToFields(
    body.kind,
    body.variable_kind,
  );

  // Resolve layer_ontology_id when the user picked a layer slug AND
  // an approved plan with materialized ontology rows exists.
  let layerOntologyId: string | null = null;
  if (body.layer_slug) {
    const ontology = await loadLayerOntology(db, spaceId);
    layerOntologyId = resolveLayerOntologyId(ontology, body.layer_slug);
  }

  const insertPayload = {
    space_id: spaceId,
    user_id: user.id,
    entity_id: makeEntityCode(body.name),
    name: body.name.trim().slice(0, 200),
    description:
      body.description && typeof body.description === "string"
        ? body.description.trim().slice(0, 1000)
        : null,
    entity_type,
    entity_category,
    causal_role,
    source_tag: "explicit",
    authority_level: "unverified",
    confidence: 0.6,
    importance: "moderate",
    is_leverage_point: false,
    is_risk_point: false,
    layer_ontology_id: layerOntologyId,
    knowledge_layer: body.layer_slug ? null : "internal",
    provenance: {
      author: "user_manual_authoring",
      created_via: "+Intervention/+Variable button",
      authored_at: new Date().toISOString(),
    },
  };

  const { data: entityRow, error: insertErr } = await db
    .from("entities")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertErr || !entityRow) {
    return NextResponse.json(
      { error: `Failed to create entity: ${insertErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ entity: entityRow });
}
