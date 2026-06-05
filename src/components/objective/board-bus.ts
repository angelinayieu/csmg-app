"use client";

import type { UnfurlAnchor } from "./unfurl/anchor-from-path";
import type { DataFlowGraph } from "@/lib/objective-canvas/build-data-flow-graph";

// ── Objective board dispatch bus (tldraw-free) ────────────────────
//
// Sending a room item to the whiteboard is a one-line CustomEvent. This
// module carries ONLY the event name + dispatcher + payload type — no
// tldraw import — so room views and cards can fire it without pulling the
// heavy `whiteboard-base` module (and its non-tree-shakeable
// `tldraw/tldraw.css` side-effect) into their bundles. WhiteboardBase is
// the only tldraw consumer and listens for these events.

/** Detail payload for sending a single room item to the board. */
export interface ArtifactCardDetail {
  kind: "pain" | "feature" | "outcome" | "lab";
  entityId: string;
  title: string;
  subtitle?: string;
  color: string;
  roomId: string;
}

/** Event a room item fires to land on the board as an artifact card. */
export const DEPLOY_ARTIFACT_EVENT = "objective-board:deploy-artifact";

/** Typed dispatcher — send a room item to a board mounted on THIS page. */
export function deployArtifactCard(detail: ArtifactCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_ARTIFACT_EVENT, { detail }));
}

// ── Cross-page queue ──────────────────────────────────────────────
// The lab lives on its own route with no board mounted, so a live event
// has nothing to listen. Instead we stage artifacts in sessionStorage;
// the board drains the queue the next time it mounts (when the user
// returns to the objective canvas). Per-space so boards don't cross.

const PENDING_KEY = (spaceId: string) => `objective-board:pending:${spaceId}`;

/** Stage an artifact for a board that isn't mounted yet (e.g. sent from
 *  the lab). Drained by the board on its next mount. Falls back to a live
 *  dispatch if sessionStorage is unavailable. */
export function queueArtifactForBoard(
  spaceId: string,
  detail: ArtifactCardDetail,
) {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY(spaceId));
    const list: ArtifactCardDetail[] = raw ? JSON.parse(raw) : [];
    list.push(detail);
    window.sessionStorage.setItem(PENDING_KEY(spaceId), JSON.stringify(list));
  } catch {
    deployArtifactCard(detail);
  }
}

/** Robust send used by cross-page surfaces (the lab): fire a LIVE event
 *  for a board already mounted on this page (the persistent layout-level
 *  board listens continuously) AND stage in the queue so a board that
 *  mounts later still receives it. The board dedupes by entityId, so when
 *  both paths land there's no double. */
export function sendArtifactToBoard(
  spaceId: string,
  detail: ArtifactCardDetail,
) {
  deployArtifactCard(detail);
  queueArtifactForBoard(spaceId, detail);
}

// ── Unfurl ─────────────────────────────────────────────────────────
/** "Open on whiteboard" — unfurl the chain up to a surface, to a depth. */
export const OPEN_UNFURL_EVENT = "objective-board:unfurl";

/** Fire from any surface (objective / room / lab) to open the unfurl on
 *  the board, anchored + at the surface's depth. The board listens. */
export function openUnfurl(anchor: UnfurlAnchor) {
  window.dispatchEvent(new CustomEvent(OPEN_UNFURL_EVENT, { detail: anchor }));
}

// ── Per-card hover actions ────────────────────────────────────────
// Fired by a card's hover action bar (canvas-interactions/card-hover-
// actions.tsx). WhiteboardBase listens: "save" → Library; the AI actions
// (decompose/variations/questions/make_plan) run through the canvas operation
// registry + executor — dropping result cards just below the source shape.

export type CardAction =
  | "diverge"
  | "converge"
  | "decompose"
  | "variations"
  | "questions"
  | "make_plan"
  | "save"
  | "open_room"
  | "promote_objective";

export interface CardActionDetail {
  action: CardAction;
  entityId: string;
  title: string;
  roomId?: string | null;
  /** tldraw id of the source card — lets the executor tether results
   *  (drop them just below the originating shape). */
  shapeId?: string;
}

export const CARD_ACTION_EVENT = "objective-board:card-action";

