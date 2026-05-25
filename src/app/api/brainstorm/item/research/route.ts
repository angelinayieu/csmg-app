// ── POST /api/brainstorm/item/research ────────────────────────────
//
// Per-item Tavily research — the "Inspiration" section of the
// detail drawer. Issues a focused query about THIS specific item
// (not the broader space), distilled into 3-6 sources each tagged
// with a 1-sentence "how this informs" note.
//
// Cached on entities.detail_research. Idempotent unless mode=force.
//
// Body: { entityId, mode?: "default" | "force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { searchTavily } from "@/lib/research/tavily-client";
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
  query: string;
  sources: ItemSource[];
  failed: boolean;
  fetched_at: string;
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

  // Idempotent short-circuit.
  const existing = entity.detail_research as ItemResearchBundle | null;
  const hasCached =
    !!existing &&
    typeof existing === "object" &&
    Array.isArray((existing as { sources?: unknown }).sources) &&
    ((existing as { sources: unknown[] }).sources.length > 0 ||
      (existing as { failed?: unknown }).failed === true);
  if (!force && hasCached) {
    return NextResponse.json({ detail_research: existing, cached: true });
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

  // ── Build the search query ──
  // Item name + sub-objective context as a focused phrase, NOT a
  // question. Tavily is best with declarative phrases.
  const queryParts = [entity.name];
  if (subObjectiveTitle) queryParts.push(subObjectiveTitle);
  queryParts.push("examples patterns case studies");
  const query = queryParts.join(" — ").slice(0, 280);

  // ── Run Tavily ──
  const bundle = await searchTavily(query, {
    depth: "basic",
    maxResults: 6,
    includeAnswer: false,
  });

  if (bundle.failed && bundle.sources.length === 0) {
    const empty: ItemResearchBundle = {
      query,
      sources: [],
      failed: true,
      fetched_at: new Date().toISOString(),
    };
    await db
      .from("entities")
      .update({ detail_research: empty })
      .eq("id", entityId);
    return NextResponse.json({ detail_research: empty });
  }

  // ── LLM pass: tag each source with a 1-sentence "informs" note ──
  // Cheap (~$0.005). Gives the drawer a "why this source matters"
  // line per row instead of just a raw snippet.
  type InformsShape = { informs?: Array<{ index?: unknown; note?: unknown }> };
  let informsByIndex: Record<number, string> = {};
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

    const informsResult = await llmJSON<InformsShape>({
      system: `You annotate web sources with a 1-sentence "how this informs" note that ties each source back to the user's specific item.

For each source given (numbered 1..N), produce ONE sentence (≤120 chars) explaining how the source could inform this item. Be concrete — reference the source's actual content, not generic platitudes. If a source is irrelevant, return an empty string for its note.

Return strict JSON.`,
      user: `ITEM: ${entity.name}${ccBlock}${subObjectiveTitle ? `\n  Within: ${subObjectiveTitle}` : ""}\n\nSOURCES:\n${bundle.sources
        .slice(0, 6)
        .map(
          (s, i) =>
            `${i + 1}. [${s.title.slice(0, 120)}]\n   ${s.content.slice(0, 280)}`,
        )
        .join("\n\n")}\n\nAnnotate each source.`,
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
                  index: { type: "number" },
                  note: { type: "string" },
                },
                required: ["index", "note"],
              },
            },
          },
          required: ["informs"],
        },
      },
      temperature: 0.3,
      maxTokens: 800,
    });
    informsByIndex = {};
    for (const row of informsResult?.informs ?? []) {
      const i =
        typeof row?.index === "number" ? Math.floor(row.index) - 1 : -1;
      const note = typeof row?.note === "string" ? row.note.trim() : "";
      if (i >= 0 && note.length > 0) {
        informsByIndex[i] = note.slice(0, 160);
      }
    }
  } catch (err) {
    console.warn(
      "[item/research] informs LLM pass failed (non-fatal):",
      sanitizeErrorMessage(err),
    );
  }

  // ── Assemble + persist ──
  const sources: ItemSource[] = bundle.sources.slice(0, 6).map((s, i) => ({
    title: s.title,
    url: s.url,
    snippet: s.content.slice(0, 500),
    score: s.score,
    informs: informsByIndex[i] ?? "",
  }));

  const out: ItemResearchBundle = {
    query,
    sources,
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
