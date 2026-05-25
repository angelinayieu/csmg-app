// ── /app/objective/new — entry card on empty canvas ──
//
// Phase 1 of the Objective Canvas module. Renders the empty white
// canvas with the centered "What's your objective?" card. User types
// their objective, picks Autopilot or Human-in-the-loop, clicks
// Begin → POST /api/brainstorm/start → redirect to
// /app/objective/<spaceId>.
//
// The card is HTML-styled to the Apple-vibe tokens for now; Phase
// 1b will mount it as a real tldraw shape so it lives inside the
// whiteboard properly.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { ObjectiveEntryCard } from "@/components/objective/objective-entry-card";

export const dynamic = "force-dynamic";

export default async function ObjectiveCanvasNewPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  return (
    <div
      className="relative min-h-screen w-full"
      style={{ background: "#fafafa" }}
    >
      {/* Subtle off-white grid behind the card — reads like a
          whiteboard, not a form page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.045) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.9), transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.9), transparent 70%)",
        }}
      />

      <HomeTabNav />

      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
        <ObjectiveEntryCard />
      </div>
    </div>
  );
}
