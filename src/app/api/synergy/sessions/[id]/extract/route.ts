// ── POST /api/synergy/sessions/[id]/extract ──
//
// Run component extraction over the board:
//   1. LLM emits typed buckets (core_ideas, upstream, downstream, polished_products)
//   2. Embed each component's (label + description_public) → embedding vector
//   3. Wipe the session's prior brainstorm_components rows + insert fresh
//      (replace-all is simplest; users re-run extraction when they want
//      a fresh take, and per-component edits go through a separate PATCH
//      that lands in Phase 4)
//
// Returns the full inserted set so the client can render the component card
// without a follow-up GET.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { embedTexts } from "@/lib/embeddings";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  EXTRACT_COMPONENTS_SCHEMA,
  EXTRACT_COMPONENTS_SYSTEM,
} from "@/lib/synergy/process-prompts";
import { collectAuthoritativePlans } from "@/lib/synergy/plan-meta";

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RawComponent {
  label_public: string;
  description_public: string;
  description_private: string;
  subkind?: string;
}

interface ExtractedComponents {
  core_ideas: RawComponent[];
  upstream: RawComponent[];
  downstream: RawComponent[];
  polished_products: RawComponent[];
}

interface DbNode {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string;
  meta: string | null;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id, title, objective_statement, objective_constraints, objective_success_criteria")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: nodeRows } = await db
    .from("brainstorm_nodes")
    .select("id, parent_id, kind, label, meta")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  const nodes = (nodeRows ?? []) as DbNode[];
  const visible = nodes.filter((n) => n.kind !== "user");
  if (visible.length === 0) {
    return NextResponse.json(
      { error: "Board is empty — add some nodes before extracting" },
      { status: 409 },
    );
  }

  // Pull authoritative plans first — these are the user's converged
  // synthesis artifacts and carry strong signals for upstream
  // (plan.resources) and downstream (plan.steps / outputs implied by
  // success_criteria). The LLM still does the extraction but with a
  // clear hint that plan content is canonical.
  const authoritativePlans = collectAuthoritativePlans(nodes);

  // Exclude plan-kind nodes from the prose summary — they get their
  // own structured block below to avoid double-counting.
  const boardForSummary = visible.filter((n) => n.kind !== "plan");
  const boardSummary = boardForSummary
    .map((n) => {
      const parent = nodes.find((p) => p.id === n.parent_id);
      const parentHint = parent ? ` (under: ${parent.label})` : "";
      const metaHint = n.meta ? ` — ${n.meta.slice(0, 200)}` : "";
      return `[${n.kind}] ${n.label}${parentHint}${metaHint}`;
    })
    .join("\n");

  const authoritativePlanBlock = authoritativePlans.length
    ? "\n\nAUTHORITATIVE PLANS (user-converged synthesis — treat resources as upstream, success criteria + step outputs as downstream):\n" +
      authoritativePlans
        .map(({ source, plan }, idx) => {
          const stepsList = plan.steps.map((s, i) => `    ${i + 1}. ${s.label}`).join("\n");
          const resourcesList = plan.resources.length
            ? `\n  Resources (likely upstream):\n    - ${plan.resources.join("\n    - ")}`
            : "";
          const successList = plan.success_criteria.length
            ? `\n  Success criteria (likely downstream metrics):\n    - ${plan.success_criteria.join("\n    - ")}`
            : "";
          return `Plan #${idx + 1} (from "${source.label}"):
  Goal: ${plan.goal}
  Steps:
${stepsList}${resourcesList}${successList}`;
        })
        .join("\n\n")
    : "";

  const objectiveBlock = session.objective_statement
    ? `\n\nObjective: ${session.objective_statement}\nConstraints: ${(session.objective_constraints ?? []).join("; ")}\nSuccess criteria: ${(session.objective_success_criteria ?? []).join("; ")}`
    : "";
  const userMsg = `Brainstorm title: ${session.title}${objectiveBlock}${authoritativePlanBlock}\n\nBoard contents (non-plan nodes):\n${boardSummary}`;

  let extracted: ExtractedComponents;
  try {
    extracted = await llmJSON<ExtractedComponents>({
      system: EXTRACT_COMPONENTS_SYSTEM,
      user: userMsg,
      maxTokens: 4096,
      temperature: 0.4,
      responseSchema: EXTRACT_COMPONENTS_SCHEMA as {
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
    console.error("[/api/synergy/.../extract] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Flatten into the shape we'll persist. Trim + drop blank labels.
  interface FlatComponent {
    kind: "core_idea" | "upstream" | "downstream" | "polished_product";
    subkind: string | null;
    label_public: string;
    description_public: string;
    description_private: string;
  }
  const flat: FlatComponent[] = [
    ...(extracted.core_ideas ?? []).map((c) => ({
      kind: "core_idea" as const,
      subkind: null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
    ...(extracted.upstream ?? []).map((c) => ({
      kind: "upstream" as const,
      subkind: c.subkind ?? null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
    ...(extracted.downstream ?? []).map((c) => ({
      kind: "downstream" as const,
      subkind: c.subkind ?? null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
    ...(extracted.polished_products ?? []).map((c) => ({
      kind: "polished_product" as const,
      subkind: null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
  ]
    .map((c) => ({
      ...c,
      label_public: c.label_public.trim().slice(0, 200),
      description_public: c.description_public.trim().slice(0, 800),
      description_private: c.description_private.trim().slice(0, 2000),
    }))
    .filter((c) => c.label_public.length > 0 && c.description_public.length > 0);

  if (flat.length === 0) {
    return NextResponse.json(
      { error: "AI returned no usable components — try again or add more board context" },
      { status: 502 },
    );
  }

  // Embed (label + description_public). Cosine similarity in Phase 4
  // operates on this same surface, so the embed must mirror what
  // matched users will see.
  const embedSurfaces = flat.map((c) => `${c.label_public}. ${c.description_public}`);
  let embeddings: number[][];
  try {
    embeddings = await embedTexts(embedSurfaces);
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    // Soft-fail on embeddings: persist without them so the user still
    // sees the extraction. Phase 4 has a backfill helper to fill nulls.
    console.warn("[/api/synergy/.../extract] embed failed, persisting without:", err);
    embeddings = [];
  }

  // Replace-all: wipe prior rows for this session, then insert fresh.
  const { error: deleteErr } = await db
    .from("brainstorm_components")
    .delete()
    .eq("session_id", sessionId);
  if (deleteErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(deleteErr) },
      { status: 500 },
    );
  }

  const payload = flat.map((c, i) => ({
    owner_id: user.id,
    session_id: sessionId,
    kind: c.kind,
    subkind: c.subkind,
    label_public: c.label_public,
    description_public: c.description_public,
    description_private: c.description_private,
    embedding: embeddings[i] ?? null,
    visibility: "matchable_only",
  }));

  const { data: inserted, error: insertErr } = await db
    .from("brainstorm_components")
    .insert(payload)
    .select(
      "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
    );
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  // Flag the session as processed so the list view can sort/filter.
  await db
    .from("brainstorm_sessions")
    .update({ state: "processed" })
    .eq("id", sessionId);

  return NextResponse.json({ components: inserted ?? [] });
}
