// Barrel export for the Pulse surface.
//
// Consumers import the composed strip for the common case:
//   import { PulseStrip } from "@/components/pulse";
//
// For post-action optimistic updates (e.g. "user just approved a
// strategy, refresh the pulse immediately"), callers use:
//   import { dispatchPulseRefresh } from "@/components/pulse";
//   await fetch(...);
//   dispatchPulseRefresh();
//
// Advanced callers (e.g. a hypothetical command palette that wants to
// render its own pulse surface) can reach for the atoms directly.

export { PulseStrip } from "./pulse-strip";
export { PulseBar, PulseBarSkeleton } from "./pulse-bar";
export type { PulseBarProps, PulseStatus, PulseNarrativeSegment } from "./pulse-bar";
export { PulseRecentPanel } from "./pulse-recent-panel";
export type { PulseEvent, PulseEventKind } from "./pulse-recent-panel";
export {
  usePulseState,
  dispatchPulseRefresh,
  PULSE_REFRESH_EVENT,
} from "./use-pulse-state";
export type { PulseState } from "./use-pulse-state";
