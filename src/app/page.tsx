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

// Curated swarm. ORDER MATTERS: the landing maps each card to a fixed floating
// anchor by index (see FLOATING_ANCHORS in landing-v2), so this order IS the
// on-screen composition. Most entries pull live data from the template library;
// "product_development" is a SYNTHETIC marketing card (no backing template) —
// clicking it stashes a free-text "create" intake instead (handled in landing-v2).
const SWARM_ORDER = [
  "journal_self_discovery", // 0 · L top
  "startup_strategy",       // 1 · R top
  "relationship_dynamics",  // 2 · L mid — BEHIND research (depth card)
  "research_project",       // 3 · L mid — front, overlaps the depth card
  "product_development",    // 4 · R mid — BEHIND reading (depth card) · SYNTHETIC
  "reading_synthesis",      // 5 · R mid — front, overlaps the depth card
  "team_retro",             // 6 · L bottom
  "career_pivot",           // 7 · R bottom
] as const;

const LABEL_OVERRIDES: Record<string, string> = {
  team_retro: "Team Retrospective",
};

// Synthetic cards that aren't backed by a template-library entry. Kept here so
// the swarm can emphasise a use-case (product development) without forcing a
// full template definition. `id` is matched in landing-v2's click handler.
const SYNTHETIC_CARDS: Record<string, LandingCard> = {
  product_development: {
    id: "product_development",
    name: "Product Development",
    tagline: "Take a feature from idea to shipped — map the whole build",
    category: "professional",
    accent: "#0B0B0C",
    bannerAccent: "#0ea5e9", // sky — distinct from the other professional cards
  },
};

export default async function LandingPage() {
  const user = await getAuthUser();
  if (user) {
    redirect("/app");
  }

  const cards = SWARM_ORDER.map((id): LandingCard | null => {
    const synthetic = SYNTHETIC_CARDS[id];
    if (synthetic) return synthetic;
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
