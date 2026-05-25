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

  // Whiteboard surface — full-bleed dot grid, edge to edge.
  // This is the visual "you've entered the canvas" cue. Animates in
  // on first paint so navigating from the landing feels like a
  // transform, not a hard cut.
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto whiteboard-surface"
      style={{
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        backgroundPosition: "0 0",
      }}
    >
      <HomeTabNav />

      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
        <ObjectiveEntryCard />
      </div>

      <style>{`
        .whiteboard-surface {
          animation: whiteboard-fade-in 360ms ease-out both;
        }
        @keyframes whiteboard-fade-in {
          from {
            background-color: #fafafa;
            background-image: radial-gradient(rgba(15,23,42,0) 1.1px, transparent 1.1px);
          }
          to {
            background-color: #fafafa;
            background-image: radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px);
          }
        }
      `}</style>
    </div>
  );
}
