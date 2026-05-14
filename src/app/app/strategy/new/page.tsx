// ── /app/strategy/new — generate a strategy from a prompt ──
//
// Auth-gated. The page itself is just a shell; the client component
// owns the prompt input + the multi-stage crystallization UI + the
// final navigation to /app/synergy/[session_id]/strategy.
//
// Phase 1 unified canvas (2026-05): when the dashboard hero passes
// ?mode=<experience_mode>, redirect into /app/whiteboard/new instead
// of running the legacy strategy-from-prompt path. This closes the
// leak where the dashboard pill choice was silently dropped on
// arrival here. Users who reach this page WITHOUT a mode (older
// shared links, direct typing) still see the legacy idle prompt UI.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { isExperienceMode } from "@/types/experience-mode";
import { StrategyNewClient } from "./strategy-new-client";

interface PageProps {
  searchParams: Promise<{
    prompt?: string;
    mode?: string;
    lenses?: string;
    baseline?: string;
    single?: string;
    objective?: string;
  }>;
}

export default async function StrategyNewPage({ searchParams }: PageProps) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const params = await searchParams;

  // Phase 0 leak fix — when the caller supplied an experience mode,
  // forward all the dashboard-supplied params to the unified
  // launcher. The new route handles bootstrap + redirect to the
  // canvas, with mode-aware chrome.
  if (
    isExperienceMode(params.mode) &&
    params.prompt &&
    params.prompt.trim().length >= 4
  ) {
    const fwd = new URLSearchParams();
    fwd.set("prompt", params.prompt);
    fwd.set("mode", params.mode);
    if (params.lenses) fwd.set("lenses", params.lenses);
    if (params.baseline === "1") fwd.set("baseline", "1");
    if (params.single === "1") fwd.set("single", "1");
    if (params.objective) fwd.set("objective", params.objective);
    redirect(`/app/whiteboard/new?${fwd.toString()}`);
  }

  return <StrategyNewClient initialPrompt={params.prompt ?? ""} />;
}
