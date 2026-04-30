// ── /api/spaces/[id]/lab-scaffolds ───────────────────────────────
//
// GET  → list lab scaffolds for a space (latest first; filter by
//        `?status=proposed` to get only pending wizards).
// POST → "propose": LLM-generates a lab proposal payload (subjects
//        + features) given the current strategy + available systems.
//        Inserts a row with status='proposed'. Older proposed rows
//        for the same space move to status='superseded' so the
//        wizard always shows one current proposal.
//
// This is the "wizard payload generator" half. Approval lives at
// /api/lab-scaffolds/[id]/approve which materializes the subjects.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { STARTER_MODULATORS } from "@/lib/subjects/modulators";
import type {
  LabScaffold,
  ProposedFeature,
  ProposedSubject,
} from "@/types/subject";

export const dynamic = "force-dynamic";
// GET is a polling endpoint — cap low. POST below does LLM work so it
// has its own implicit higher cap when invoked.
export const maxDuration = 30;

interface Ctx {
  params: Promise<{ id: string }>;
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let query = db
    .from("lab_scaffolds")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });
  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Status changes when an LLM proposal completes (minutes); 30s
  // staleness is fine. Cuts polling pressure on Supabase.
  return NextResponse.json(
    {
      scaffolds: (data ?? []) as LabScaffold[],
      computed_at: new Date().toISOString(),
    },
    {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    },
  );
}

// ── POST (propose) ───────────────────────────────────────────────
//
// Body: { strategy_snapshot_id?: string, pipeline_run_id?: string }
// Both optional — when omitted, the latest active strategy snapshot
// for this space is used. Useful for manual "propose me a lab"
// invocations from the UI; pipeline triggers always pass both.

interface ProposeBody {
  strategy_snapshot_id?: string;
  pipeline_run_id?: string;
}

