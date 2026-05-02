// ── /api/spaces/[id]/final-plan-flowchart ───────────────────────────
//
// POST → take the cached execution-brief from a final-plan-card and
//        return a normalized list of steps that the canvas paints
//        as connected sticky-note + arrow shapes.
//
// We deliberately accept the briefJson from the client (the card has
// it in props anyway) instead of re-fetching server-side. That keeps
// the endpoint fast and lets the user iterate on the canvas-rendered
// flowchart without a full re-fetch every time. If the brief was
// dropped from props (e.g., regen failure), the route returns an
// empty steps array and the caller can re-trigger the brief
// generator.
//
// Future expansion: synthesize transition labels per arrow ("if X
// then Y"), branch arrows for parallel steps, etc. For v1, a
// deterministic linear chain — order index → sticky → arrow → next.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import type { ExecutionBrief, ExecutionStep } from "@/types/execution-brief";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface IncomingBody {
  recommendationId?: string;
  briefJson?: string;
}

interface FlowchartStep {
  order: number;
  title: string;
  detail: string;
  estimatedEffort: string | null;
  infrastructureNote: string | null;
  dependsOn: number[];
}

const MAX_STEPS = 16;

export async function POST(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<IncomingBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  if (!body.briefJson || typeof body.briefJson !== "string") {
    return NextResponse.json(
      { error: "briefJson is required" },
      { status: 400 },
    );
  }

  let brief: ExecutionBrief;
  try {
    brief = JSON.parse(body.briefJson) as ExecutionBrief;
  } catch {
    return NextResponse.json(
      { error: "briefJson is not valid JSON" },
      { status: 400 },
    );
  }

  const rawSteps: ExecutionStep[] = Array.isArray(brief.execution_steps)
    ? brief.execution_steps
    : [];

  // Sort by `order` (defensive — JSON serialization may not preserve
  // declaration order in all cases) and cap at MAX_STEPS.
  const sorted = [...rawSteps]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, MAX_STEPS);

  const projected: FlowchartStep[] = sorted.map((step, idx) => ({
    order: typeof step.order === "number" ? step.order : idx + 1,
    title: (step.action ?? "").slice(0, 120) || `Step ${idx + 1}`,
    detail: (step.detail ?? "").slice(0, 320),
    estimatedEffort: step.estimated_effort ?? null,
    infrastructureNote: step.infrastructure_note ?? null,
    dependsOn: Array.isArray(step.depends_on) ? step.depends_on : [],
  }));

  return NextResponse.json({
    recommendationId: body.recommendationId ?? null,
    steps: projected,
    count: projected.length,
  });
}
