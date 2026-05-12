// ── /app/synergy/[id] — server route ──
//
// Resolves the route params + searchParams, then hands off to the
// client shell. The dynamic-import-with-ssr:false lives in
// synergy-page-client.tsx because Next.js 16 disallows `ssr: false`
// in server components. Auth is enforced by /app/layout.tsx which
// redirects to /auth/login when getAuthUser() returns null.

import { SynergyPageClient } from "./synergy-page-client";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}

export default async function SynergyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { focus } = await searchParams;
  return <SynergyPageClient sessionId={id} focusNodeId={focus} />;
}
