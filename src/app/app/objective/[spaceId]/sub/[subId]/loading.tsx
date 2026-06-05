// ── /app/objective/[spaceId]/sub/[subId] — loading.tsx ──
//
// Renders the instant the user clicks "Open room" while the new RSC
// payload streams in. Deliberately a tiny corner pill (not a
// full-screen splash) so the prior surface stays visible and clicks
// never feel like the whole app blanked out.

import { CornerLoader } from "@/components/ui/corner-loader";

export default function SubObjectiveRoomLoading() {
  return <CornerLoader label="Opening the room…" />;
}
