// ── POST /api/objective/[spaceId]/deep-synthesize ─────────────────
//
// The "pro Claude" power-move for the objective whiteboard. The user
// multi-selects a mix of post-it notes + free text + cards and presses
// "Deep Synthesize". Opus reads the WHOLE selection, uses web search to
// ground and extend the strongest threads, and returns a small MAP — one
// unifying hub insight + several web-grounded cross-links, each naming the
// exact selected items it draws on. The board forks that into a hub +
// branch cluster of proposed insight cards (see forkSynthesisMap).
//
// Heavier sibling of /connect (gpt-4o, one card, no search). Reuses the
// canonical research path — getAnthropicClient + the native web_search tool
// + the shared response parsers — and the same telemetry wrapper. NOT a
// parallel pipeline; the result lives on the board (snapshot-persisted),
// curated by the human via the hub's Keep/Dismiss.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { getAnthropicClient } from "@/lib/anthropic";
import {
  getResearchTools,
  parseResearchResponse,
  extractJSON,
  repairAndExtractJSON,
} from "@/lib/web-search";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { recordLlmUsage } from "@/lib/llm/usage-meter";
import { upsertLibraryObject } from "@/lib/objective-canvas/library-objects";
import {
  deriveMicroObjectives,
  buildMicroObjectivesArtifact,
  type MicroObjective,
} from "@/lib/objective-canvas/derive-micro-objectives";
import {
  getMicroObjectives,
  cacheMicroObjectives,
} from "@/lib/objective-canvas/get-micro-objectives";
import {
  enrichSelection,
  renderSelectionContext,
  type EnrichedSelectionItem,
} from "@/lib/objective-canvas/load-selection-context";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
// Opus + several web searches runs long; lift the platform timeout where
// the host honors it (the SDK call carries its own 10-min ceiling).
export const maxDuration = 300;

// "Pro Claude" — the codebase's standard Opus id (also used by llm.ts
// MODEL_DEFAULTS.reasoning + expansion-recommendations). Bump to a newer
// Opus here if the key has access.
const OPUS_MODEL = "claude-opus-4-20250514";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface SelectionItem {
  /** Source kind, for the model's context (e.g. "sticky note", "card"). */
  kind?: string;
  text: string;
  /** v2.1 — tldraw shape id, when the client has it. When present, the
   *  route enriches this item with library_objects context (micros, user
   *  notes, attached sources, outbound link graph) and folds it into the
   *  selection block so the synthesizer can reason over the rich card,
   *  not just the headline text. Optional for back-compat. */
  shapeId?: string;
}

interface DeepSynthBody {
  selection?: SelectionItem[];
  objectiveTitle?: string;
  /** v2 frame: the card the synthesis is FRAMED AROUND. When supplied, the
   *  route derives (or reuses cached) micro-objectives for this card and
   *  uses those as the rubric — each branch must advance a named micro,
   *  the hub picks a dominant micro. The intake factors become the
   *  weighting (which micros earn the limited branch slate) rather than
   *  the direct rubric. Optional: when absent, falls back to v1 frame
   *  (factors-as-direct-rubric) so legacy callers keep working. */
  focusCardId?: string;
  focusCardHeadline?: string;
  focusCardBody?: string;
  focusCardRole?: string;
}

interface RawCitation {
  title?: unknown;
  url?: unknown;
}
interface RawBranch {
  headline?: unknown;
  body?: unknown;
  sourceRefs?: unknown;
  citations?: unknown;
  /** Slug of the optimization factor (salience annotation) this branch
   *  advances. "general" means the model couldn't tie it to a specific
   *  factor → rendered as a low-confidence chip. */
  addressesFactor?: unknown;
  /** v2: slug of the focus-card micro-objective this branch advances.
   *  When set, takes priority over `addressesFactor` for the chip and
   *  scoring. The micro's `laddersTo` factors become `inheritsFactors`. */
  addressesMicro?: unknown;
  /** v2: ≤ 12-word first-principle the cross-link mechanism rests on.
   *  Distinct from `body`: the principle is the rule, the body is the
   *  so-what. Shown as a small italic line above the body. Optional —
   *  v1 outputs that pre-date the field render with no principle line. */
  principle?: unknown;
  /** v2: 0..1 model confidence the branch is real, not boilerplate.
   *  Used to score the slate and demote low-confidence branches. */
  confidence?: unknown;
}
interface RawMap {
  hub?: {
    headline?: unknown;
    body?: unknown;
    /** Slug of the factor the synthesized throughline most serves. */
    dominantFactor?: unknown;
    /** v2: slug of the dominant focus-card micro the hub advances. */
    dominantMicro?: unknown;
  };
  branches?: unknown;
}

