// /app/space/[id]/page.tsx
//
// The space root now redirects to the Synthesis Lab (triple-lab) by
// default. This is the locked design decision from the
// "Triple-lab becomes /app default" architectural vote.
//
// The original dashboard view (production sequence, twin surface,
// trajectory panel, etc.) now lives at /app/space/[id]/dashboard.
// Sidebar "Dashboard" button points there; Synthesis Lab is the new
// landing.
//
// Server-side redirect (cheap, no client JS) so the URL is rewritten
// before any UI renders. No flash of dashboard then jump.

import { redirect } from "next/navigation";

export default async function SpaceRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/app/space/${id}/triple-lab`);
}
