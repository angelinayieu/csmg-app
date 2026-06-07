// ── POST /api/objective/[spaceId]/unpack ────────────────────────────────
//
// Context-aware "Unpack": replaces /api/synergy/augment?mode=decompose for
// the OC build. The legacy decompose was a flat 4-bucket dump with no
// context — variations came out generic ("professional networking focus")
// because the model never saw the card's optimization targets, the parent
// sub-objective, or the intake factors. Output was unconnected strings, so
// the deployed grid had no causal edges.
//
// This route fixes both gaps:
//   1. ASSEMBLES context server-side — micros for the source card, intake
//      optimization factors, the sharpened objective, glossary, and one
//      hop up the link graph for the parent / source library_object.
//   2. RETURNS structured causal data — first_principles and variations,
//      where every variation carries `from_principles` (which principle it
//      derives from) + `optimizes_for` (which intake factor it serves). The
//      deploy path reads those slugs and draws REAL flow connectors between
//      the deployed cards, so the cluster reads as a causal map instead of
//      a flat grid.
//
// Also persists every principle + variation to library_objects (new
// object_type "first_principle"; "variation" was already in the taxonomy)
// and writes the causal edges into object_links as `derived_from`. That
// means the Library rail's Glossary/Objects view + the cluster graph
// surface them automatically — no separate UI work.
//
// Optional `priorTurns` + `mode: "refine" | "expand" | "constrain"` are
// reserved for the Phase 3 chat sidebar — the route handles them today
// (they thread into the prompt) so the sidebar can ship without touching
// the backend again.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON, BEST_CLAUDE_MODEL, detectCreditError } from "@/lib/llm";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import { loadOptimizationFactors } from "@/lib/objective-canvas/load-optimization-factors";
import {
  enrichSelection,
  renderSelectionContext,
} from "@/lib/objective-canvas/load-selection-context";
import {
  upsertLibraryObject,
  linkObjects,
} from "@/lib/objective-canvas/library-objects";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  /** Raw text of the source card (the powerup-rail already extracted it). */
  text?: unknown;
  /** Tldraw shape id of the source card — the anchor for context loading +
   *  the `derived_from` link target. */
  cardId?: unknown;
  /** "feature" / "variable" / "note" / … — drives the prompt framing. */
  sourceKind?: unknown;
  /** Optional explicit goal frame. When omitted the model infers one from
   *  the card's micros + parent factors. */
  goal?: unknown;
  /** Chat continuation — Phase 3 (reasoning sidebar). Ignored today by the
   *  cards/links output, but the model reads it so the response narrates
   *  the delta ("expanding P2 into 3 new variations…"). */
  priorTurns?: unknown;
  /** "initial" (default) | "refine" | "expand" | "constrain" — discriminator
   *  for the chat loop. */
  mode?: unknown;
  /** 0–1 — passed through to the LLM. Defaults to 0.45 (decompose is
   *  generative but should stay anchored). */
  temperature?: unknown;
}

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

/** Tight slug derived from a label — 1:1 with library_objects.source_ref. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Output schema — mirrored as a Claude tool so the model is FORCED to
 *  emit the causal fields. Without these we're back to flat strings. */
