// ── /app ──
//
// The canonical home surface (Phase 2C revision).
//
// Earlier locked direction (2026-04-20) set this route to a flat
// saved-whiteboards list. The current direction (2026-04-21) walks
// that back slightly: the immersive welcome is the landing, and the
// whiteboards library lives on the SAME route as a crossfade-reachable
// view. Users get the aspirational welcome by default; one click on
// the "N whiteboards →" pill flips them to the library with a
// smooth spring transition. The HomeShell client component owns
// both views + the view-state + the fixed full-bleed positioning
// that tracks sidebar expand/collapse live.

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeShell } from "@/components/home/home-shell";
import { TEMPLATE_LIST } from "@/lib/use-cases/library";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  // `?style=gradient` switches the immersive surface from the default
  // dotted canvas to the navy radial-glow aesthetic. Canvas = daily
  // surface; gradient = showcase. Exposed as an opt-in query param
  // so the daily experience isn't locked to one look.
  searchParams?: Promise<{ style?: string }>;
}) {
  const params = await searchParams;
  const immersiveMode =
    params?.style === "gradient" ? "gradient" : "canvas";

  const user = await getAuthUser();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spacesRaw } = await db
    .from("spaces")
    .select("*")
    .is("parent_space_id", null)
    .order("updated_at", { ascending: false })
    .limit(60);
  const spaces = (spacesRaw ?? []) as Space[];

  const greetingName =
    user?.email?.split("@")[0] ?? "there";

  const templates = TEMPLATE_LIST.map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    icon: t.icon,
    accent_color: t.accent_color,
    category: t.category,
    default_surface: t.default_surface,
    seed_entity_count: t.seed_entities.length,
    question_count: t.question_library.length,
  }));

  return (
    <HomeShell
      greetingName={greetingName}
      templates={templates}
      spaces={spaces}
      mode={immersiveMode}
    />
  );
}
