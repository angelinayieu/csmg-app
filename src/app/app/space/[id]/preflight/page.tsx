// ── /app/space/[id]/preflight ────────────────────────────────────────
//
// The scientist's contract page. Renders the full PreflightView before
// downstream pipeline generation runs. Server component — fetches the
// PreflightView via the aggregator, hands it to the client shell which
// owns interactivity (edits, toggles, approval actions).
//
// Mirrors the pattern of /app/space/[id]/environment which was built
// in the EnvironmentDefinition track. Routes coexist:
//
//   /preflight     — scientist-first vocabulary, steering surface (this)
//   /environment   — RL/MDP audit, deep dive
//
// Both render against the same underlying data (entities, edges, goals,
// conditions, kg_generation_plan, environment_overrides). Edits in
// either page write to environment_overrides and propagate to both.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadPreflightView } from "@/lib/preflight/load-preflight";
import { PreflightPageClient } from "@/components/preflight/preflight-page-client";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ subject?: string }>;
}

export const dynamic = "force-dynamic";

export default async function PreflightPage({ params, searchParams }: PageProps) {
  const { id: spaceId } = await params;
  const { subject } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const result = await loadPreflightView({
    db: supabase,
    space_id: spaceId,
    subject_id: subject ?? null,
    user_id: user.id,
    include_mediator_preview: true,
  });

  if (!result.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <h1 className="text-lg font-bold text-red-900">
            {result.reason === "space_not_found" || result.reason === "not_authorized"
              ? "Space not found"
              : "Failed to load preflight"}
          </h1>
          {result.detail && (
            <p className="mt-2 text-xs text-red-700">{result.detail}</p>
          )}
        </div>
      </div>
    );
  }

  return <PreflightPageClient initial={result.preflight} spaceId={spaceId} />;
}
