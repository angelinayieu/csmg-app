// ── /app/synergy/new — create a session and redirect ──
//
// Server component: spins up a brainstorm_sessions row for the
// authenticated user, then redirects to /app/synergy/[id]. Optional
// `?seed=...` query param becomes the core node's label.
//
// Phase 1 unified canvas (2026-05): when the dashboard hero passes
// ?mode=<experience_mode>, redirect into /app/whiteboard/new so the
// user lands on the unified InteraxisCanvas instead of the legacy
// Synergy whiteboard. Untagged callers (no ?mode) still get the
// classic Synergy session — that path stays alive during the
// transition window until Phase 3 migrates the data.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isExperienceMode } from "@/types/experience-mode";

interface PageProps {
  searchParams: Promise<{
    seed?: string;
    title?: string;
    mode?: string;
    lenses?: string;
    baseline?: string;
    single?: string;
    objective?: string;
  }>;
}

export default async function NewSynergyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { seed, title } = params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  // Phase 0 leak fix — forward to the unified launcher when an
  // experience mode is set. We pass seed through as `prompt` since
  // the unified launcher reads either param.
  if (
    isExperienceMode(params.mode) &&
    typeof seed === "string" &&
    seed.trim().length >= 4
  ) {
    const fwd = new URLSearchParams();
    fwd.set("prompt", seed);
    fwd.set("mode", params.mode);
    if (params.lenses) fwd.set("lenses", params.lenses);
    if (params.baseline === "1") fwd.set("baseline", "1");
    if (params.single === "1") fwd.set("single", "1");
    if (params.objective) fwd.set("objective", params.objective);
    redirect(`/app/whiteboard/new?${fwd.toString()}`);
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const cleanTitle =
    typeof title === "string" && title.trim().length > 0
      ? title.trim().slice(0, 200)
      : "Untitled brainstorm";

  const { data: session, error } = await db
    .from("brainstorm_sessions")
    .insert({ owner_id: user.id, title: cleanTitle })
    .select("id")
    .single();

  if (error || !session) {
    // Fall back to the list page; surface error toast there via query param.
    redirect(`/app/synergy?error=${encodeURIComponent(error?.message ?? "create_failed")}`);
  }

  const cleanSeed =
    typeof seed === "string" && seed.trim().length > 0
      ? seed.trim().slice(0, 400)
      : null;
  if (cleanSeed) {
    await db.from("brainstorm_nodes").insert({
      session_id: session.id,
      kind: "core",
      label: cleanSeed,
      x: 600,
      y: 360,
    });
  } else {
    await db.from("brainstorm_nodes").insert({
      session_id: session.id,
      kind: "core",
      label: "Your idea",
      x: 600,
      y: 360,
    });
  }

  redirect(`/app/synergy/${session.id}`);
}
