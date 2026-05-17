// ── /app/whiteboard/new — unified canvas launcher ──
//
// Single entry point for all four experience modes from the
// dashboard pills. Replaces:
//   - /app/synergy/new       (brain_probe / brainstorm_speed)
//   - /app/strategy/new      (precise_rd / digital_twin)
//
// What it does:
//   1. Reads the search params the dashboard hero forwarded
//      (?prompt | ?seed | ?mode | ?lenses | ?baseline | ?single).
//   2. Coerces them into a reasoning_settings bundle with the
//      experience_mode baked in.
//   3. POSTs /api/intake/bootstrap server-side — the same atomic
//      front door System B has used since the project-intake-
//      whiteboard launch — passing skipPipeline=true for the
//      brainstorm modes so they don't burn credits firing decompose.
//   4. Redirects to /app/space/[spaceId]/whiteboard (the unified
//      InteraxisCanvas). The chrome on that page reads
//      space.reasoning_settings.experienceMode and gates which
//      panels show.
//
// This page is now the DEEP-LINK FALLBACK for direct URL access.
// The dashboard hero POSTs /api/intake/bootstrap directly from the
// client (synergy-dashboard-hero.tsx#routeToDestination) so it can
// pass structured clarifying_qa_pairs + inferred_baseline that the
// URL-pack route cannot carry. Bookmarked links + the legacy
// /app/synergy/new redirect chain still resolve through here.
//
// This is Phase 1 of the consolidation plan. Phases 2/3 will port
// Synergy's distinctive operations (voice dock, autopilot, focus
// funnel) onto the canvas and then retire the synergy whiteboard
// route entirely.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthUser } from "@/lib/supabase/server";
import {
  coerceReasoningSettings,
  type ReasoningLens,
  type ReasoningSettings,
} from "@/types/reasoning-settings";
import { isExperienceMode } from "@/types/experience-mode";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    prompt?: string;
    seed?: string;
    mode?: string;
    lenses?: string;
    baseline?: string;
    single?: string;
  }>;
}

const VALID_LENSES: readonly ReasoningLens[] = [
  "systems_analyst",
  "skeptic",
  "operator",
  "engineer",
  "historian",
];

export default async function UnifiedWhiteboardNewPage({
  searchParams,
}: PageProps) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const params = await searchParams;

  // The dashboard hero uses ?seed for synergy targets, ?prompt for
  // strategy targets. Both mean "the user's input" here.
  const text = (params.prompt ?? params.seed ?? "").trim();
  if (text.length < 4) {
    // Nothing to bootstrap with — drop the user back at the dashboard.
    redirect("/app");
  }

  const mode = isExperienceMode(params.mode) ? params.mode : "brain_probe";

  // ── Brainstorm Speedrun re-route (cinematic autopilot Wave 0) ──
  // brainstorm_speed lands on the InteraxisCanvas today by default,
  // but the canvas has no node-augment popover or autopilot loop —
  // those primitives live on the legacy Synergy whiteboard. Until
  // Phase 2/3 ports voice-dock + autopilot + node-popover to the
  // canvas, brainstorm_speed redirects to /app/synergy/new where
  // the existing augment + autopilot toolkit works out of the box.
  //
  // ?autopilot=1 tells synergy-whiteboard to auto-fire the multi-
  // wave autopilot sequencer (variations → decompose → ... →
  // converge) once the seed node mounts. See useAutopilot's
  // `run({ sequence })` mode (Wave 1) for the choreographed cascade.
  if (mode === "brainstorm_speed") {
    const synergyParams = new URLSearchParams();
    synergyParams.set("seed", text);
    synergyParams.set("autopilot", "1");
    redirect(`/app/synergy/new?${synergyParams.toString()}`);
  }

  // Compose reasoning_settings from the query params so the canvas
  // chrome + downstream pipeline stages see consistent state.
  const lenses: ReasoningLens[] =
    typeof params.lenses === "string" && params.lenses.length > 0
      ? params.lenses
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is ReasoningLens =>
            (VALID_LENSES as readonly string[]).includes(s),
          )
      : [];

  const reasoningRaw: Partial<ReasoningSettings> = {
    experienceMode: mode,
    buildBaselineFirst: params.baseline === "1",
    showAlternatives: params.single !== "1",
    ...(lenses.length > 0 ? { lenses } : {}),
  };
  const reasoning_settings = coerceReasoningSettings(reasoningRaw);

  // ── Mode → pipeline policy ──
  //   brain_probe                     → quiet canvas; user drives it.
  //   precise_rd / digital_twin       → full pipeline kicks in.
  // brainstorm_speed is redirected to synergy above; never reaches here.
  const skipPipeline = mode === "brain_probe";

  // Bootstrap is a same-origin POST that needs the user's session
  // cookie. We grab it off the incoming request and forward it.
  const hdrs = await headers();
  const cookie = hdrs.get("cookie") ?? "";
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const proto =
    hdrs.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  let bootstrap: { spaceId?: string; runId?: string | null; error?: string } = {};
  try {
    const res = await fetch(`${origin}/api/intake/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        text,
        reasoningDepth: reasoning_settings.depth,
        reasoning_settings,
        skipPipeline,
        // For brainstorm modes the plan-review gate is irrelevant —
        // there's no plan to review when no pipeline runs. The flag
        // is harmless for precise_rd / digital_twin which respect the
        // server-side thin-prompt override.
        skipPlanGate: skipPipeline,
      }),
      cache: "no-store",
    });
    bootstrap = (await res.json().catch(() => ({}))) as {
      spaceId?: string;
      runId?: string | null;
      error?: string;
    };
    if (!res.ok || !bootstrap.spaceId) {
      // Surface the error back at the dashboard rather than 500-ing
      // — the user can correct + retry without losing their prompt.
      const reason = encodeURIComponent(
        bootstrap.error ?? `bootstrap_${res.status}`,
      );
      redirect(`/app?error=${reason}`);
    }
  } catch (err) {
    // Network or origin-resolution miss. Fall back to /app with
    // enough hint for the user to retry.
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    console.error("[whiteboard/new] bootstrap fetch failed:", err);
    redirect("/app?error=bootstrap_unreachable");
  }

  // Append ?run= ONLY when the pipeline is actually running — the
  // WhiteboardBootstrapSplash on the canvas watches that param and
  // bridges the dead-canvas window until the first SSE event paints.
  // Skipped pipelines (brain_probe / brainstorm_speed) have no
  // events coming and would just flash the splash unnecessarily.
  const target =
    !skipPipeline && bootstrap.runId
      ? `/app/space/${bootstrap.spaceId}/whiteboard?run=${bootstrap.runId}`
      : `/app/space/${bootstrap.spaceId}/whiteboard`;
  redirect(target);
}
