// ── /app/welcome — redirects to /app ──
//
// The first-visit onboarding now mounts as a glass WelcomeOverlay
// over the whiteboard at /app, so this dedicated route just bounces
// users there. Kept as a stable URL in case anything still links to
// it (signup flow, bookmarks, the old welcome-redirect copy).

import { redirect } from "next/navigation";

export default function SynergyWelcomePage() {
  redirect("/app");
}
