// ── GET + POST /api/brainstorm/space/constraints ──────────────────
//
// GET   — return the current constraints (auto-infers + persists
//         on first read so downstream prompts always see something).
// POST  — manual override; body = OperationalConstraints fields.
//         Marks source="user" so we don't silently re-infer next call.
//
// Storage: spaces.synthesis_data.constraints (no migration).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import {
  inferConstraints,
  readConstraints,
  type OperationalConstraints,
  type TimeHorizon,
  type BudgetTier,
  type TeamSize,
  type RiskTolerance,
} from "@/lib/objective-canvas/constraints";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 30;

interface PostBody {
  spaceId?: string;
  time_horizon?: TimeHorizon;
  budget_tier?: BudgetTier;
  team_size?: TeamSize;
  risk_tolerance?: RiskTolerance;
  compliance_requirements?: string[];
}

export async function GET(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const spaceId = req.nextUrl.searchParams.get("spaceId") ?? "";
  if (!spaceId) {
    return NextResponse.json(
      { error: "spaceId query param required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const existing = readConstraints(space.synthesis_data);
  if (existing) {
    return NextResponse.json({ constraints: existing, cached: true });
  }

  // Auto-infer on first read.
  const state = readObjectiveCanvasState(space.synthesis_data);
  const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
  if (state.clarifying) {
    for (const q of state.clarifying.questions) {
      const a = state.clarifying.answers[q.id];
      if (a?.status === "answered" && a.value) {
        clarifyingAnswers.push({ question: q.question, answer: a.value });
      }
    }
  }

  const objectiveText =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  let inferred: OperationalConstraints;
  try {
    inferred = await inferConstraints({
      objectiveText,
      clarifyingAnswers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "inference failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Persist inside synthesis_data.constraints so the next read short-
  // circuits. Soft-fail: even if persist fails, we return the result.
  const nextSynth = {
    ...((space.synthesis_data as Record<string, unknown>) ?? {}),
    constraints: inferred,
  };
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[space/constraints GET] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ constraints: inferred });
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const existing = readConstraints(space.synthesis_data) ?? {
    time_horizon: "months" as TimeHorizon,
    budget_tier: "low" as BudgetTier,
    team_size: "solo" as TeamSize,
    risk_tolerance: "calibrated" as RiskTolerance,
    compliance_requirements: [],
    source: "inferred" as const,
    generated_at: new Date().toISOString(),
  };

  // Merge: user-provided fields override; unspecified stay.
  const next: OperationalConstraints = {
    ...existing,
    ...(body?.time_horizon ? { time_horizon: body.time_horizon } : {}),
    ...(body?.budget_tier ? { budget_tier: body.budget_tier } : {}),
    ...(body?.team_size ? { team_size: body.team_size } : {}),
    ...(body?.risk_tolerance ? { risk_tolerance: body.risk_tolerance } : {}),
    ...(Array.isArray(body?.compliance_requirements)
      ? {
          compliance_requirements: body.compliance_requirements
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().slice(0, 80))
            .slice(0, 6),
        }
      : {}),
    source: "user",
    generated_at: new Date().toISOString(),
  };

  const nextSynth = {
    ...((space.synthesis_data as Record<string, unknown>) ?? {}),
    constraints: next,
  };
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // Phase 10a — log space-scoped constraint changes for the Lab Notebook.
  // Short readable summary so the notebook can render at a glance.
  const summaryParts: string[] = [];
  if (next.time_horizon) summaryParts.push(`time=${next.time_horizon}`);
  if (next.budget_tier) summaryParts.push(`budget=${next.budget_tier}`);
  if (next.team_size) summaryParts.push(`team=${next.team_size}`);
  if (next.risk_tolerance) summaryParts.push(`risk=${next.risk_tolerance}`);
  if (next.compliance_requirements && next.compliance_requirements.length > 0) {
    summaryParts.push(`compliance(${next.compliance_requirements.length})`);
  }
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "constraints_set",
    metadata: {
      constraints_summary: summaryParts.join(", "),
      time_horizon: next.time_horizon,
      budget_tier: next.budget_tier,
      team_size: next.team_size,
      risk_tolerance: next.risk_tolerance,
      compliance_count: next.compliance_requirements?.length ?? 0,
    },
  });

  return NextResponse.json({ constraints: next });
}