interface LlmProposalShape {
  proposed_subjects: Array<{
    focus_kind: string;
    focus_label: string;
    name?: string;
    description?: string;
    artifact_state?: string;
    suggested_scope_system_id?: string;
    suggested_baseline_snapshot_id?: string;
    suggested_conditions?: Record<string, number>;
    rationale?: string;
  }>;
  proposed_features: Array<{
    id: string;
    default_on: boolean;
    rationale?: string;
  }>;
  proposed_parameters?: Record<string, unknown>;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body } = await safeJsonParse<Partial<ProposeBody>>(request);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Pull strategic context for the proposal ──────────────────
  const { data: spaceRow } = await db
    .from("spaces")
    .select("name, description, input_text")
    .eq("id", spaceId)
    .single();
  if (!spaceRow) {
    return NextResponse.json(
      { error: "space not found" },
      { status: 404 },
    );
  }

  // Strategy snapshot: prefer explicit, fall back to latest active.
  let strategySnapshotId = body?.strategy_snapshot_id ?? null;
  let strategyTitle: string | null = null;
  if (strategySnapshotId) {
    const { data: snap } = await db
      .from("strategy_snapshots")
      .select("id, recommendation")
      .eq("id", strategySnapshotId)
      .maybeSingle();
    if (snap) {
      const rec = snap.recommendation as { title?: string } | null;
      strategyTitle = rec?.title ?? null;
    }
  } else {
    const { data: latest } = await db
      .from("strategy_snapshots")
      .select("id, recommendation")
      .eq("space_id", spaceId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      strategySnapshotId = latest.id as string;
      const rec = latest.recommendation as { title?: string } | null;
      strategyTitle = rec?.title ?? null;
    }
  }

  // Available systems — propose subjects can suggest scoping to one.
  const { data: systemRows } = await db
    .from("systems")
    .select("id, name, focus_label:name, entity_count, is_complex")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(10);
  const availableSystems = (systemRows ?? []) as Array<{
    id: string;
    name: string;
    entity_count: number;
    is_complex: boolean;
  }>;

  // Latest snapshot — propose subjects can suggest baselining to one.
  const { data: latestSnap } = await db
    .from("twin_snapshots")
    .select("id, captured_at, reason")
    .eq("space_id", spaceId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── LLM call ──────────────────────────────────────────────────
  // Constrain the model to the modulator vocabulary + 4 fixed
  // feature ids so we don't get back hallucinated keys.
  const allowedModulatorKeys = STARTER_MODULATORS.map((m) => m.key).join(", ");
  const modulatorVocab = STARTER_MODULATORS.map(
    (m) =>
      `  - ${m.key} (${m.units}, default ${m.default}, range ${m.range[0]}–${m.range[1]}): ${m.description}`,
  ).join("\n");

  const sysPrompt = `You are proposing a lab setup for a knowledge-graph-based experimentation environment.

Output JSON ONLY conforming to the schema. No prose.

Constraints:
- proposed_subjects: 1-3 entries. Each "subject" is a center of focus to manipulate (a person, document, product, topic, environment, system, data, reaction).
- proposed_features: exactly four entries with ids: monte_carlo, what_if, ab_compare, deepen_kg. Set default_on per how relevant each is to the strategy.
- Allowed modulator keys for suggested_conditions (only use these): ${allowedModulatorKeys}.
- focus_kind must be one of: person, document, product, topic, environment, system, data, reaction, other.
- artifact_state: bare_topic | partial_artifact | complete_artifact.
- Use suggested_scope_system_id when one of the available systems naturally bounds the subject. Leave null otherwise.
- Use suggested_baseline_snapshot_id only if a snapshot is provided.
- Keep rationale strings under 240 chars.

Modulator vocabulary:
${modulatorVocab}`;

  const userPrompt = `SPACE
  name: ${spaceRow.name}
  description: ${spaceRow.description ?? "(none)"}
  initial prompt: ${spaceRow.input_text ?? "(none)"}

ACTIVE STRATEGY
  title: ${strategyTitle ?? "(none)"}

AVAILABLE SYSTEMS (pick one as suggested_scope_system_id when natural)
${availableSystems
  .map(
    (s) =>
      `  - id=${s.id} | name="${s.name}" | entities=${s.entity_count} | complex=${s.is_complex}`,
  )
  .join("\n") || "  (none)"}

LATEST SNAPSHOT
${
  latestSnap
    ? `  id=${latestSnap.id} | captured=${latestSnap.captured_at} | reason=${latestSnap.reason}`
    : "  (none)"
}

TASK
Propose 1-3 subjects + the 4 feature toggles + any parameter overrides. Output JSON only.`;

  let proposal: LlmProposalShape;
  try {
    proposal = await llmJSON<LlmProposalShape>({
      system: sysPrompt,
      user: userPrompt,
      maxTokens: 1200,
      temperature: 0.3,
      responseSchema: {
        name: "lab_proposal",
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "proposed_subjects",
            "proposed_features",
            "proposed_parameters",
          ],
          properties: {
            proposed_subjects: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["focus_kind", "focus_label"],
                properties: {
                  focus_kind: {
                    type: "string",
                    enum: [
                      "person",
                      "document",
                      "product",
                      "topic",
                      "environment",
                      "system",
                      "data",
                      "reaction",
                      "other",
                    ],
                  },
                  focus_label: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  artifact_state: {
                    type: "string",
                    enum: [
                      "bare_topic",
                      "partial_artifact",
                      "complete_artifact",
                    ],
                  },
                  suggested_scope_system_id: { type: ["string", "null"] },
                  suggested_baseline_snapshot_id: {
                    type: ["string", "null"],
                  },
                  suggested_conditions: {
                    type: "object",
                    additionalProperties: { type: "number" },
                  },
                  rationale: { type: "string" },
                },
              },
            },
            proposed_features: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "default_on"],
                properties: {
                  id: {
                    type: "string",
                    enum: ["monte_carlo", "what_if", "ab_compare", "deepen_kg"],
                  },
                  default_on: { type: "boolean" },
                  rationale: { type: "string" },
                },
              },
            },
            proposed_parameters: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      },
    });
  } catch (err) {
    console.warn("[lab-scaffolds propose] LLM failed:", err);
    return NextResponse.json(
      {
        error: `proposal generation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  // ── Supersede older proposals so the wizard shows one current ──
  await db
    .from("lab_scaffolds")
    .update({ status: "superseded" })
    .eq("space_id", spaceId)
    .eq("status", "proposed");

  // ── Insert the new proposal ──────────────────────────────────
  const insertRow = {
    space_id: spaceId,
    user_id: user.id,
    proposed_subjects: proposal.proposed_subjects as unknown as ProposedSubject[],
    proposed_features:
      proposal.proposed_features as unknown as ProposedFeature[],
    proposed_parameters: proposal.proposed_parameters ?? {},
    source_strategy_snapshot_id: strategySnapshotId,
    pipeline_run_id: body?.pipeline_run_id ?? null,
    status: "proposed" as const,
  };
  const { data: inserted, error: insertErr } = await db
    .from("lab_scaffolds")
    .insert(insertRow)
    .select("*")
    .single();
  if (insertErr) {
    return NextResponse.json(
      { error: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { scaffold: inserted as LabScaffold },
    { status: 201 },
  );
}
