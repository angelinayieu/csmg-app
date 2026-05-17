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
  searchParams: Promise<{
    focus?: string;
    voice?: string;
    /** Wave 0 — brainstorm-speedrun autopilot bootstrap. When "1",
     *  the whiteboard auto-fires the multi-wave autopilot sequencer
     *  once the seed node mounts. Set by the homepage redirect chain
     *  for the brainstorm_speed experience mode. */
    autopilot?: string;
  }>;
}

export default async function SynergyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { focus, voice, autopilot } = await searchParams;
  return (
    <SynergyPageClient
      sessionId={id}
      focusNodeId={focus}
      autoStartVoice={voice === "1"}
      autoStartAutopilot={autopilot === "1"}
    />
  );
}
