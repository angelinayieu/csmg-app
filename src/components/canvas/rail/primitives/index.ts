// Public surface of the rail primitives package.
//
// Anyone composing the rail (RailRoot, RailAmbientMode, RailCardMode)
// imports from here — never reaches into individual files. Keeps the
// primitive boundary clean.

export { RailSection } from "./rail-section";
export { RailDivider } from "./rail-divider";
export { StateCard } from "./state-card";
export { LiveCard } from "./live-card";
export { ActionChip } from "./action-chip";
export { CountBadge } from "./count-badge";
export { StreamingDot } from "./streaming-dot";

export type { RailSectionProps } from "./rail-section";
export type { RailDividerProps } from "./rail-divider";
export type { StateCardProps } from "./state-card";
export type { LiveCardProps } from "./live-card";
export type { ActionChipProps, ActionChipVariant } from "./action-chip";
export type { CountBadgeProps } from "./count-badge";
export type { StreamingDotProps } from "./streaming-dot";
