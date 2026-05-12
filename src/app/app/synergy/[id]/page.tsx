// ── /app/synergy/[id] — solo brainstorm whiteboard ──
//
// Thin server component shell that dynamic-imports the client whiteboard
// (mirrors the /app/space/[id]/whiteboard pattern). Auth check rides on
// /app/layout.tsx which redirects to /auth/login when getAuthUser() is null.

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

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}

export default async function SynergyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { focus } = await searchParams;
  return <SynergyWhiteboard sessionId={id} focusNodeId={focus} />;
}