const UNPACK_SCHEMA = {
  name: "unpack_result",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reasoning_log: {
        type: "array",
        description:
          "5–10 short lines (≤ 22 words each) narrating how you got from the card + context to the principles + variations. Streamed into the sidebar to show your work.",
        items: { type: "string" },
      },
      goal_frame: {
        type: "object",
        additionalProperties: false,
        properties: {
          goal: {
            type: "string",
            description:
              "1–4 words naming the purpose this unpack is serving (e.g. 'reduce friction', 'simplify', 'lift retention', 'broaden audience'). Inferred from micros + factors when the caller didn't specify.",
          },
          evidence: {
            type: "string",
            description:
              "≤ 24 words citing which micro slugs / factor slugs / parent card you read to settle on this goal.",
          },
        },
        required: ["goal", "evidence"],
      },
      first_principles: {
        type: "array",
        description:
          "3–6 IRREDUCIBLE truths that must hold for the card to succeed under the goal_frame. Each names a mechanism, constraint, or invariant — not a restatement of the card.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: {
              type: "string",
              description:
                "kebab-case stable id ≤ 48 chars, unique among first_principles.",
            },
            label: {
              type: "string",
              description: "Display title, ≤ 9 words.",
            },
            rationale: {
              type: "string",
              description:
                "1–2 sentences on WHY this is irreducible HERE (cites a factor / micro / parent constraint).",
            },
            cites_factors: {
              type: "array",
              description:
                "Factor slugs (from the provided optimization_factors list) this principle serves. Empty if none directly apply.",
              items: { type: "string" },
            },
            cites_micros: {
              type: "array",
              description:
                "Micro slugs (from the source card's micros) this principle traces to. Empty if none directly apply.",
              items: { type: "string" },
            },
          },
          required: ["slug", "label", "rationale", "cites_factors", "cites_micros"],
        },
      },
      variations: {
        type: "array",
        description:
          "3–7 concrete variations of the card that operate under the principles. Every variation MUST cite at least one principle in from_principles — variations with no causal parent are noise.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: {
              type: "string",
              description:
                "kebab-case stable id ≤ 48 chars, unique among variations.",
            },
            label: {
              type: "string",
              description: "Display title, ≤ 9 words.",
            },
            rationale: {
              type: "string",
              description:
                "1–2 sentences naming the move + how it advances optimizes_for.",
            },
            from_principles: {
              type: "array",
              description:
                "Principle slugs (from first_principles above) this variation derives from. MUST be non-empty.",
              items: { type: "string" },
              minItems: 1,
            },
            optimizes_for: {
              type: "array",
              description:
                "Factor slugs (from the provided optimization_factors list) this variation pushes on. Empty if generic.",
              items: { type: "string" },
            },
            tradeoff: {
              type: "string",
              description:
                "1 sentence: 'wins on X, loses on Y' — what this variation gives up.",
            },
          },
          required: [
            "slug",
            "label",
            "rationale",
            "from_principles",
            "optimizes_for",
            "tradeoff",
          ],
        },
      },
      ranking: {
        type: "array",
        description:
          "Every principle slug + every variation slug, ranked best→worst under the goal_frame. score is 0–100.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: { type: "string" },
            score: { type: "number" },
            why: { type: "string", description: "≤ 18 words." },
          },
          required: ["slug", "score", "why"],
        },
      },
    },
    required: [
      "reasoning_log",
      "goal_frame",
      "first_principles",
      "variations",
      "ranking",
    ],
  },
} as const;

interface UnpackResult {
  reasoning_log: string[];
  goal_frame: { goal: string; evidence: string };
  first_principles: {
    slug: string;
    label: string;
    rationale: string;
    cites_factors: string[];
    cites_micros: string[];
  }[];
  variations: {
    slug: string;
    label: string;
    rationale: string;
    from_principles: string[];
    optimizes_for: string[];
    tradeoff: string;
  }[];
  ranking: { slug: string; score: number; why: string }[];
}

function buildSystem(mode: string): string {
  const base =
    "You decompose a single whiteboard card into first principles and variations that are CONTEXTUAL to the user's project — never generic. " +
    "Read the OBJECTIVE, the optimization factors, the source card's own micro-objectives, and any parent/source links carefully. " +
    "Reason in this order: 1) infer the goal_frame for this unpack (cite specific factor/micro slugs), 2) name 3–6 irreducible first_principles under that frame, 3) derive 3–7 variations where EACH cites at least one principle in from_principles, 4) rank them. " +
    "Hard rules: every variation's from_principles MUST reference a real principle slug you emitted. Every cites_factors / optimizes_for slug MUST come from the provided optimization_factors list (or be omitted). Labels ≤ 9 words. " +
    "Do not restate the card — derive irreducible mechanisms, audiences, constraints, or invariants behind it.";
  if (mode === "refine") {
    return (
      base +
      " The user is refining a prior run; treat priorTurns as feedback and produce a TIGHTENED set (drop weak items, sharpen labels, re-anchor rationale to the new constraint)."
    );
  }
  if (mode === "expand") {
    return (
      base +
      " The user wants to expand ONE prior item; treat priorTurns as the focus and emit new variations that ladder back to the named principle."
    );
  }
  if (mode === "constrain") {
    return (
      base +
      " The user is adding a constraint; treat priorTurns as the new constraint and re-derive principles + variations that satisfy it."
    );
  }
  return base;
}