/** One optimization factor — what the user said matters at intake. Sourced
 *  from prompt_sharpening's salience annotations (pain / goal / constraint /
 *  lever / concept). The synth prompt gets this list and every branch must
 *  name which factor it serves. */
interface OptimizationFactor {
  slug: string;
  /** Short label shown on the card chip (≤ 36 chars). */
  label: string;
  /** pain / goal / constraint / lever / concept — sets the chip color. */
  kind: string;
  /** Why-this-matters from intake — included in the prompt so the model
   *  reasons about coverage, not just keyword match. */
  why: string;
}

const KIND_LABEL: Record<string, string> = {
  note: "sticky note",
  text: "text",
  "artifact-card": "card",
  "room-card": "room",
  "insight-card": "insight",
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Strip Anthropic web_search inline markup from a prose field. Opus with the
 *  web_search tool tends to inline `<cite index="...">…</cite>` markers (and
 *  occasionally bare `<cite_start>` / `<cite_end>`) inside the JSON `body`
 *  field even though the structured citations come back separately on the
 *  message. Drop the markers but keep their inner text — the citation chips
 *  at the bottom of the card carry the real source links. */
function stripCiteMarkup(s: string): string {
  if (!s) return s;
  return s
    // <cite index="…">inner</cite> → inner
    .replace(/<\s*cite\b[^>]*>([\s\S]*?)<\s*\/\s*cite\s*>/gi, "$1")
    // Stray <cite_start> / <cite_end> sentinels (no closing tag)
    .replace(/<\s*\/?\s*cite(?:_start|_end)?\s*[^>]*>/gi, "")
    // Collapse the whitespace left behind by removed markers
    .replace(/\s{2,}/g, " ")
    .trim();
}

function selectionBlock(
  items: SelectionItem[],
  enriched: EnrichedSelectionItem[] | null,
): string {
  return items
    .map((it, i) => {
      const label = it.kind ? `[${KIND_LABEL[it.kind] ?? it.kind}] ` : "";
      const head = `${i + 1}. ${label}${it.text.replace(/\s+/g, " ").trim()}`;
      // v2.1 — append rich context when we resolved the shape to a
      // library_objects row. When `enriched` is null (no shapeIds sent)
      // we degrade to the v2-style flat text block, identical to before.
      const ctx = enriched?.[i] ? renderSelectionContext(enriched[i]) : "";
      return ctx ? `${head}\n${ctx}` : head;
    })
    .join("\n");
}

/** Load the optimization factors for this space — the intake-defined "what
 *  matters" that synthesis should evaluate cross-links against. Reads the
 *  salience annotations from prompt_sharpening, ranks by leverage*uncertainty
 *  (priority), keeps the top 8. Soft-fails to an empty list so the rest of the
 *  route works on legacy spaces that never ran sharpening. */
async function loadOptimizationFactors(
  db: SupabaseClient,
  spaceId: string,
): Promise<OptimizationFactor[]> {
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
    const factors: OptimizationFactor[] = anns
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        const phrase = typeof o.phrase === "string" ? o.phrase.trim() : "";
        const slug = typeof o.concept_slug === "string" ? o.concept_slug : "";
        const kind = typeof o.kind === "string" ? o.kind : "concept";
        const why = typeof o.why === "string" ? o.why.trim() : "";
        const lev = typeof o.leverage === "number" ? o.leverage : 0;
        const unc = typeof o.uncertainty === "number" ? o.uncertainty : 0;
        const pri = typeof o.priority === "number" ? o.priority : lev * unc;
        return { slug, phrase, kind, why, priority: pri };
      })
      .filter((f) => f.slug && f.phrase)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 8)
      .map((f) => ({
        slug: f.slug,
        label: f.phrase.length > 36 ? f.phrase.slice(0, 35) + "…" : f.phrase,
        kind: f.kind,
        why: f.why,
      }));
    return factors;
  } catch {
    return [];
  }
}