/** Fire from a card's hover action bar. WhiteboardBase listens. */
export function dispatchCardAction(detail: CardActionDetail) {
  window.dispatchEvent(new CustomEvent(CARD_ACTION_EVENT, { detail }));
}

// ── Card-saved confirmation ───────────────────────────────────────
// WhiteboardBase fires this back AFTER a "save" CardAction lands in the
// Library, so the originating card can flip its Save tile to a confirmed
// "Saved ✓" state. Keyed by entityId — every card referencing that item
// reflects the save. Closes the feedback loop the hover-menu Save opened.

export interface CardSavedDetail {
  entityId: string;
}

export const CARD_SAVED_EVENT = "objective-board:card-saved";

/** Fire from WhiteboardBase once a card's item is persisted to Library. */
export function dispatchCardSaved(entityId: string) {
  if (!entityId) return;
  window.dispatchEvent(
    new CustomEvent(CARD_SAVED_EVENT, { detail: { entityId } }),
  );
}

/** Read + clear the pending-artifact queue for this space. */
export function drainPendingArtifacts(spaceId: string): ArtifactCardDetail[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY(spaceId));
    if (!raw) return [];
    window.sessionStorage.removeItem(PENDING_KEY(spaceId));
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as ArtifactCardDetail[]) : [];
  } catch {
    return [];
  }
}

// ── Data-flow map → board ──────────────────────────────────────────
// "Send to whiteboard" for the data-unit flow graph. Unlike OPEN_UNFURL
// (which re-fetches by anchor and can't carry a payload), this carries
// the {nodes,edges} graph DIRECTLY on the event so WhiteboardBase
// materializes the exact map the panel is showing — as real bound
// artifact-card nodes + arrows. tldraw-free here (only a type import).

export const SEND_DATAFLOW_EVENT = "objective-board:dataflow";

/** Fire from the data-flow panel to drop the graph onto the board as real
 *  connected shapes the user can brainstorm around. WhiteboardBase listens. */
export function sendDataFlowToBoard(graph: DataFlowGraph) {
  window.dispatchEvent(new CustomEvent(SEND_DATAFLOW_EVENT, { detail: graph }));
}

// ── Prompt Sharpening Card → board ─────────────────────────────────
// The first intake intelligence object. PromptSharpeningMount polls the
// status route and fires this once the artifact is ready; WhiteboardBase
// materializes the card below the objective room-card with an arrow.

export interface SharpeningCardDetail {
  spaceId: string;
  /** distilled_title */
  title: string;
  /** sharpened_prompt */
  sharpenedPrompt: string;
  /** short chip labels for the top ranked ambiguities */
  chips: string[];
  /** ambiguity_heatmap, JSON-encoded (10 zones) */
  heatmapJson: string;
  /** ranked_ambiguities, JSON-encoded (for fork bodies) */
  rankedJson: string;
  color?: string;
}

export const DEPLOY_SHARPENING_EVENT = "objective-board:deploy-sharpening";

/** Materialize the Prompt Sharpening Card on a board mounted on this page. */
export function deploySharpeningCard(detail: SharpeningCardDetail) {
  window.dispatchEvent(
    new CustomEvent(DEPLOY_SHARPENING_EVENT, { detail }),
  );
}

// ── Fork an ambiguity off the sharpening card ──────────────────────
// Clicking an ambiguity chip / heatmap zone forks it out as its own card
// (a seeds_question node) connected to the sharpening card.

export interface AmbiguityForkDetail {
  /** tldraw id of the sharpening card the ambiguity forks from. */
  sourceId: string;
  headline: string;
  body: string;
  color: string;
}

export const FORK_AMBIGUITY_EVENT = "objective-board:fork-ambiguity";

/** Fire from a sharpening-card ambiguity chip/zone. WhiteboardBase listens. */
export function forkAmbiguity(detail: AmbiguityForkDetail) {
  window.dispatchEvent(new CustomEvent(FORK_AMBIGUITY_EVENT, { detail }));
}

// ── Fork the heatmap / priority-map out of the sharpening card ─────
// User-driven only: pressing the fork button on the expanded sharpening
// card spawns a square AmbiguityHeatmap card (the 10-zone grid) or a
// PriorityMap card (the salience rows) connected back via the bezier overlay.