function buildUserPrompt(args: {
  cardText: string;
  sourceKind: string;
  goal: string;
  objective: string;
  preamble: string;
  factorsBlock: string;
  selectionBlock: string;
  priorTurnsBlock: string;
}): string {
  const parts: string[] = [];
  if (args.preamble) parts.push(args.preamble.trim());
  parts.push(
    `OBJECTIVE\n${args.objective || "(no sharpened objective on file — reason from the card alone)"}`,
  );
  parts.push(args.factorsBlock);
  if (args.selectionBlock) parts.push(args.selectionBlock);
  parts.push(`SOURCE CARD (${args.sourceKind || "card"})\n${args.cardText}`);
  if (args.goal) parts.push(`USER-SPECIFIED GOAL FOR THIS UNPACK\n${args.goal}`);
  if (args.priorTurnsBlock) parts.push(args.priorTurnsBlock);
  parts.push(
    "Return the unpack_result tool. Every variation MUST cite at least one of YOUR first_principle slugs in from_principles, and cited factor slugs MUST appear in the list above.",
  );
  return parts.join("\n\n");
}

/** Format optimization factors so the model can cite them by slug. */
function renderFactors(
  factors: { slug: string; label: string; kind: string; why: string }[],
): string {
  if (!factors.length) {
    return "OPTIMIZATION FACTORS\n(no intake factors on file — variations can omit optimizes_for)";
  }
  const lines = factors.map(
    (f) => `- ${f.slug} [${f.kind}]: ${f.label} — ${f.why}`,
  );
  return `OPTIMIZATION FACTORS (cite by slug only)\n${lines.join("\n")}`;
}

