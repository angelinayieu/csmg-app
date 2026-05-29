// ── POST /api/brainstorm/item/research ────────────────────────────
//
// Per-item Tavily research — the "Inspiration" section of the
// detail drawer. Issues TWO focused queries (technical precedents +
// UI/design references) about THIS specific item and returns them
// as two rails. Each source carries a 1-sentence "how this informs"
// note from a single LLM tagging pass.
//
// Cached on entities.detail_research. Idempotent unless mode=force.
// Backward-compatible: old flat-`sources` rows are normalized to
// { technical: <old sources>, design: [] } on read.
//
// Reference: MECHANISM_EXPERIENCE_SPEC.md §4b.
//
// Body: { entityId, mode?: "default" | "force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { searchTavilyTechnicalAndDesign } from "@/lib/research/typed-search";
import { llmJSON } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  entityId?: string;
  mode?: "default" | "force";
}

export interface ItemSource {
  title: string;
  url: string;
  snippet: string;
  score: number;
  /** 1-sentence LLM note tying the source back to this item. */
  informs: string;
}

export interface ItemResearchBundle {
  /** Both verbatim queries kept for audit + debug. */
  query: { technical: string; design: string };
  /** Precedents / case studies / papers — github, arxiv, ncbi, etc. */
  technical: ItemSource[];
  /** UI patterns / interaction references — mobbin, dribbble, etc. */
  design: ItemSource[];
  failed: boolean;
  fetched_at: string;
}

/**
 * Read either the new shaped row or a legacy flat-sources row and
 * return the canonical shape. Old rows keep working until the entity
 * is re-fetched (mode=force) and re-shaped.
 */
