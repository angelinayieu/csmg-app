// ── POST /api/objective/[spaceId]/cluster-next-move ──────────────────
//
// When a generation op drops a CLUSTER on the board (Deep Synthesize hub +
// branches today; decompose / make_plan / variations follow the same shape
// next), the recommender overlay calls this route to ask: given the cluster
// the user just got + the user's intake-defined optimization factors, what
// is the SINGLE highest-leverage next op, and what's the runner-up?
//
// The brain reuses the philosophy of `analyses/recommend-next-move.ts` but
// scoped to ONE cluster (not the full cross-room state) so the LLM call is
// fast (sonnet, ~1s) and the answer is grounded in what the user is looking
// at. Three signals into the prompt:
//   1. The cluster — title / role / factor for each library_object.
//   2. The covered factor slugs — what the cluster ALREADY advances.
//   3. The uncovered high-priority salience annotations — what the cluster
//      DOESN'T advance, ranked by leverage × uncertainty. This is the gap.
//
// The LLM picks from a SHORTLIST of wired canvas-operations ids — it can't
// invent an op id, so the overlay's click always maps to an executable verb.
// Result: { primary: { op, label, rationale, factorLabel }, secondary: [...] }.
//
// Soft-fail: any read failure returns 200 with `primary: null` so the
// overlay just doesn't show; never break the surface that spawned us.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  getLibraryObject,
  type LibraryObjectRow,
} from "@/lib/objective-canvas/library-objects";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface ClusterNextMoveBody {
  kind?: string;
  hubObjectId?: string;
  branchObjectIds?: string[];
  factorSlugs?: string[];
}

/** Shortlist of WIRED canvas ops the recommender is allowed to pick from.
 *  Keep it short — the overlay shows at most 3 moves, and a longer list
 *  dilutes ranking. Every id here MUST be `wired: true` in
 *  canvas-operations.ts; if you add one, verify the executor handles it. */
const ALLOWED_OPS = [
  { id: "converge", label: "Converge to decisions" },
  { id: "diverge", label: "Diverge further" },
  { id: "make_plan", label: "Make a plan" },
  { id: "make_technical", label: "Make it technical" },
  { id: "decompose", label: "Decompose strongest" },
  { id: "questions", label: "Surface open questions" },
] as const;
type AllowedOpId = (typeof ALLOWED_OPS)[number]["id"];
const ALLOWED_OP_IDS = new Set<string>(ALLOWED_OPS.map((o) => o.id));

interface OptimizationFactorRanked {
  slug: string;
  label: string;
  kind: string;
  why: string;
  priority: number;
}

/** Read the space's salience annotations as priority-ranked factors. Mirrors
 *  the loader inside deep-synthesize/route.ts but kept inline here so this
 *  route stays self-contained (the shared helper extraction is a follow-up
 *  once a third caller appears). Soft-fail to []. */
async function loadFactors(
  db: SupabaseClient,
  spaceId: string,
): Promise<OptimizationFactorRanked[]> {
  try {
    const { data: space } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = (space?.synthesis_data ?? {}) as Record<string, unknown>;
    const oc = synth.objective_canvas as
      | { prompt_sharpening?: { salience?: { annotations?: unknown } } }
      | undefined;
    const anns = oc?.prompt_sharpening?.salience?.annotations;
    if (!Array.isArray(anns)) return [];
    return anns
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        const phrase = typeof o.phrase === "string" ? o.phrase.trim() : "";
        const slug = typeof o.concept_slug === "string" ? o.concept_slug : "";
        const kind = typeof o.kind === "string" ? o.kind : "concept";
        const why = typeof o.why === "string" ? o.why.trim() : "";
        const lev = typeof o.leverage === "number" ? o.leverage : 0;
        const unc = typeof o.uncertainty === "number" ? o.uncertainty : 0;
        const pri = typeof o.priority === "number" ? o.priority : lev * unc;
        return {
          slug,
          label: phrase.length > 36 ? phrase.slice(0, 35) + "…" : phrase,
          kind,
          why,
          priority: pri,
        };
      })
      .filter((f) => f.slug && f.label)
      .sort((a, b) => b.priority - a.priority);
  } catch {
    return [];
  }
}

interface RecommendationOut {
  op: AllowedOpId;
  label: string;
  /** Why this op is the right next move — surfaced inline on the chip. */
  rationale: string;
  /** Display name of the factor this move advances. Empty when the move is
   *  not factor-specific (e.g. a generic "Decompose strongest"). */
  factorLabel: string;
}

