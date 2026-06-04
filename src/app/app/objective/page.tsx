// ── /app/objective — retired landing ──
//
// The old Objective Canvas landing (the HomeTabNav "Objective Canvas / Synergy
// / Strategy Lab" tabs + the LandingExperience portal + Templates/Create/
// Explore empty state) is retired per the "only home + objective canvas"
// direction (see project_old_build_deprecation). The home (/app) is now the
// single entry point — the clean chatbox + library — and individual boards
// live at /app/objective/[spaceId]. The bare landing just redirects home so
// none of the old shell can render (and any board that can't resolve a space
// lands on the clean home, not the legacy portal).

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ObjectiveCanvasLandingRedirect() {
  redirect("/app");
}
