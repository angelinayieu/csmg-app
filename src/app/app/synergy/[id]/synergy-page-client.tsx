// ── /app/synergy/[id] — client shell ──
//
// Holds the `dynamic({ ssr: false })` import. Next.js 16 disallows
// `ssr: false` inside server components, so the page.tsx server
// component resolves the route params and forwards them here.
//
// We disable SSR because the whiteboard depends on browser-only APIs
// (Web Speech, getBoundingClientRect, pointer events) and we don't
// want a flicker of "empty board" before hydration replaces it.

"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const SynergyWhiteboard = dynamic(
  () =>
    import("@/components/synergy/synergy-whiteboard").then(
      (m) => m.SynergyWhiteboard,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading whiteboard…
        </div>
      </div>
    ),
  },
);

interface Props {
  sessionId: string;
  focusNodeId?: string;
  // True when the route arrived with ?voice=1 from the dashboard's
  // voice orb. The whiteboard reads this on mount and auto-starts
  // listening so the conversation flows continuously.
  autoStartVoice?: boolean;
}

export function SynergyPageClient({
  sessionId,
  focusNodeId,
  autoStartVoice,
}: Props) {
  return (
    <SynergyWhiteboard
      sessionId={sessionId}
      focusNodeId={focusNodeId}
      autoStartVoice={autoStartVoice}
    />
  );
}
