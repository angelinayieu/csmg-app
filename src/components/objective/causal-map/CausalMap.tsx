"use client";

// ── CausalMap — top-level orchestrator ────────────────────────────
//
// Phase 12.A. Entry point for the Causal System Map. Selects the
// altitude component (C4 zoom). The MVP ships the canvas altitude (L0);
// room (L1) / item (L2) altitudes mount here as later sub-phases land.
// Altitude is URL-driven (N3) at the page level — passed in as a prop so
// this component stays presentational. Unknown / not-yet-built altitudes
// fall back to the canvas altitude rather than rendering nothing.

import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import { CanvasAltitudeMap } from "./altitudes/CanvasAltitudeMap";
import type { Altitude } from "./lib/types";

interface Props {
  spaceId: string;
  /** Canvas-altitude data (the only altitude wired in the MVP). */
  subs: MainCanvasSub[];
  objectiveStack?: ObjectiveStack | null;
  crossRoomSignals?: CrossRoomSignals | null;
  /** Current zoom level. Defaults to canvas. Reserved for 12.A.4+. */
  altitude?: Altitude;
  height?: number;
}

export function CausalMap({
  spaceId,
  subs,
  objectiveStack,
  crossRoomSignals,
  height,
}: Props) {
  return (
    <CanvasAltitudeMap
      spaceId={spaceId}
      subs={subs}
      objectiveStack={objectiveStack}
      crossRoomSignals={crossRoomSignals}
      height={height}
    />
  );
}