export interface DeployHeatmapCardDetail {
  /** tldraw id of the source prompt-sharpening card. */
  sourceId: string;
  spaceId: string;
  heatmapJson: string;
  color: string;
}
export const DEPLOY_HEATMAP_CARD_EVENT = "objective-board:deploy-heatmap-card";
export function deployHeatmapCard(detail: DeployHeatmapCardDetail) {
  window.dispatchEvent(
    new CustomEvent(DEPLOY_HEATMAP_CARD_EVENT, { detail }),
  );
}

export interface DeployPriorityMapCardDetail {
  /** tldraw id of the source prompt-sharpening card. */
  sourceId: string;
  spaceId: string;
  /** salience annotations (JSON-encoded). */
  salienceJson: string;
  color: string;
}
export const DEPLOY_PRIORITY_MAP_EVENT = "objective-board:deploy-priority-map";
export function deployPriorityMapCard(detail: DeployPriorityMapCardDetail) {
  window.dispatchEvent(
    new CustomEvent(DEPLOY_PRIORITY_MAP_EVENT, { detail }),
  );
}

// ── Analyzed image → board ─────────────────────────────────────────
// ObjectiveImageMount fires this once a pasted image's vision analysis has
// landed; WhiteboardBase materializes it as an image card below the
// objective card. Idempotent by imageFileId.

export interface ImageCardDetail {
  /** ingested_files id of the source image (idempotency key). */
  imageFileId: string;
  imageName: string;
  /** public Storage URL of the image binary. */
  imageUrl: string;
  description: string;
  entityCount: number;
  /** extracted entities, JSON-encoded ([{name,type}]). */
  entitiesJson: string;
  color?: string;
}

export const DEPLOY_IMAGE_CARD_EVENT = "objective-board:deploy-image-card";

/** Materialize an analyzed image as a card on a board mounted on this page. */
export function deployImageCard(detail: ImageCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_IMAGE_CARD_EVENT, { detail }));
}

// ── Chatbox → objective promotion ──────────────────────────────────
// The chatbox card fires this on submit (after promoting the draft space):
// WhiteboardBase deletes the chatbox card, creates the objective card at the
// SAME position (in-place transform), and forks an optimistic Prompt
// Sharpening Card below it.

export interface PromoteToObjectiveDetail {
  /** tldraw id of the chatbox card being replaced. */
  chatboxId: string;
  spaceId: string;
  title: string;
  objective: string;
}

export const PROMOTE_TO_OBJECTIVE_EVENT =
  "objective-board:promote-to-objective";

export function promoteToObjective(detail: PromoteToObjectiveDetail) {
  window.dispatchEvent(
    new CustomEvent(PROMOTE_TO_OBJECTIVE_EVENT, { detail }),
  );
}

// ── Seed the intake card on the board ──────────────────────────────
// The shell dispatches one of these once it knows whether the space is a
// draft (chatbox) or a promoted objective. WhiteboardBase seeds the shape
// idempotently after restore.

export interface SeedChatboxDetail {
  spaceId: string;
  /** carried-over text from the home chatbox (sessionStorage). */
  seedText: string;
}
export const SEED_CHATBOX_EVENT = "objective-board:seed-chatbox";
export function seedChatboxCard(detail: SeedChatboxDetail) {
  window.dispatchEvent(new CustomEvent(SEED_CHATBOX_EVENT, { detail }));
}

export interface SeedObjectiveDetail {
  spaceId: string;
  title: string;
  objective: string;
}
export const SEED_OBJECTIVE_EVENT = "objective-board:seed-objective";
export function seedObjectiveCard(detail: SeedObjectiveDetail) {
  window.dispatchEvent(new CustomEvent(SEED_OBJECTIVE_EVENT, { detail }));
}

// ── Voice journal → board ──────────────────────────────────────────
// The recorder commits a spoken entry: WhiteboardBase materializes a
// voice-note card (profile + transcript). Idempotent by voiceNoteId.

