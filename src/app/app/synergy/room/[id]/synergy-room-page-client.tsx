// ── /app/synergy/room/[id] client shell ──
//
// Hosts the dynamic-import-with-ssr:false for SynergyRoomCanvas.
// Next.js 16 disallows `ssr: false` inside a server component, so the
// canvas component (which depends on browser-only state — pointer
// events, realtime channels, audio analyser) is loaded here, in a
// "use client" file. Mirrors the same split we have for
// /app/synergy/[id] (see synergy-page-client.tsx).

"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { SynergyRoomBundle } from "@/lib/synergy/room-client";

const SynergyRoomCanvas = dynamic(
  () =>
    import("@/components/synergy/synergy-room-canvas").then(
      (m) => m.SynergyRoomCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading shared room…
        </div>
      </div>
    ),
  },
);

export function SynergyRoomPageClient({ bundle }: { bundle: SynergyRoomBundle }) {
  return <SynergyRoomCanvas bundle={bundle} />;
}
