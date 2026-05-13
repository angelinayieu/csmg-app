// ── POST /api/synergy/components/[id]/regenerate ──
//
// Single-component regeneration. Re-extracts a fresh label +
// description + private context for one specific component without
// touching the other components in its session. Then re-embeds it
// and triggers a targeted matcher run so the discover/rooms feed
// stays fresh.
//
// Use case: the LLM's first extraction got this one wrong. The user
// wants a do-over for *this idea* without nuking the others they're
// happy with.
//
// Pipeline:
//   1. Authorize (owner-only via RLS)
//   2. Build the context block (objective + plans + board) just like
//      the session-level extract does
//   3. Call the LLM with a "regenerate THIS component" prompt that
//      tells it which kind/subkind to stick to and the current label
//      as anchor
//   4. Update the row in place (preserve the id so existing matches
//      still point at it; we'll re-match below)
//   5. Re-embed and store fresh embedding
//   6. Wipe component_matches rows involving this component (they're
//      stale relative to the new embedding/text)
//   7. Re-run the matcher for this single component
//   8. Return the new row + new match count

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { embedTexts } from "@/lib/embeddings";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { collectAuthoritativePlans } from "@/lib/synergy/plan-meta";
import { matchOneComponent } from "@/lib/synergy/matcher";

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Targeted single-component regenerate prompt. Constrained to emit
// the SAME kind (no shifting upstream→downstream mid-flight) and
// designed to read the prior text as "what we had" + the board as
// "the real source of truth."
const REGEN_SYSTEM = `You are regenerating ONE component from a brainstorm board because the previous extraction didn't match the user's intent.

You will be given:
- The component's current kind (core_idea / upstream / downstream / polished_product) and subkind hint
- The component's PRIOR label + description (which the user wants improved)
- The full board context (objective + plan synthesis + visible nodes)

Rules:
- Stay in the SAME kind. Don't shift category mid-regenerate.
- The new label_public + description_public must be MORE specific and grounded in the board than the prior version. If the prior was vague, get concrete. If it was wrong, fix the framing.
- description_public is what a STRANGER will read — it must be self-contained and free of session-specific framing.
- description_private is for the owner's own notes — longer context, references to specific board nodes welcome.
- label_public stays under 200 chars; description_public ≤ 800; description_private ≤ 2000.

Return JSON: { label_public, description_public, description_private }.`;

const REGEN_SCHEMA = {
  name: "synergy_regen_component",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      label_public: { type: "string" },
      description_public: { type: "string" },
      description_private: { type: "string" },
    },
    required: ["label_public", "description_public", "description_private"],
  },
} as const;

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: componentId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load the component + its session (RLS gates ownership)
  const { data: existing } = await db
    .from("brainstorm_components")
    .select(
      "id, owner_id, session_id, kind, subkind, label_public, description_public, description_private",
    )
    .eq("id", componentId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Pull session + board context (same shape as the session-level extract)
  const { data: session } = await db
    .from("brainstorm_sessions")
    .select(
      "id, title, objective_statement, objective_constraints, objective_success_criteria",
    )
    .eq("id", existing.session_id)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: nodeRows } = await db
    .from("brainstorm_nodes")
    .select("id, parent_id, kind, label, meta")
    .eq("session_id", existing.session_id)
    .order("created_at", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes = (nodeRows ?? []) as any[];
  const visible = nodes.filter((n) => n.kind !== "user");

  // Authoritative-plan block (same plan-aware pipeline as session extract)
  const authoritativePlans = collectAuthoritativePlans(nodes);
  const planBlock = authoritativePlans.length
    ? "AUTHORITATIVE PLANS (user-converged synthesis):\n" +
      authoritativePlans
        .map(
          ({ source, plan }, idx) =>
            `Plan #${idx + 1} (from "${source.label}"):\n  Goal: ${plan.goal}\n  Steps:\n${plan.steps.map((s, i) => `    ${i + 1}. ${s.label}`).join("\n")}`,
        )
        .join("\n\n") +
      "\n\n"
    : "";

  const boardSummary = visible
    .filter((n) => n.kind !== "plan")
    .map((n) => `[${n.kind}] ${n.label}`)
    .slice(0, 200) // cap to stay under token budget
    .join("\n");

  const objectiveLine = session.objective_statement
    ? `Objective: ${session.objective_statement}\n`
    : "";

  const userMsg = `Component to regenerate:
  kind: ${existing.kind}${existing.subkind ? " / " + existing.subkind : ""}
  prior label: ${existing.label_public}
  prior description: ${existing.description_public}

${objectiveLine}${planBlock}Board contents:
${boardSummary || "(empty)"}`;

  // Call the LLM
  let regen: {
    label_public: string;
    description_public: string;
    description_private: string;
  };
  try {
    regen = await llmJSON({
      system: REGEN_SYSTEM,
      user: userMsg,
      maxTokens: 1500,
      temperature: 0.5,
      responseSchema: REGEN_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/components/.../regenerate] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Clean + cap
  const cleaned = {
    label_public: regen.label_public.trim().slice(0, 200),
    description_public: regen.description_public.trim().slice(0, 800),
    description_private: regen.description_private.trim().slice(0, 2000),
  };
  if (!cleaned.label_public || !cleaned.description_public) {
    return NextResponse.json(
      { error: "Regenerated component was empty — try again" },
      { status: 502 },
    );
  }

  // Re-embed against the new label + public description (matcher
  // does cosine against the same surface)
  let newEmbedding: number[] | null = null;
  try {
    const embeds = await embedTexts([
      `${cleaned.label_public}. ${cleaned.description_public}`,
    ]);
    newEmbedding = embeds[0] ?? null;
  } catch (err) {
    console.warn(
      "[/api/synergy/components/.../regenerate] embed failed; persisting without:",
      err,
    );
  }

  // Update the row (preserve id; matches will be wiped + re-run below)
  const { data: updated, error: updateErr } = await db
    .from("brainstorm_components")
    .update({
      label_public: cleaned.label_public,
      description_public: cleaned.description_public,
      description_private: cleaned.description_private,
      embedding: newEmbedding,
    })
    .eq("id", componentId)
    .select(
      "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
    )
    .single();
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(updateErr) },
      { status: 500 },
    );
  }

  // Wipe stale matches involving this component (both sides of the
  // canonical pair) and re-run the matcher on just this component.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serviceDb = createServiceClient() as any;

  await serviceDb
    .from("component_matches")
    .delete()
    .or(`component_a.eq.${componentId},component_b.eq.${componentId}`);

  let matchResult: {
    candidates_considered: number;
    matches_persisted: number;
  } = { candidates_considered: 0, matches_persisted: 0 };
  if (newEmbedding) {
    try {
      matchResult = await matchOneComponent(serviceDb, {
        id: componentId,
        owner_id: existing.owner_id,
        session_id: existing.session_id,
        kind: existing.kind,
        subkind: existing.subkind,
        label_public: cleaned.label_public,
        description_public: cleaned.description_public,
        objective_statement: session.objective_statement,
      });
    } catch (err) {
      // Soft-fail the match run; the component itself is already
      // regenerated. User can hit "find collaborators" later to retry.
      console.warn(
        "[/api/synergy/components/.../regenerate] match re-run failed:",
        err,
      );
    }
  }

  return NextResponse.json({
    component: updated,
    match_count: matchResult.matches_persisted,
    candidates_considered: matchResult.candidates_considered,
  });
}
