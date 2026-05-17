// ── /app/synergy/[id] — server route ──
//
// Resolves the route params + searchParams, then hands off to the
// client shell. The dynamic-import-with-ssr:false lives in
// synergy-page-client.tsx because Next.js 16 disallows `ssr: false`
// in server components. Auth is enforced by /app/layout.tsx which
// redirects to /auth/login when getAuthUser() returns null.
//
// Phase 3 (Canvas unification) — when a session has been migrated
// to a space (brainstorm_sessions.migrated_to_space_id is set), we
// redirect transparently to the new canvas. Same UUID is preserved
// across the migration, so legacy bookmarks/links don't break — the
// redirect just shuttles the user to the new surface.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SynergyPageClient } from "./synergy-page-client";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string; voice?: string }>;
}

export default async function SynergyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { focus, voice } = await searchParams;

  // Phase 3 — check migration state. One cheap row read.
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: row } = await db
    .from("brainstorm_sessions")
    .select("migrated_to_space_id")
    .eq("id", id)
    .maybeSingle();
  if (row?.migrated_to_space_id) {
    redirect(`/app/space/${row.migrated_to_space_id}/whiteboard`);
  }

  return (
    <SynergyPageClient
      sessionId={id}
      focusNodeId={focus}
      autoStartVoice={voice === "1"}
    />
  );
}
