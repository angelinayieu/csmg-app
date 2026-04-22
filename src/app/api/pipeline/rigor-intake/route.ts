import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { runRigorIntake } from "@/lib/pipeline/rigor-intake-engine";

export const maxDuration = 90;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    spaceId,
    text,
    objective,
    tier = "comprehensive",
    persistProposals = true,
  } = (body ?? {}) as {
    spaceId?: string;
    text?: string;
    objective?: string;
    tier?: "deep" | "comprehensive";
    persistProposals?: boolean;
  };

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Pull space input as fallback text source
    const { data: space } = await db
      .from("spaces")
      .select("input_text, synthesis_data")
      .eq("id", spaceId)
      .single();

    const inputText = (typeof text === "string" && text.trim().length > 0)
      ? text.trim()
      : String(space?.input_text ?? "").trim();

    if (!inputText) {
      return NextResponse.json({ error: "text required (or space must have input_text)" }, { status: 400 });
    }

    const startedAt = new Date().toISOString();

    // Best-effort run row (requires migration); do not fail if table absent.
    let rigorRunId: string | null = null;
    try {
      const { data: runRow } = await db
        .from("rigor_runs")
        .insert({
          space_id: spaceId,
          user_id: user.id,
          tier,
          status: "running",
          started_at: startedAt,
        })
        .select("id")
        .single();
      rigorRunId = runRow?.id ?? null;
    } catch {
      // table may not be migrated yet
    }

    const output = await runRigorIntake({
      text: inputText,
      objective,
      tier,
    });

    // Persist summary into synthesis_data so downstream routes can consume now.
    const currentSynth = (space?.synthesis_data ?? {}) as Record<string, unknown>;
    const completedAt = new Date().toISOString();
    const rigorBlob = {
      generated_at: completedAt,
      generated_by: "pipeline:rigor-intake",
      tier,
      score: output.rigor_score,
      landscape_coverage: output.landscape_coverage,
      claims: output.claims,
      proposals: output.proposals,
      summary: output.summary,
      run_id: rigorRunId,
    };

    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...currentSynth,
          rigor_intake: rigorBlob,
        },
        updated_at: completedAt,
      })
      .eq("id", spaceId);

    // Best-effort persist claims + proposals to new tables when available.
    try {
      if (output.claims.length > 0) {
        const claimRows = output.claims.map((c) => ({
          space_id: spaceId,
          claim_text: c.claim_text,
          claim_type: c.claim_type,
          confidence: c.confidence,
          status: "candidate",
          source_type: "agent",
          source_quote: "[rigor-intake]",
        }));
        await db.from("claims").insert(claimRows);
      }
    } catch {
      // non-fatal
    }

    try {
      if (persistProposals && output.proposals.length > 0) {
        const rows = output.proposals.map((p) => ({
          space_id: spaceId,
          rigor_run_id: rigorRunId,
          title: p.title,
          method: p.method,
          required_tools: p.required_tools,
          predicted_effect: p.predicted_effect,
          rank_score: p.rank_score,
          approval_status: "proposed",
        }));
        await db.from("experiment_specs").insert(rows);
      }
    } catch {
      // non-fatal
    }

    // Complete rigor run row when table exists
    if (rigorRunId) {
      try {
        await db
          .from("rigor_runs")
          .update({
            status: "completed",
            rigor_score: output.rigor_score,
            landscape_coverage: output.landscape_coverage,
            summary: output.summary,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", rigorRunId);
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({
      success: true,
      spaceId,
      rigorRunId,
      rigor: rigorBlob,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Rigor intake failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
