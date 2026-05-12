// ── GET /api/spaces/[id]/environment ─────────────────────────────────────
//
// Returns the EnvironmentDefinition for the space — the formal MDP
// description (state, action, transition, reward, discount, initial state)
// plus boundary + confidence breakdown + override audit trail.
//
// The returned object is content-addressed by `environment_hash`. Two
// reads producing identical MDPs return identical hashes; predictions
// stamp this hash so the trajectory chart can detect drift.
//
// Query params:
//   - subject (optional): subject_id to anchor the initial state
//     distribution to a specific persona. When omitted, uses the
//     space's default subject.
//   - ignore_overrides (optional, "1"): returns the LLM-derived
//     environment WITHOUT user overrides applied. Used for
//     before/after diffs in the override-review UI.
//
// Auth: standard safeAuth() — RLS handles per-space access control
// since the aggregator only queries tables the user can read.

import { safeAuth } from "@/lib/api-helpers";
import { aggregateEnvironmentDefinition } from "@/lib/environment/aggregate-environment-definition";

export const maxDuration = 15;
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, error: authError } = await safeAuth();
    if (authError) return authError;

    const url = new URL(request.url);
    const subjectParam = url.searchParams.get("subject");
    const ignoreOverridesParam = url.searchParams.get("ignore_overrides");

    const result = await aggregateEnvironmentDefinition(supabase, {
      space_id: id,
      subject_id: subjectParam,
      ignore_overrides: ignoreOverridesParam === "1",
    });

    if (!result.ok) {
      const status =
        result.reason === "space_not_found" ||
        result.reason === "subject_not_in_space"
          ? 404
          : result.reason === "no_kg_generation_plan" ||
              result.reason === "no_entities"
            ? 409 // conflict — preconditions not met
            : 500;
      return Response.json(
        {
          error: result.reason,
          partial: result.partial,
        },
        { status },
      );
    }

    return Response.json(result.environment);
  } catch (err) {
    console.error("[GetEnvironment] Error:", err);
    return Response.json(
      { error: "Failed to load environment" },
      { status: 500 },
    );
  }
}