interface RawRecommendation {
  op?: unknown;
  rationale?: unknown;
  factor_slug?: unknown;
}
interface RawResponse {
  primary?: RawRecommendation;
  secondary?: unknown;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId)
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });

  // Ownership check — same explicit user_id pattern the sibling routes use.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: ClusterNextMoveBody;
  try {
    body = (await req.json()) as ClusterNextMoveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind : "synthesis";
  const hubObjectId =
    typeof body.hubObjectId === "string" ? body.hubObjectId : "";
  const branchObjectIds = Array.isArray(body.branchObjectIds)
    ? body.branchObjectIds.filter((s): s is string => typeof s === "string")
    : [];
  const coveredFactorSlugs = new Set(
    Array.isArray(body.factorSlugs)
      ? body.factorSlugs.filter((s): s is string => typeof s === "string")
      : [],
  );

  if (!hubObjectId)
    return NextResponse.json({ primary: null, secondary: [] });

  // ── Read the cluster ─────────────────────────────────────────────
  // Fetch in parallel; per-object soft-fail (null) so a single bad row
  // doesn't blank the whole recommendation. Title/summary/content_snapshot
  // is all the LLM needs — we don't need on_whiteboard / rank_score here.
  const ids = [hubObjectId, ...branchObjectIds];
  const objects = (
    await Promise.all(ids.map((id) => getLibraryObject(auth.supabase, id)))
  ).filter((o): o is LibraryObjectRow => !!o);

  if (objects.length === 0)
    return NextResponse.json({ primary: null, secondary: [] });

  // ── Compose the cluster snapshot the LLM reads ───────────────────
  const clusterLines = objects.map((o) => {
    const snap = (o.content_snapshot ?? {}) as Record<string, unknown>;
    const role = typeof snap.role === "string" ? snap.role : "branch";
    const factor =
      typeof snap.factor_label === "string"
        ? snap.factor_label
        : "—";
    const factorSlug =
      typeof snap.factor_slug === "string" ? snap.factor_slug : "";
    if (factorSlug) coveredFactorSlugs.add(factorSlug);
    return `- [${role}] (factor: ${factor}) ${o.title}${
      o.summary ? ` — ${o.summary.slice(0, 140)}` : ""
    }`;
  });

  // ── Factor gap ───────────────────────────────────────────────────
  // The uncovered top-priority factors are the strongest signal for what the
  // user should diverge into next. If everything top-3 is already covered,
  // the right move is usually to converge / make_plan / make_technical.
  const factors = await loadFactors(auth.supabase, spaceId);
  const uncovered = factors
    .filter((f) => !coveredFactorSlugs.has(f.slug))
    .slice(0, 4);
  const covered = factors.filter((f) => coveredFactorSlugs.has(f.slug)).slice(0, 4);

  const uncoveredBlock =
    uncovered.length > 0
      ? "Uncovered high-priority intake factors (gaps the cluster does NOT yet address — strong DIVERGE candidates):\n" +
        uncovered
          .map(
            (f) =>
              `- [${f.slug}] ${f.label}${f.why ? ` — ${f.why.slice(0, 100)}` : ""}`,
          )
          .join("\n")
      : "Every high-priority intake factor is now covered by the cluster.";
  const coveredBlock =
    covered.length > 0
      ? "Already covered by the cluster (strong CONVERGE / MAKE-IT-CONCRETE candidates):\n" +
        covered.map((f) => `- [${f.slug}] ${f.label}`).join("\n")
      : "";

  const opsBlock = ALLOWED_OPS.map(
    (o) =>
      `- ${o.id}: ${o.label}${OP_HINTS[o.id] ? ` — ${OP_HINTS[o.id]}` : ""}`,
  ).join("\n");

  const system =
    "You recommend the single highest-leverage next operation the user should run on a CLUSTER of generated cards on their strategy whiteboard. " +
    "You read three signals: the cluster contents (titles + roles + factor each card advances), the intake factors the cluster ALREADY covers, and the intake factors that REMAIN UNCOVERED (priority-ranked by leverage × uncertainty). " +
    "Your job: pick the single move that maximally advances the user's intake-defined optimization. " +
    "Heuristics (use as priors, not rules): " +
    "(a) If a top-priority intake factor is uncovered AND the cluster's natural verb is diverge → recommend DIVERGE and name that factor. " +
    "(b) If the top-priority intake factors are now covered AND the cluster has multiple branches → recommend CONVERGE so the user picks. " +
    "(c) If the cluster names a mechanism that's still abstract → recommend MAKE_TECHNICAL on the strongest branch. " +
    "(d) Avoid generic 'iterate further' — every move must reference a specific factor or branch. " +
    "Allowed ops (PICK ONLY FROM THIS LIST — no inventing op ids):\n" +
    opsBlock +
    "\nReturn strict JSON: " +
    '{"primary":{"op":string (one of the ids above),"rationale":string (≤ 22 words, names the specific factor or branch the move advances),"factor_slug":string (the slug from the input lists this advances, "" if none)},"secondary":[{"op":...},{"op":...}] (1-2 runner-up moves, same shape, distinct ops from primary)}';

  const user =
    `Cluster kind: ${kind}\n\n` +
    `Cluster (${objects.length} card${objects.length === 1 ? "" : "s"}):\n${clusterLines.join("\n")}\n\n` +
    `${coveredBlock ? coveredBlock + "\n\n" : ""}${uncoveredBlock}\n\n` +
    "Recommend the single next op per the system instructions. Be specific about the factor or branch.";

  try {
    const raw = await llmJSON<RawResponse>({
      system,
      user,
      // Lightweight + fast — sonnet is plenty for op selection over a tight
      // shortlist; opus would be ~10× the latency for no quality gain here.
      provider: "anthropic",
      temperature: 0.3,
      maxTokens: 500,
      responseSchema: {
        name: "cluster_next_move",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            primary: {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string" },
                rationale: { type: "string" },
                factor_slug: { type: "string" },
              },
              required: ["op", "rationale", "factor_slug"],
            },
            secondary: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  op: { type: "string" },
                  rationale: { type: "string" },
                  factor_slug: { type: "string" },
                },
                required: ["op", "rationale", "factor_slug"],
              },
            },
          },
          required: ["primary", "secondary"],
        },
      },
    });

    const factorBySlug = new Map<string, string>();
    for (const f of factors) factorBySlug.set(f.slug, f.label);

    const normalize = (r: RawRecommendation | undefined): RecommendationOut | null => {
      if (!r) return null;
      const op = typeof r.op === "string" ? r.op : "";
      if (!ALLOWED_OP_IDS.has(op)) return null;
      const meta = ALLOWED_OPS.find((o) => o.id === op);
      if (!meta) return null;
      const rationale =
        typeof r.rationale === "string"
          ? r.rationale.trim().slice(0, 180)
          : "";
      const slug = typeof r.factor_slug === "string" ? r.factor_slug : "";
      return {
        op: meta.id,
        label: meta.label,
        rationale,
        factorLabel: factorBySlug.get(slug) ?? "",
      };
    };

    const primary = normalize(raw?.primary);
    const secondaryIn = Array.isArray(raw?.secondary)
      ? (raw.secondary as RawRecommendation[])
      : [];
    const seen = new Set(primary ? [primary.op] : []);
    const secondary: RecommendationOut[] = [];
    for (const r of secondaryIn) {
      const n = normalize(r);
      if (!n || seen.has(n.op)) continue;
      seen.add(n.op);
      secondary.push(n);
      if (secondary.length >= 2) break;
    }

    return NextResponse.json({ primary, secondary });
  } catch (err) {
    console.warn("[cluster-next-move] generation failed (soft):", err);
    return NextResponse.json({ primary: null, secondary: [] });
  }
}

/** Per-op hints — copy that nudges the LLM toward the right CONTRACT for each
 *  op (so e.g. it doesn't recommend make_technical on a cluster that isn't
 *  yet a mechanism). Short on purpose: long hints become rules the model
 *  follows mechanically, which is what generic recommendations look like. */
const OP_HINTS: Record<AllowedOpId, string> = {
  converge:
    "best when the cluster has multiple branches and at least one top-priority factor is already covered",
  diverge:
    "best when a high-priority factor is uncovered; name that factor in the rationale",
  make_plan:
    "best when the user is ready to commit to a sequence of actions",
  make_technical:
    "best when the strongest branch describes a mechanism that's still abstract",
  decompose:
    "best when the strongest branch is large and would benefit from being broken into parts",
  questions:
    "best when the cluster has open ambiguities the user should clarify before committing",
};