function microsBlock(micros: MicroObjective[]): string {
  if (micros.length === 0) return "";
  const lines = micros.map((m) => {
    const signal = m.success_signal ? ` — signal: ${m.success_signal}` : "";
    const ladders = m.laddersTo.length
      ? ` [ladders to: ${m.laddersTo.join(", ")}]`
      : " [tactical-only]";
    return `- [${m.slug}] ${m.label}${signal}${ladders}\n    why: ${m.why}`;
  });
  return (
    "Micro-objectives for the FOCUS CARD — these are THE rubric. Every branch MUST advance one by `slug` (`addressesMicro`). The hub picks the highest-leverage one (`dominantMicro`). A branch that doesn't cleanly advance a micro is noise and must be dropped:\n" +
    lines.join("\n")
  );
}

function factorsBlock(factors: OptimizationFactor[]): string {
  if (factors.length === 0) return "";
  const lines = factors.map(
    (f) =>
      `- [${f.slug}] (${f.kind}) ${f.label}${f.why ? ` — ${f.why}` : ""}`,
  );
  return (
    "Optimization factors — what the user said matters at intake (each branch MUST advance one of these by `slug`; if truly none fits, use \"general\" but only as a last resort):\n" +
    lines.join("\n")
  );
}

/** Coerce the model's JSON into the strict map the board renders. Clamps
 *  sourceRefs to the real selection size and caps branch/citation counts.
 *  `factorSlugs` + `microSlugs` are the allow-lists — any slug not present
 *  is coerced to "general" / "" so a hallucinated slug can't poison the
 *  chip. v2: also extracts `addressesMicro`, `principle`, `confidence`. */