export interface VoiceNoteCardDetail {
  /** Idempotency key (the commit/session id). */
  voiceNoteId: string;
  spaceId: string;
  authorName: string;
  transcript: string;
  createdAtIso: string;
  /** Length of the recording in ms (metadata shown when expanded). */
  durationMs?: number;
  /** AI analysis, JSON-encoded ({ status, points: [{title, subtitle}] }). */
  analysisJson?: string;
  color?: string;
}
export const DEPLOY_VOICE_NOTE_EVENT = "objective-board:deploy-voice-note";
export function deployVoiceNoteCard(detail: VoiceNoteCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_VOICE_NOTE_EVENT, { detail }));
}

// ── Voice-note analysis update ─────────────────────────────────────
// The note's AI analysis lands async (a beat after the card). This updates
// ONLY the analysis/duration props by voiceNoteId, so it never clobbers a
// transcript the user has edited in the meantime.

export interface VoiceNoteAnalysisDetail {
  voiceNoteId: string;
  /** JSON-encoded VoiceNoteAnalysis ({ status, points }). */
  analysisJson: string;
  durationMs?: number;
}
export const UPDATE_VOICE_ANALYSIS_EVENT = "objective-board:update-voice-analysis";
export function updateVoiceNoteAnalysis(detail: VoiceNoteAnalysisDetail) {
  window.dispatchEvent(new CustomEvent(UPDATE_VOICE_ANALYSIS_EVENT, { detail }));
}

// ── Journal synthesis artifact → board ─────────────────────────────
// The journal mount polls the synthesize route + fires this; WhiteboardBase
// materializes (or updates in place) the single journal note-page / booklet
// card that synthesizes all voice notes. One per board.

export interface JournalCardDetail {
  spaceId: string;
  title: string;
  /** synthesized sections, JSON-encoded ([{ heading, body }]). */
  sectionsJson: string;
  pageCount: number;
  status: "fresh" | "regenerating" | "stale";
  color?: string;
}
export const DEPLOY_JOURNAL_EVENT = "objective-board:deploy-journal";
export function deployJournalCard(detail: JournalCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_JOURNAL_EVENT, { detail }));
}

// ── Open the editable Notebook panel ───────────────────────────────
// Fired by the journal-card "Open" button + the Notebook dock engine.
// The NotebookMount listens and opens the on-canvas editable panel (the
// board stays live behind it). artifactId optional — the panel resolves the
// space's notebook artifact when omitted.

export interface OpenNotebookDetail {
  spaceId: string;
  artifactId?: string | null;
}
export const OPEN_NOTEBOOK_EVENT = "objective-board:open-notebook";
export function openNotebook(detail: OpenNotebookDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTEBOOK_EVENT, { detail }));
}

// ── Resolution Studio (immersive "I'll answer") ───────────────────
// The sharpening card fires this with its salience annotations; the
// layout-level ResolutionStudioMount opens the immersive modal where the
// user resolves each high-leverage ambiguity (flashcard chips + voice +
// live AI assist). Resolved answers persist onto the sharpening artifact.

/** A single resolvable concept handed to the studio (a JSON-safe subset of
 *  SalienceAnnotation — the bus stays tldraw-free + serializable). */
export interface ResolutionStudioConcept {
  phrase: string;
  kind: string;
  leverage: number;
  uncertainty: number;
  why?: string;
  candidate_readings?: string[];
  concept_slug?: string;
}

export interface ResolutionStudioDetail {
  spaceId: string;
  /** distilled objective title — shown as the studio subtitle for context. */
  objectiveTitle?: string;
  /** current sharpened prompt — shown in the scope rail. */
  sharpenedPrompt?: string;
  /** the deck of concepts to resolve. */
  concepts: ResolutionStudioConcept[];
}

export const OPEN_RESOLUTION_STUDIO_EVENT =
  "objective-board:open-resolution-studio";

/** Open the Resolution Studio over the board. */
export function openResolutionStudio(detail: ResolutionStudioDetail) {
  window.dispatchEvent(
    new CustomEvent(OPEN_RESOLUTION_STUDIO_EVENT, { detail }),
  );
}

// ── Sharpening card refresh (Phase 3) ─────────────────────────────
// After resolutions are applied (glossary write-back + re-framed prompt) the
// sharpening card is past its loading-poll, so it won't pick up the new
// prompt on its own. The studio fires this; the card re-fetches the artifact
// and updates its props in place.