function renderPriorTurns(
  turns: Array<{ role: string; text: string }>,
): string {
  if (!turns.length) return "";
  const lines = turns
    .slice(-8)
    .map((t) => `${t.role === "assistant" ? "AI" : "User"}: ${t.text}`);
  return `PRIOR TURNS\n${lines.join("\n")}`;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
  const sourceKind =
    typeof body.sourceKind === "string" ? body.sourceKind.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 200) : "";
  const mode =
    typeof body.mode === "string" &&
    ["initial", "refine", "expand", "constrain"].includes(body.mode)
      ? (body.mode as "initial" | "refine" | "expand" | "constrain")
      : "initial";
  const temperature =
    typeof body.temperature === "number"
      ? Math.min(1, Math.max(0, body.temperature))
      : 0.45;
  const priorTurns = Array.isArray(body.priorTurns)
    ? (body.priorTurns as unknown[])
        .map((t) => {
          const o = (t ?? {}) as Record<string, unknown>;
          const role =
            o.role === "assistant" ? "assistant" : ("user" as const);
          const text = typeof o.text === "string" ? o.text.slice(0, 800) : "";
          return text ? { role, text } : null;
        })
        .filter((t): t is { role: "assistant" | "user"; text: string } => !!t)
    : [];

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 6000) {
    return NextResponse.json(
      { error: "text too long (max 6000)" },
      { status: 400 },
    );
  }

  // Ownership check — matches make-plan / artifacts contract.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Context assembly ──
  // Three concurrent reads: glossary/sharpened-objective, intake factors,
  // the source card's micros + notes + links + sources. All soft-fail.
  let objective = "";
  let preamble = "";
  let factors: Awaited<ReturnType<typeof loadOptimizationFactors>> = [];
  let selectionBlock = "";
  let sourceLibraryObjectId: string | null = null;
  try {
    const [spaceCtx, factorsResolved, enriched] = await Promise.all([
      buildSpaceContext(supabase, spaceId),
      loadOptimizationFactors(supabase, spaceId),
      cardId
        ? enrichSelection(supabase, spaceId, [cardId])
        : Promise.resolve([]),
    ]);
    objective = (spaceCtx.objective ?? "").trim();
    preamble = (spaceCtx.preamble ?? "").trim();
    factors = factorsResolved;
    if (enriched.length) {
      // renderSelectionContext formats ONE enriched item (micros / notes /
      // sources / links). The source card is one item — wrap the rendered
      // block in a header so the model knows what it's reading.
      const item = enriched[0];
      sourceLibraryObjectId = item.libraryObjectId;
      const rendered = renderSelectionContext(item).trim();
      if (rendered) {
        selectionBlock = `SOURCE CARD CONTEXT (micros / notes / sources / outbound links)\n${rendered}`;
      }
    }
  } catch (err) {
    // Hard-fail in dev so missing wiring is loud; soft-fail in prod so a
    // bad migration doesn't 500 the user's unpack.
    console.warn("[unpack] context load failed (soft):", err);
  }

  const factorsBlock = renderFactors(
    factors.map((f) => ({
      slug: f.slug,
      label: f.label,
      kind: f.kind,
      why: f.why,
    })),
  );
  const priorTurnsBlock = renderPriorTurns(priorTurns);

  // ── LLM call ──
  // BEST_CLAUDE_MODEL = Opus 4-7 per src/lib/llm.ts (memory:
  // reference_claude_model_constraints — 4-8 was rolled back). llmJSON
  // failover to OpenAI is built in on Anthropic credit-dry.
  let result: UnpackResult;
  try {
    result = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
      () =>
        llmJSON<UnpackResult>({
          system: buildSystem(mode),
          user: buildUserPrompt({
            cardText: text,
            sourceKind,
            goal,
            objective,
            preamble,
            factorsBlock,
            selectionBlock,
            priorTurnsBlock,
          }),
          provider: "anthropic",
          model: BEST_CLAUDE_MODEL,
          maxTokens: 3072,
          temperature,
          responseSchema: UNPACK_SCHEMA as unknown as {
            name: string;
            schema: Record<string, unknown>;
          },
        }),
    );
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/objective/[spaceId]/unpack] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // ── Dedup + integrity ──
  // The model is told to keep slugs unique, but enforce here so a sloppy
  // run can't create duplicate library_objects or break the from_principles
  // edge resolution. Pre-clean slugs to kebab in case the model freelanced.
  const seenPrinciple = new Set<string>();
  const principles = (result.first_principles ?? [])
    .map((p) => ({
      ...p,
      slug: slugify(p.slug || p.label),
    }))
    .filter((p) => {
      if (!p.slug || seenPrinciple.has(p.slug)) return false;
      seenPrinciple.add(p.slug);
      return true;
    });
  const seenVariation = new Set<string>();
  const variations = (result.variations ?? [])
    .map((v) => ({
      ...v,
      slug: slugify(v.slug || v.label),
      from_principles: (v.from_principles ?? [])
        .map((s) => slugify(s))
        .filter((s) => seenPrinciple.has(s)),
    }))
    .filter((v) => {
      if (!v.slug || seenVariation.has(v.slug)) return false;
      // Hard rule from the schema: a variation with no resolved principle
      // is meaningless. Drop it rather than land an orphan on the board.
      if (v.from_principles.length === 0) return false;
      seenVariation.add(v.slug);
      return true;
    });

  // ── Persistence ──
  // Every principle + variation becomes a library_objects row, idempotent
  // on (space_id, object_type, source_ref). The causal edges go into
  // object_links as `derived_from`. Both writes are soft-fail — the route
  // still returns the result so the client deploys cards even if Supabase
  // can't write today. The slug becomes the source_ref so re-running the
  // same unpack (same slugs) updates rather than duplicates.
  const principleIdBySlug = new Map<string, string>();
  await Promise.all(
    principles.map(async (p) => {
      const id = await upsertLibraryObject(supabase, {
        spaceId,
        userId: user.id,
        objectType: "first_principle",
        title: p.label,
        summary: p.rationale,
        sourceRef: `unpack:${cardId || "no-card"}:fp:${p.slug}`,
        contentSnapshot: {
          slug: p.slug,
          rationale: p.rationale,
          cites_factors: p.cites_factors,
          cites_micros: p.cites_micros,
          source_card_id: cardId || null,
          goal_frame: result.goal_frame,
        },
      });
      if (id) principleIdBySlug.set(p.slug, id);
    }),
  );
  const variationIdBySlug = new Map<string, string>();
  await Promise.all(
    variations.map(async (v) => {
      const id = await upsertLibraryObject(supabase, {
        spaceId,
        userId: user.id,
        objectType: "variation",
        title: v.label,
        summary: v.rationale,
        sourceRef: `unpack:${cardId || "no-card"}:var:${v.slug}`,
        contentSnapshot: {
          slug: v.slug,
          rationale: v.rationale,
          tradeoff: v.tradeoff,
          from_principles: v.from_principles,
          optimizes_for: v.optimizes_for,
          source_card_id: cardId || null,
        },
      });
      if (id) variationIdBySlug.set(v.slug, id);
    }),
  );

  // Causal edges. Two kinds:
  //   1. variation → principle (derived_from) — the core causal map.
  //   2. principle → source library object (derived_from) — closes the
  //      loop so the cluster graph + Library rail surface "these principles
  //      were unpacked from THIS card". Only when the source resolved to a
  //      library_objects row (raw stickies have no row to point at).
  const edgeWrites: Promise<void>[] = [];
  for (const v of variations) {
    const vid = variationIdBySlug.get(v.slug);
    if (!vid) continue;
    for (const pSlug of v.from_principles) {
      const pid = principleIdBySlug.get(pSlug);
      if (!pid) continue;
      edgeWrites.push(
        linkObjects(supabase, {
          spaceId,
          fromObjectId: vid,
          toObjectId: pid,
          relation: "derived_from",
        }),
      );
    }
  }
  if (sourceLibraryObjectId) {
    for (const id of principleIdBySlug.values()) {
      edgeWrites.push(
        linkObjects(supabase, {
          spaceId,
          fromObjectId: id,
          toObjectId: sourceLibraryObjectId,
          relation: "derived_from",
        }),
      );
    }
  }
  await Promise.all(edgeWrites);

  // ── Response ──
  // The client deploy path reads `cards` + `links` to lay the cluster out
  // with REAL flow connectors. Each card carries the persisted objectId so
  // a single click opens the ObjectDetailDrawer (no dead ends), and `kind`
  // tells the deployer which subsystem swimlane it belongs to (one lane
  // per principle, variations sit under their parent principle).
  const cards = [
    ...principles.map((p) => ({
      slug: p.slug,
      objectId: principleIdBySlug.get(p.slug) ?? null,
      kind: "first_principle" as const,
      title: p.label,
      body: p.rationale,
      subsystem: "Principles",
      cites_factors: p.cites_factors,
      cites_micros: p.cites_micros,
    })),
    ...variations.map((v) => ({
      slug: v.slug,
      objectId: variationIdBySlug.get(v.slug) ?? null,
      kind: "variation" as const,
      title: v.label,
      body: v.rationale,
      // One subsystem per parent principle, so variations group visually
      // under their causal parent in the deployed cluster.
      subsystem: v.from_principles[0] || "Variations",
      from_principles: v.from_principles,
      optimizes_for: v.optimizes_for,
      tradeoff: v.tradeoff,
    })),
  ];
  const links = variations.flatMap((v) =>
    v.from_principles.map((pSlug) => ({
      fromSlug: v.slug,
      toSlug: pSlug,
      relation: "derived_from" as const,
    })),
  );

  return NextResponse.json({
    goal_frame: result.goal_frame,
    reasoning_log: result.reasoning_log ?? [],
    ranking: result.ranking ?? [],
    cards,
    links,
  });
}