function normalizeStoredBundle(
  raw: unknown,
): ItemResearchBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // New shape — has at least one of the typed rails.
  if (Array.isArray(obj.technical) || Array.isArray(obj.design)) {
    const queryObj =
      obj.query && typeof obj.query === "object"
        ? (obj.query as Record<string, unknown>)
        : {};
    return {
      query: {
        technical:
          typeof queryObj.technical === "string" ? queryObj.technical : "",
        design: typeof queryObj.design === "string" ? queryObj.design : "",
      },
      technical: Array.isArray(obj.technical)
        ? (obj.technical as ItemSource[])
        : [],
      design: Array.isArray(obj.design) ? (obj.design as ItemSource[]) : [],
      failed: obj.failed === true,
      fetched_at:
        typeof obj.fetched_at === "string"
          ? obj.fetched_at
          : new Date().toISOString(),
    };
  }

  // Legacy flat shape — promote `sources` into the technical rail.
  if (Array.isArray(obj.sources)) {
    return {
      query: {
        technical: typeof obj.query === "string" ? obj.query : "",
        design: "",
      },
      technical: obj.sources as ItemSource[],
      design: [],
      failed: obj.failed === true,
      fetched_at:
        typeof obj.fetched_at === "string"
          ? obj.fetched_at
          : new Date().toISOString(),
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity, error: entityErr } = await db
    .from("entities")
    .select(
      "id, name, description, layer_ontology_id, parent_sub_objective_id, causal_chain, detail_research, space_id",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (entityErr) {
    return NextResponse.json(
      { error: "DB error", detail: entityErr.message },
      { status: 500 },
    );
  }
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  // Verify ownership through the space.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Idempotent short-circuit ──
  // Cache hit when the row has ANY content in either rail OR is an
  // explicit failure marker. Backward-compat for legacy flat rows
  // happens inside `normalizeStoredBundle`.
  const cached = normalizeStoredBundle(entity.detail_research);
  const hasCached =
    !!cached &&
    (cached.failed ||
      cached.technical.length > 0 ||
      cached.design.length > 0);
  if (!force && hasCached) {
    return NextResponse.json({ detail_research: cached, cached: true });
  }

  // ── Resolve sub-objective title for query specificity ──
  let subObjectiveTitle = "";
  if (entity.parent_sub_objective_id) {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    if (sub?.title) subObjectiveTitle = sub.title;
  }

  // ── Build the two queries ──
  // Same item + sub-objective context, two intents.
  //   Technical: case studies, precedents, papers (engineering).
  //   Design:    UI patterns, interaction references (experience).
  // Tavily likes declarative phrases; keep ≤280 chars.
  const stem = [entity.name, subObjectiveTitle]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" — ");
  const technicalQuery = `${stem} — case studies precedents implementation`.slice(
    0,
    280,
  );
  const designQuery = `${stem} — UI design patterns interaction reference`.slice(
    0,
    280,
  );

  // ── Run both rails in parallel ──
  const { technical: techBundle, design: designBundle } =
    await searchTavilyTechnicalAndDesign({
      technicalQuery,
      designQuery,
      maxResultsPerRail: 6,
      depth: "basic",
    });

  const bothEmpty =
    techBundle.failed &&
    designBundle.failed &&
    techBundle.sources.length === 0 &&
    designBundle.sources.length === 0;

  if (bothEmpty) {
    const empty: ItemResearchBundle = {
      query: { technical: technicalQuery, design: designQuery },
      technical: [],
      design: [],
      failed: true,
      fetched_at: new Date().toISOString(),
    };
    await db
      .from("entities")
      .update({ detail_research: empty })
      .eq("id", entityId);
    return NextResponse.json({ detail_research: empty });
  }

  // ── LLM pass: tag every source with a 1-sentence "informs" note ──
  // ONE call across both rails to keep cost flat (~$0.005). The LLM
  // sees per-source category labels and returns notes keyed by
  // composite ID (e.g. "T2", "D1"); we split back by prefix.
  const techRaw = techBundle.sources.slice(0, 6);
  const designRaw = designBundle.sources.slice(0, 6);

  type InformsRow = { key?: unknown; note?: unknown };
  type InformsShape = { informs?: InformsRow[] };
  const informsByKey: Record<string, string> = {};

  if (techRaw.length + designRaw.length > 0) {
    try {
      const cc = entity.causal_chain ?? {};
      const ccBlock =
        typeof (cc as { negative_outcome?: unknown }).negative_outcome === "string"
          ? `\n  Context: ${(cc as { negative_outcome: string }).negative_outcome}`
          : typeof (cc as { positive_outcome?: unknown }).positive_outcome === "string"
            ? `\n  Context: ${(cc as { positive_outcome: string }).positive_outcome}`
            : typeof (cc as { measured_by?: unknown }).measured_by === "string"
              ? `\n  Measurement: ${(cc as { measured_by: string }).measured_by}`
              : "";

      const renderBucket = (
        sources: typeof techRaw,
        prefix: "T" | "D",
        label: string,
      ): string => {
        if (sources.length === 0) return `(no ${label} sources)`;
        return sources
          .map(
            (s, i) =>
              `${prefix}${i + 1}. [${s.title.slice(0, 120)}]\n   ${s.content.slice(0, 280)}`,
          )
          .join("\n\n");
      };

      const informsResult = await llmJSON<InformsShape>({
        system: `You annotate web sources with a 1-sentence "how this informs" note that ties each source back to the user's specific item.

There are TWO buckets:
  • TECHNICAL — precedents, case studies, papers, implementations.
    Each source ID starts with "T" (T1, T2, …). The note should
    explain what the source teaches about HOW to build / measure /
    validate this item.
  • DESIGN — UI patterns, interaction references, visual examples.
    Each source ID starts with "D" (D1, D2, …). The note should
    explain what the source teaches about how the user EXPERIENCES
    something like this item (layout, flow, affordance).

For each source, produce ONE sentence (≤120 chars) keyed by its
composite ID (e.g. "T2", "D1"). Reference the source's actual
content — no generic platitudes. If a source is irrelevant, return
an empty string for its note.

Return strict JSON.`,
        user: `ITEM: ${entity.name}${ccBlock}${subObjectiveTitle ? `\n  Within: ${subObjectiveTitle}` : ""}\n\nTECHNICAL SOURCES:\n${renderBucket(techRaw, "T", "technical")}\n\nDESIGN SOURCES:\n${renderBucket(designRaw, "D", "design")}\n\nAnnotate each source by its composite ID.`,
        responseSchema: {
          name: "item_research_informs",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              informs: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    key: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["key", "note"],
                },
              },
            },
            required: ["informs"],
          },
        },
        temperature: 0.3,
        maxTokens: 1200,
      });
      for (const row of informsResult?.informs ?? []) {
        const key =
          typeof row?.key === "string" ? row.key.trim().toUpperCase() : "";
        const note = typeof row?.note === "string" ? row.note.trim() : "";
        if (key.length > 0 && note.length > 0) {
          informsByKey[key] = note.slice(0, 160);
        }
      }
    } catch (err) {
      console.warn(
        "[item/research] informs LLM pass failed (non-fatal):",
        sanitizeErrorMessage(err),
      );
    }
  }

  // ── Assemble + persist ──
  const toItemSource = (
    s: { title: string; url: string; content: string; score: number },
    informs: string,
  ): ItemSource => ({
    title: s.title,
    url: s.url,
    snippet: s.content.slice(0, 500),
    score: s.score,
    informs,
  });

  const technical: ItemSource[] = techRaw.map((s, i) =>
    toItemSource(s, informsByKey[`T${i + 1}`] ?? ""),
  );
  const design: ItemSource[] = designRaw.map((s, i) =>
    toItemSource(s, informsByKey[`D${i + 1}`] ?? ""),
  );

  const out: ItemResearchBundle = {
    query: { technical: technicalQuery, design: designQuery },
    technical,
    design,
    failed: false,
    fetched_at: new Date().toISOString(),
  };

  const writeRes = await db
    .from("entities")
    .update({ detail_research: out })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/research] failed to persist bundle:",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ detail_research: out });
}