export const REFRESH_SHARPENING_EVENT = "objective-board:refresh-sharpening";

/** Tell the sharpening card to re-fetch + re-render (e.g. after a re-frame). */
export function refreshSharpening(spaceId: string) {
  window.dispatchEvent(
    new CustomEvent(REFRESH_SHARPENING_EVENT, { detail: { spaceId } }),
  );
}

// ── AI auto-resolve activity bus ─────────────────────────────────────
// Lets surfaces (the goal rail's activity strip) reflect the auto-resolver in
// real time: pulse while a call is in-flight, flash when it commits. The bus
// is the call-site convention — both auto-resolve entry points (the card's
// "Let AI decide" + the Studio's "Let AI answer all") emit STARTED/ENDED
// around their fetch. Detail carries the trigger ("card" / "studio") and how
// many concepts went in, so listeners can render a meaningful label.

export const AI_AUTORESOLVE_STARTED_EVENT =
  "objective-board:ai-autoresolve-started";
export const AI_AUTORESOLVE_ENDED_EVENT =
  "objective-board:ai-autoresolve-ended";

export interface AiAutoResolveStartedDetail {
  spaceId: string;
  trigger: "card" | "studio";
  conceptCount: number;
}
export interface AiAutoResolveEndedDetail {
  spaceId: string;
  trigger: "card" | "studio";
  /** Number of resolutions that committed; 0 on failure. */
  resolvedCount: number;
  /** Number flagged for review (confidence<0.7 or no candidate matched). */
  reviewCount: number;
  /** False when the call failed / returned no resolutions. */
  ok: boolean;
}

export function emitAiAutoResolveStarted(detail: AiAutoResolveStartedDetail) {
  window.dispatchEvent(
    new CustomEvent(AI_AUTORESOLVE_STARTED_EVENT, { detail }),
  );
}

export function emitAiAutoResolveEnded(detail: AiAutoResolveEndedDetail) {
  window.dispatchEvent(
    new CustomEvent(AI_AUTORESOLVE_ENDED_EVENT, { detail }),
  );
}

// ── Comment-card events ───────────────────────────────────────────────────
// The comment-card shape fires these as the user interacts with it; a
// board-level mount handles the network round-trips and shape patches so
// the shape stays pure-render.

export interface CommentEventDetail {
  commentId: string;
  shapeId: string;
}
export interface CommentBodyPatchDetail extends CommentEventDetail {
  body: string;
}

/** Toolbox sphere → "open a new comment on the current selection". */
export const OPEN_BOARD_COMMENT_EVENT = "board:open-comment";

export const COMMENT_BODY_PATCH_EVENT = "objective-board:comment-body-patch";
export const COMMENT_RESOLVE_TOGGLE_EVENT =
  "objective-board:comment-resolve-toggle";
export const COMMENT_ANALYZE_EVENT = "objective-board:comment-analyze";
export const COMMENT_DELETE_EVENT = "objective-board:comment-delete";

export function dispatchCommentBodyPatch(
  commentId: string,
  shapeId: string,
  body: string,
) {
  window.dispatchEvent(
    new CustomEvent<CommentBodyPatchDetail>(COMMENT_BODY_PATCH_EVENT, {
      detail: { commentId, shapeId, body },
    }),
  );
}

export function dispatchCommentResolveToggle(commentId: string, shapeId: string) {
  window.dispatchEvent(
    new CustomEvent<CommentEventDetail>(COMMENT_RESOLVE_TOGGLE_EVENT, {
      detail: { commentId, shapeId },
    }),
  );
}

export function dispatchCommentAnalyze(commentId: string, shapeId: string) {
  window.dispatchEvent(
    new CustomEvent<CommentEventDetail>(COMMENT_ANALYZE_EVENT, {
      detail: { commentId, shapeId },
    }),
  );
}

export function dispatchCommentDelete(commentId: string, shapeId: string) {
  window.dispatchEvent(
    new CustomEvent<CommentEventDetail>(COMMENT_DELETE_EVENT, {
      detail: { commentId, shapeId },
    }),
  );
}
