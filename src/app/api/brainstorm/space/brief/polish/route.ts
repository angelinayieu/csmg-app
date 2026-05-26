// ── POST /api/brainstorm/space/brief/polish ───────────────────────
//
// One optional LLM pass that writes a 2-3 sentence executive
// summary at the top of the strategy brief. Cached under
// spaces.synthesis_data.strategy_brief_polish (no migration).
//
// The brief works perfectly without polish — this just adds the
// prose layer that makes it feel like a co-founder wrote it instead
// of compiled it.
//
// Body: { spaceId, mode?: "default" | "force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";
import { buildStrategyBrief } from "@/lib/objective-canvas/build-strategy-brief";
import { buildConstraintsBlock } from "@/lib/objective-canvas/constraints";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  spaceId?: string;
  mode?: "default" | "force";
}

interface CachedPolish {
  state_hash: string;
  tldr: string;
  generated_at: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership check.
  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let loaded;
  try {
    loaded = await loadCrossRoomState({
      db,
      spaceId,
      userId: auth.user.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "load failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Cache short-circuit: same state hash + not forced → return cached.
  const cachedPolish: CachedPolish | null =
    (loaded.synthesisData?.strategy_brief_polish as
      | CachedPolish
      | null
      | undefined) ?? null;
  if (
    !force &&
    cachedPolish &&
    cachedPolish.state_hash === loaded.state_hash
  ) {
    return NextResponse.json({ tldr: cachedPolish.tldr, cached: true });
  }

  const cachedAnalysis: CrossRoomAnalysisState | null =
    (loaded.synthesisData?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  const brief = buildStrategyBrief({
    state: loaded.state,
    analysis: cachedAnalysis,
    cachedTldr: null,
  });

  if (brief.totals.rooms === 0) {
    return NextResponse.json(
      { error: "no rooms yet — polish only meaningful with state to read" },
      { status: 409 },
    );
  }

  // ── Compact serialization of the brief for the LLM ──
  // We don't pass the full structure — just enough for the model to
  // write a unifying executive summary. Restraint: the prose should
  // sound like the user's strategy, not the system's recap.
  const themeLines = brief.themes
    .slice(0, 5)
    .map((t) => `  • ${t.name}: ${t.description.slice(0, 140)}`)
    .join("\n");
  const roomLines = brief.rooms
    .map((r) => {
      const electedNames = r.elected_variations
        .map((v) => v.variation_name)
        .slice(0, 4)
        .join(" / ");
      const conflicts = r.composed_designs.flatMap(
        (cd) => cd.conflicts_open,
      ).length;
      return `  • ${r.title}${r.top_negative_outcome ? ` — counters "${r.top_negative_outcome.slice(0, 80)}"` : ""}${electedNames ? `\n    elected: ${electedNames}` : ""}${conflicts > 0 ? `\n    open conflicts: ${conflicts}` : ""}`;
    })
    .join("\n");
  const constraintsBlock = buildConstraintsBlock(brief.constraints);

  const system = `You write a 2-3 sentence executive summary for a strategy brief.

This summary opens the document. It must:
  • Name the SHAPE of the strategy in one move — what kind of approach the user has converged on.
  • Reference the load-bearing tradeoff or theme — what the user is BUYING by going this direction and what they're GIVING UP.
  • End with the immediate test or next decision — what comes next.

DO NOT:
  • Recap the objective text (the reader already saw it).
  • List rooms or sub-objectives — that's the brief's job below.
  • Be vague ("an approach that balances X and Y" — banned).
  • Exceed 3 sentences.

Voice: confident, plainspoken, no hedges. Read like a co-founder summarizing the strategy in a slack message, not a consulting report.

Return strict JSON.`;

  const user = `OBJECTIVE:\n"""\n${brief.objective_text.slice(0, 800)}\n"""${constraintsBlock}\n\nSTRATEGIC THREADS:\n${themeLines || "  (none yet)"}\n\nROOMS:\n${roomLines}\n\nWrite the 2-3 sentence executive summary per the system instructions.`;

  let tldr: string;
  try {
    const raw = await llmJSON<{ tldr?: unknown }>({
      system,
      user,
      responseSchema: {
        name: "brief_tldr",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tldr: { type: "string" },
          },
          required: ["tldr"],
        },
      },
      temperature: 0.5,
      maxTokens: 320,
    });
    tldr = typeof raw?.tldr === "string" ? raw.tldr.trim().slice(0, 800) : "";
  } catch (err) {
    return NextResponse.json(
      { error: "polish failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  if (!tldr) {
    return NextResponse.json({ error: "empty polish output" }, { status: 500 });
  }

  // Persist.
  const next: CachedPolish = {
    state_hash: loaded.state_hash,
    tldr,
    generated_at: new Date().toISOString(),
  };
  const nextSynth = {
    ...((loaded.synthesisData as Record<string, unknown>) ?? {}),
    strategy_brief_polish: next,
  };
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[brief/polish] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ tldr });
}
