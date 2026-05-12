// ── /app/synergy/new — create a session and redirect ──
//
// Server component: spins up a brainstorm_sessions row for the
// authenticated user, then redirects to /app/synergy/[id]. Optional
// `?seed=...` query param becomes the core node's label.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";

interface PageProps {
  searchParams: Promise<{ seed?: string; title?: string }>;
}

export default async function NewSynergyPage({ searchParams }: PageProps) {
  const { seed, title } = await searchParams;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

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
