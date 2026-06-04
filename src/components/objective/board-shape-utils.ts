// ── Objective board shape utils (shared) ──
//
// The single source of truth for the custom tldraw shape utils the objective
// whiteboard registers. Extracted out of whiteboard-base so OTHER surfaces that
// render the same snapshots statically — notably <TldrawImage> in the version
// history preview — register the exact same shapes (otherwise custom cards
// render as empty boxes). whiteboard-base imports CUSTOM_SHAPE_UTILS from here.

import { RoomCardShapeUtil } from "./shapes/room-card-shape";
import { InsightCardShapeUtil } from "./shapes/insight-card-shape";
import { ArtifactCardShapeUtil } from "./shapes/artifact-card-shape";
import { OcCardShapeUtil } from "./shapes/oc-card-shape";
import { SubsystemKgShapeUtil } from "./shapes/subsystem-kg-shape";
import { LayerBandShapeUtil } from "./shapes/layer-band-shape";
import { SpecForgeCardShapeUtil } from "./shapes/specforge-card-shape";
import { TechSpecCardShapeUtil } from "./shapes/tech-spec-card-shape";
import { PrototypeCardShapeUtil } from "./shapes/prototype-card-shape";
import { PromptSharpeningCardShapeUtil } from "./shapes/prompt-sharpening-card-shape";
import { ObjectiveImageCardShapeUtil } from "./shapes/objective-image-card-shape";
import { ChatboxCardShapeUtil } from "./shapes/chatbox-card-shape";
import { ObjectiveCardShapeUtil } from "./shapes/objective-card-shape";
import {
  VoiceNoteCardShapeUtil,
  JournalCardShapeUtil,
} from "./canvas-interactions/voice-journal-board";

/** Every custom shape util the objective whiteboard registers, in registration
 *  order. Reused by the main <Tldraw> mount AND by static <TldrawImage>
 *  previews so historical snapshots render identically. */
export const CUSTOM_SHAPE_UTILS = [
  RoomCardShapeUtil,
  InsightCardShapeUtil,
  ArtifactCardShapeUtil,
  OcCardShapeUtil,
  SubsystemKgShapeUtil,
  LayerBandShapeUtil,
  SpecForgeCardShapeUtil,
  TechSpecCardShapeUtil,
  PrototypeCardShapeUtil,
  PromptSharpeningCardShapeUtil,
  ObjectiveImageCardShapeUtil,
  ChatboxCardShapeUtil,
  ObjectiveCardShapeUtil,
  VoiceNoteCardShapeUtil,
  JournalCardShapeUtil,
];
