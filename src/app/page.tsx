// ── / (public landing) ──
//
// The akiboe marketing surface. Single canonical path: V2 hero ("from idea
// → value asap") on the whiteboard dot-grid surface, rendered through
// LandingV2Mount (no-flash 3D starburst wrapper). No legacy fallback, no
// preview query params — this IS the landing.
//
// Logged-in visitors are redirected to /app (Supabase SSR session cookie
// persists across restarts, so this "remembers" them). To preview while
// signed in, sign out — there's no longer a bypass param.

import { redirect } from "next/navigation";
import { type LandingCard } from "@/components/landing/landing-v2";
import { LandingV2Mount } from "@/components/landing/landing-v2-mount";
import { getTemplate } from "@/lib/use-cases/library";
import { getAuthUser } from "@/lib/supabase/server";

// Curated carousel — pulls live data from the template library so the cards
// never drift from the real templates. `team_retro` shows as "Retrospective".
const CAROUSEL_IDS = [
  "journal_self_discovery",
  "reading_synthesis",
  "research_project",
  "team_retro",
  "career_pivot",
] as const;
const LABEL_OVERRIDES: Record<string, string> = { team_retro: "Retrospective" };

export default async function LandingPage() {
  const user = await getAuthUser();
  if (user) {
    redirect("/app");
  }

  const cards = CAROUSEL_IDS.map((id): LandingCard | null => {
    const t = getTemplate(id);
    if (!t) return null;
    return {
      id: t.id,
      name: LABEL_OVERRIDES[t.id] ?? t.name,
      tagline: t.tagline,
      category: t.category,
      // Monochrome ink drives glyph/chips/category pill...
      accent: "#0B0B0C",
      // ...while the banner wash keeps the real per-template color.
      bannerAccent: t.accent_color,
    };
  }).filter((c): c is LandingCard => c !== null);

  return <LandingV2Mount cards={cards} surface="whiteboard" />;
}
