// ── Brainstorm Board Bus ────────────────────────────────────────────
//
// Phase 4b-2 of BRAINSTORM_MODULE_SPEC.md — the bridge between the
// BrainstormPanel (which lives inside the picker) and WhiteboardBase
// (which owns the tldraw editor). Follows the same window-CustomEvent
// pattern as board-bus.ts so the panel can fire events without needing
// editor access in its props.
//
// Why this bridge instead of React context: the editor is created
// inside <WhiteboardBase> and the panel is rendered far down inside
// the picker which is rendered far down inside the canvas. Threading
// a context through every layer would touch dozens of files. The
// existing board-bus pattern already proves out window events as a
// clean side-channel.

import type {
  BrainstormCandidate,
  BrainstormRankedCandidate,
  BrainstormSession,
} from "@/lib/brainstorm/session-types";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

// ── Event names ────────────────────────────────────────────────────

/** Open the brainstorm session on the objective board. WhiteboardBase
 *  creates a new tldraw page (named after the session), drops one
 *  sticky note per candidate, and switches the editor to it. */
export const BRAINSTORM_OPEN_ON_BOARD_EVENT =
  "objective-board:brainstorm-open" as const;

/** Switch back to the main page (the brainstorm page persists in the
 *  page sidebar so the user can flip back via tldraw's built-in nav). */
export const BRAINSTORM_COLLAPSE_PAGE_EVENT =
  "objective-board:brainstorm-collapse" as const;

// ── Payloads ───────────────────────────────────────────────────────

export interface BrainstormCandidateForBoard {
  /** Stable id used to dedupe — re-firing OPEN updates existing
   *  shapes rather than creating new ones. */
  proposal_id: string;
  title: string;
  summary: string;
  intent_of_origin: SubObjectiveIntent;
  /** Phase 5 settle data — when present, drives ribbon color. */
  ribbon?: "green" | "amber" | "tray";
  composite_score?: number;
}

export interface BrainstormOpenOnBoardDetail {
  sessionId: string;
  /** Session title — becomes the tldraw page name. Keep short; tldraw
   *  truncates page tabs at ~30 chars. */
  pageTitle: string;
  candidates: BrainstormCandidateForBoard[];
}

export interface BrainstormCollapsePageDetail {
  sessionId: string;
}

// ── Dispatchers ────────────────────────────────────────────────────

export function brainstormOpenOnBoard(detail: BrainstormOpenOnBoardDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BRAINSTORM_OPEN_ON_BOARD_EVENT, { detail }),
  );
}

export function brainstormCollapsePage(detail: BrainstormCollapsePageDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BRAINSTORM_COLLAPSE_PAGE_EVENT, { detail }),
  );
}

// ── Helpers for callers ────────────────────────────────────────────

/** Build the board payload from a settled BrainstormSession. Pulls
 *  ranking + generations to assemble {ribbon, intent, title, summary}
 *  per candidate in one pass. */
export function candidatesForBoard(
  session: BrainstormSession,
): BrainstormCandidateForBoard[] {
  const intentByProposal = new Map<string, SubObjectiveIntent>();
  const sourceByProposal = new Map<string, BrainstormCandidate>();
  for (const g of session.generations ?? []) {
    for (const c of g.candidates) {
      intentByProposal.set(c.proposal_id, g.intent);
      sourceByProposal.set(c.proposal_id, c);
    }
  }
  const ribbonByProposal = new Map<
    string,
    BrainstormRankedCandidate["ribbon"]
  >();
  const scoreByProposal = new Map<string, number>();
  for (const r of session.ranking?.candidates ?? []) {
    ribbonByProposal.set(r.proposal_id, r.ribbon);
    scoreByProposal.set(r.proposal_id, r.composite_score);
  }

  const out: BrainstormCandidateForBoard[] = [];
  for (const [proposalId, source] of sourceByProposal) {
    out.push({
      proposal_id: proposalId,
      title: source.title,
      summary: source.summary ?? "",
      intent_of_origin: intentByProposal.get(proposalId) ?? "creative",
      ribbon: ribbonByProposal.get(proposalId),
      composite_score: scoreByProposal.get(proposalId),
    });
  }
  return out;
}