function normalizeMap(
  raw: RawMap,
  selectionCount: number,
  factorSlugs: Set<string>,
  microSlugs: Set<string>,
) {
  const coerceFactor = (v: unknown): string => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return "general";
    return factorSlugs.has(s) ? s : "general";
  };
  /** Empty string for missing/hallucinated micros (the chip then hides
   *  cleanly and the v1 factor chip remains the trace-back). */
  const coerceMicro = (v: unknown): string => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return "";
    return microSlugs.has(s) ? s : "";
  };
  const coerceConfidence = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0.6;
    return Math.max(0, Math.min(1, v));
  };
  const hub = {
    headline: stripCiteMarkup(str(raw.hub?.headline).trim()) || "Synthesis",
    body: stripCiteMarkup(str(raw.hub?.body).trim()),
    dominantFactor: coerceFactor(raw.hub?.dominantFactor),
    dominantMicro: coerceMicro(raw.hub?.dominantMicro),
  };
  const branchesIn = Array.isArray(raw.branches)
    ? (raw.branches as RawBranch[])
    : [];
  const branches = branchesIn
    .map((b) => {
      const refs = Array.isArray(b.sourceRefs)
        ? Array.from(
            new Set(
              b.sourceRefs
                .map((r) => Number(r))
                .filter(
                  (r) => Number.isInteger(r) && r >= 1 && r <= selectionCount,
                ),
            ),
          )
        : [];
      const citationsIn = Array.isArray(b.citations)
        ? (b.citations as RawCitation[])
        : [];
      const citations = citationsIn
        .map((c) => ({ title: str(c.title).trim(), url: str(c.url).trim() }))
        .filter((c) => /^https?:\/\//.test(c.url))
        .slice(0, 3);
      return {
        headline: stripCiteMarkup(str(b.headline).trim()),
        body: stripCiteMarkup(str(b.body).trim()),
        sourceRefs: refs,
        citations,
        addressesFactor: coerceFactor(b.addressesFactor),
        addressesMicro: coerceMicro(b.addressesMicro),
        principle: stripCiteMarkup(str(b.principle).trim()).slice(0, 120),
        confidence: coerceConfidence(b.confidence),
      };
    })
    .filter((b) => b.headline || b.body)
    // v2: drop low-confidence branches (< 0.4) before slicing, so the slate
    // is filled with the most load-bearing links rather than the first 6.
    .filter((b) => b.confidence >= 0.4)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);
  return { hub, branches };
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership — same explicit user_id check the other objective routes use.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: DeepSynthBody;
  try {
    body = (await req.json()) as DeepSynthBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const selection = Array.isArray(body.selection)
    ? body.selection
        .filter(
          (it): it is SelectionItem =>
            !!it && typeof it.text === "string" && it.text.trim().length > 0,
        )
        .slice(0, 24)
    : [];
  if (selection.length < 2) {
    return NextResponse.json(
      { error: "Select at least two items." },
      { status: 400 },
    );
  }

  // v2.1 — enrich each selection item with its library_objects context
  // (micros, user notes, sources, link graph) when the client passed a
  // shapeId for it. The synthesizer reads notes as user CONSTRAINTS
  // (taste / intention) and shared micros + links as structural truth.
  // Soft-fails to nulls; the prompt block degrades to flat text.
  const selectionShapeIds = selection
    .map((it) => (typeof it.shapeId === "string" ? it.shapeId : ""))
    .filter((id): id is string => !!id);
  let enriched: EnrichedSelectionItem[] | null = null;
  if (selectionShapeIds.length > 0) {
    try {
      // We pass the FULL shape-id list (including blanks) so the result
      // array index-aligns with the selection. enrichSelection skips
      // blank ids; we re-zip below.
      const all = selection.map((it) =>
        typeof it.shapeId === "string" ? it.shapeId : "",
      );
      const nonBlank = all.filter(Boolean);
      const lookup = await enrichSelection(auth.supabase, spaceId, nonBlank);
      const byShape = new Map(lookup.map((e) => [e.shapeId, e]));
      enriched = all.map(
        (sid) =>
          byShape.get(sid) ?? {
            shapeId: sid,
            libraryObjectId: null,
            objectType: null,
            micros: [],
            notes: [],
            sources: [],
            links: [],
          },
      );
    } catch (err) {
      console.warn(
        "[deep-synthesize] selection enrichment failed (soft):",
        err,
      );
      enriched = null;
    }
  }

  // Shared context — glossary + resolved intent + the re-framed objective, so
  // synthesis honors the user's vocabulary instead of reasoning from scratch.
  const spaceCtx = await buildSpaceContext(auth.supabase, spaceId);
  // Optimization factors — the intake-defined "what matters" (salience
  // annotations). v1 frame: factors are the direct rubric; v2 frame: factors
  // become the WEIGHTING for the focus-card's micros (which earn the slate).
  const factors = await loadOptimizationFactors(auth.supabase, spaceId);
  const factorSlugs = new Set(factors.map((f) => f.slug));
  const objective = str(body.objectiveTitle).trim() || spaceCtx.objective;

  // ── v2 frame: focus-card micro-objectives as the primary rubric ──
  // When the client supplies a `focusCardId` + inline content, derive (or
  // reuse cached) micro-objectives for that card. Synthesis is then framed
  // AROUND the focus card: every branch must advance one of its micros, the
  // hub picks the dominant micro. The intake factors become the laddering
  // weight rather than the direct rubric — "this micro matters because it
  // ladders into THESE factors." On miss or empty result we silently fall
  // back to the v1 factor-only frame so legacy callers keep working.
  let focusCard: {
    id: string;
    headline: string;
    body: string;
    role?: string;
  } | null = null;
  let micros: MicroObjective[] = [];
  const focusId = str(body.focusCardId).trim();
  const focusH = str(body.focusCardHeadline).trim();
  const focusB = str(body.focusCardBody).trim();
  const focusR = str(body.focusCardRole).trim();
  if (focusId && (focusH || focusB)) {
    focusCard = {
      id: focusId,
      headline: focusH,
      body: focusB,
      role: focusR || undefined,
    };
    try {
      const resolved = await getMicroObjectives(
        auth.supabase,
        spaceId,
        focusCard.id,
        { headline: focusCard.headline, body: focusCard.body },
      );
      if (resolved.artifact) {
        micros = resolved.artifact.micros;
      } else {
        const derived = await deriveMicroObjectives({
          card: focusCard,
          factors: factors.map((f) => ({
            slug: f.slug,
            label: f.label,
            kind: f.kind,
            why: f.why,
          })),
          objective,
        });
        if (derived.length) {
          const artifact = buildMicroObjectivesArtifact({
            cardId: focusCard.id,
            card: focusCard,
            micros: derived,
          });
          // fire-and-forget cache write — the synth call doesn't wait on it.
          void cacheMicroObjectives(
            auth.supabase,
            spaceId,
            focusCard.id,
            artifact,
            resolved.libraryObjectId,
          );
          micros = derived;
        }
      }
    } catch (err) {
      // Micros are the rubric, not the result — never fail the synth call
      // because the deriver was sad. Drop to v1 frame quietly.
      console.warn("[deep-synthesize] micros load failed (soft):", err);
    }
  }
  const microSlugs = new Set(micros.map((m) => m.slug));
  const useMicros = micros.length > 0;

  // System prompt — two frames. v2 is sharper because the rubric is local
  // to the focus card; v1 stays for legacy callers (no focus card supplied).
  const systemV1 =
    "You are a systems strategist AND researcher helping a user find the LOAD-BEARING throughline across items on their strategy whiteboard (sticky notes, free text, and cards). " +
    "Every output you ship is scored against the user's OPTIMIZATION FACTORS — what they said matters at intake. Generic-truth statements are forbidden: a branch that doesn't advance a named factor is noise. " +
    "Do three things: " +
    "(1) For each cross-link, name the SHARPEST first-principle the relation rests on — the mechanism, not a description (e.g. \"shared user-state machine\" not \"both touch the user\"). " +
    "(2) Use the web_search tool to GROUND the strongest threads with current, concrete external evidence (specific examples, data points, prior art, named approaches). Only search when external evidence sharpens or credentialed the link; don't search to pad. " +
    "(3) Pick the SINGLE highest-leverage throughline as the hub, and on the hub name the dominant optimization factor it serves. " +
    "Tight prose rules: every body field is at most ONE sentence, ≤ 22 words, that names the mechanism AND why it advances the named factor. No restatements of the headline. No hedging. " +
    "Return ONLY a JSON object (no prose, no markdown fence) of exactly this shape: " +
    '{"hub":{"headline":string (the single unifying insight, ≤ 6 words),"body":string (1 sentence ≤ 22 words: the mechanism + the so-what for the dominant factor),"dominantFactor":string (the slug of the factor this throughline most advances)},' +
    '"branches":[{"headline":string (the relation as a first-principle, ≤ 8 words),"body":string (1 sentence ≤ 22 words: mechanism + factor served),"sourceRefs":number[] (the 1-based numbers of the selected items this draws on),"addressesFactor":string (the slug of the factor this branch advances),"principle":string (≤ 12 words: the mechanism the link rests on),"confidence":number (0..1 your honest take that this is real, not boilerplate),"citations":[{"title":string,"url":string}] (0-2 web sources you ACTUALLY used; omit if none)}]}. ' +
    "Produce 3-6 branches. Every branch must reference at least one source by its number AND name a factor slug from the provided list (use \"general\" ONLY when truly none fits). Drop a branch entirely rather than ship one that's just a true generality.";

  const systemV2 =
    "You are a systems strategist AND researcher. The user has picked a FOCUS CARD on their strategy whiteboard and a set of other items to synthesize AROUND it. The card's MICRO-OBJECTIVES (concrete success conditions for THIS card) are your rubric. " +
    "Every cross-link you ship must advance ONE micro by its slug (`addressesMicro`). Branches that don't cleanly serve a micro are noise — drop them rather than pad. The micros are ranked implicitly by which intake-level optimization factors they ladder into; a branch advancing a micro that ladders into multiple factors is more valuable than one tied to a tactical-only micro. " +
    "Do four things: " +
    "(1) For each cross-link, name the SHARPEST first-principle the relation rests on (the `principle` field — the mechanism, not a description; e.g. \"shared user-state machine\" not \"both touch the user\"). " +
    "(2) Use the web_search tool to GROUND the strongest threads with current, concrete external evidence (specific examples, data points, prior art, named approaches). Only search when external evidence sharpens the link; don't search to pad. " +
    "(3) Pick the SINGLE highest-leverage throughline as the hub, and on the hub set `dominantMicro` to the slug of the most load-bearing micro the throughline advances. Also set `dominantFactor` to the factor that micro best ladders into. " +
    "(4) Give each branch a `confidence` 0..1 — your honest read that the link is real for THIS focus card, not boilerplate. Be willing to score yourself harshly; a 0.5 you can defend beats a 0.9 you can't. " +
    "Tight prose rules: every body field is at most ONE sentence, ≤ 22 words, that names the mechanism AND why it advances the named micro. No restatements of the headline. No hedging. The principle field is ≤ 12 words and IS the mechanism (no \"this means\" wrappers). " +
    "Return ONLY a JSON object (no prose, no markdown fence) of exactly this shape: " +
    '{"hub":{"headline":string (≤ 6 words),"body":string (1 sentence ≤ 22 words: mechanism + so-what for the dominant micro),"dominantMicro":string (a micro slug from the provided list),"dominantFactor":string (a factor slug the micro ladders into)},' +
    '"branches":[{"headline":string (≤ 8 words first-principle),"body":string (1 sentence ≤ 22 words),"sourceRefs":number[] (1-based selection indices),"addressesMicro":string (REQUIRED — micro slug),"addressesFactor":string (the factor that micro most ladders into),"principle":string (≤ 12 words mechanism),"confidence":number (0..1),"citations":[{"title":string,"url":string}] (0-2 web sources; omit if none)}]}. ' +
    "Produce 3-6 branches. Drop, don't ship, any branch that can't cleanly name a micro from the list.";

  const system = useMicros ? systemV2 : systemV1;

  const factorsText = factorsBlock(factors);
  const microsText = useMicros ? microsBlock(micros) : "";
  const focusBlock =
    useMicros && focusCard
      ? `FOCUS CARD (synthesis is framed AROUND this card):\n  Headline: ${focusCard.headline || "(none)"}\n  Body: ${focusCard.body || "(none)"}\n  Role: ${focusCard.role || "card"}\n\n`
      : "";
  const user =
    (spaceCtx.preamble ? `${spaceCtx.preamble}\n\n---\n\n` : "") +
    (objective ? `Objective: ${objective}\n\n` : "") +
    focusBlock +
    (microsText ? `${microsText}\n\n` : "") +
    (factorsText ? `${factorsText}\n\n` : "") +
    `The user selected these items from their strategy whiteboard. Each card-typed item may carry RICH CONTEXT — its derived micros, user-authored notes (idea / intention / taste), attached source titles, and outbound link graph (depends_on / feeds / derived_from). Treat user notes as user CONSTRAINTS not inspiration; treat shared micros + the link graph as structural truth that branches must respect:\n\n${selectionBlock(
      selection,
      enriched,
    )}\n\n` +
    (useMicros
      ? "Find the load-bearing cross-links that advance the focus card's micro-objectives, ground the strongest threads with web search, and return the JSON map."
      : "Find the load-bearing cross-links across them, ground the strongest threads with web search, and return the JSON map.");

  const anthropic = getAnthropicClient();
  const tools = getResearchTools("standard", 8);

  try {
    // Charge a flat credit for the synthesis + meter its Opus token cost.
    // Empty result → throw → reservation cancelled (no charge for nothing).
    const out = await withCharge(
      {
        db: auth.supabase,
        userId: auth.user.id,
        operation: "deep_synthesize",
        spaceId,
      },
      async () => {
    const { map, searchesPerformed } = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:deep_synthesize",
        modelHint: OPUS_MODEL,
        metadata: { sourceCount: selection.length },
      },
      async () => {
        const stream = anthropic.messages.stream(
          {
            model: OPUS_MODEL,
            max_tokens: 8000,
            tools,
            system,
            messages: [{ role: "user", content: user }],
          },
          { timeout: 10 * 60 * 1000 },
        );
        const final = await stream.finalMessage();
        // This route calls the Anthropic SDK directly (web_search streaming),
        // bypassing llm.ts — so meter its tokens here. The active withCharge
        // metering context records it into llm_call_log.
        recordLlmUsage(OPUS_MODEL, "anthropic", final.usage);
        const parsed = parseResearchResponse(final.content);
        let rawMap: RawMap;
        try {
          rawMap = extractJSON<RawMap>(parsed.jsonOutput);
        } catch {
          // Opus + long search results occasionally hit max_tokens mid-JSON.
          rawMap = repairAndExtractJSON<RawMap>(parsed.jsonOutput);
        }
        return {
          map: normalizeMap(rawMap, selection.length, factorSlugs, microSlugs),
          searchesPerformed: parsed.searchesPerformed,
        };
      },
    );

    if (!map.branches.length) {
      // No usable output — throw so withCharge cancels the reservation.
      throw new Error("EMPTY_SYNTHESIS");
    }

    // Build a lightweight factor index keyed by slug so the client can look
    // up the label/kind for a chip without re-deriving it from prompt_sharpening.
    // "general" is included as a passthrough — branches that couldn't be tied
    // to a named factor render with this label + a low-confidence treatment.
    const factorIndex: Record<string, { label: string; kind: string }> = {
      general: { label: "General", kind: "concept" },
    };
    for (const f of factors)
      factorIndex[f.slug] = { label: f.label, kind: f.kind };

    // v2: parallel index for micro-objectives so the client renders the
    // primary chip ("Signal density") without re-fetching the focus card's
    // rubric. `laddersTo` is carried so the small ghost subchip ("→ retention")
    // can render the inherited factor without another lookup.
    const microIndex: Record<
      string,
      { label: string; laddersTo: string[]; confidence: number }
    > = {};
    for (const m of micros)
      microIndex[m.slug] = {
        label: m.label,
        laddersTo: m.laddersTo,
        confidence: m.confidence,
      };

    // ── Promote the synth map into the object layer ──
    // Hub + each branch land as `library_objects` rows so the cards become
    // addressable (click → object-detail-drawer), categorized (subsystem =
    // micro label when present, else factor label so the Library groups
    // sensibly), and reachable by every downstream surface that reads
    // library_objects. Soft-fail: a write failure returns null for that id;
    // the shape just stays an orphan, the chip + body still render. Run id
    // ties the cluster together; per-card source_ref keeps re-runs idempotent
    // on the natural key.
    const runId = randomUUID();
    const hubFactorLabel =
      factorIndex[map.hub.dominantFactor || "general"]?.label || "Synthesis";
    const hubMicroLabel = map.hub.dominantMicro
      ? microIndex[map.hub.dominantMicro]?.label || ""
      : "";
    const hubSubsystem = hubMicroLabel || hubFactorLabel;
    const hubObjectId = await upsertLibraryObject(auth.supabase, {
      spaceId,
      userId: auth.user.id,
      objectType: "insight",
      title: map.hub.headline,
      summary: map.hub.body,
      sourceRef: `synthesis:${runId}:hub`,
      subsystem: hubSubsystem,
      contentSnapshot: {
        role: "hub",
        kind: "synthesize",
        factor_slug: map.hub.dominantFactor,
        factor_label: hubFactorLabel,
        micro_slug: map.hub.dominantMicro || null,
        micro_label: hubMicroLabel || null,
        ladders_to: map.hub.dominantMicro
          ? microIndex[map.hub.dominantMicro]?.laddersTo || []
          : [],
        focus_card_id: focusCard?.id ?? null,
        run_id: runId,
        searches_performed: searchesPerformed,
      },
    });

    const branchObjectIds: (string | null)[] = await Promise.all(
      map.branches.map(async (b, i) => {
        const fLabel = factorIndex[b.addressesFactor || "general"]?.label || "Synthesis";
        const mLabel = b.addressesMicro
          ? microIndex[b.addressesMicro]?.label || ""
          : "";
        const laddersTo = b.addressesMicro
          ? microIndex[b.addressesMicro]?.laddersTo || []
          : [];
        return upsertLibraryObject(auth.supabase, {
          spaceId,
          userId: auth.user.id,
          objectType: "insight",
          title: b.headline,
          summary: b.body,
          sourceRef: `synthesis:${runId}:${i}`,
          subsystem: mLabel || fLabel,
          contentSnapshot: {
            role: "branch",
            kind: "synthesize",
            factor_slug: b.addressesFactor,
            factor_label: fLabel,
            micro_slug: b.addressesMicro || null,
            micro_label: mLabel || null,
            ladders_to: laddersTo,
            principle: b.principle || null,
            confidence: b.confidence,
            focus_card_id: focusCard?.id ?? null,
            run_id: runId,
            citations: b.citations,
            source_refs: b.sourceRefs,
          },
        });
      }),
    );

    return {
      hub: map.hub,
      branches: map.branches,
      factorIndex,
      microIndex,
      focusCardId: focusCard?.id ?? null,
      objectIds: { hub: hubObjectId, branches: branchObjectIds },
      searchesPerformed,
    };
      },
    );

    return NextResponse.json(out);
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    if (err instanceof Error && err.message === "EMPTY_SYNTHESIS") {
      return NextResponse.json(
        { error: "No synthesis produced." },
        { status: 502 },
      );
    }
    console.error("[objective/deep-synthesize] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
