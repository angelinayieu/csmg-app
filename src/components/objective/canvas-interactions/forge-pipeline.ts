// ── Forge pipeline (tldraw-coupled) ──
//
// The path AFTER SpecForge: take the chain's accumulated synthesis, POST it
// to the tech-spec route (Opus + UI agent skill, optionally with pasted
// inspiration images), drop a Tech Spec card at the bottom of the forge
// unfurl, and (instead of auto-popping the document) hand the user a "Tech
// spec ready" affordance forked from the OperationLane that they can click
// to open. Imported only by whiteboard-base. The prototype stage hangs off
// the card's "Build prototype" button (BUILD_PROTOTYPE_EVENT).
//
// Also persists the spec as a `document` artifact so it shows up in the
// Library rail's Artifacts shelf — without this it only existed as a
// tldraw shape, so deleting the card or switching boards lost it.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";
import {
  BUILD_PROTOTYPE_EVENT,
  type OpenTechSpecDetail,
  type TechSpecCardShape,
} from "../shapes/tech-spec-card-shape";
import type { SpecForgeResult } from "./specforge-runner";

export interface InspirationImage {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

/** Fired after the tech-spec card lands on the board so the OperationLane
 *  can switch its in-flight "Writing tech spec…" row into a clickable
 *  "Tech spec ready" row and a notification chip can offer click-to-open.
 *  Carries everything OpenTechSpecDetail would so the consumer can dispatch
 *  the open event without re-reading the card. */
export const TECH_SPEC_READY_EVENT = "objective-board:tech-spec-ready";
export interface TechSpecReadyDetail extends OpenTechSpecDetail {
  /** Whether the original request asked for autoPrototype (the prototype
   *  branch already fired BUILD_PROTOTYPE_EVENT before this event — the
   *  notification then reads as "Spec ready, prototype building"). */
  autoPrototype?: boolean;
}

/** Fired when the tech-spec API/persist soft-fails so the lane can show a
 *  "Tech spec failed" row + the notification chip reads as a failure. */
export const TECH_SPEC_FAILED_EVENT = "objective-board:tech-spec-failed";
export interface TechSpecFailedDetail {
  anchorShapeId?: string;
  shapeId: string;
  title: string;
  reason: string;
}

interface PipelineOptions {
  anchorShapeId?: string;
  inspirationImages?: InspirationImage[];
  /** Two-channel progress:
   *  - `label`: free-form stage string ("Writing the tech spec…") — pumped
   *             to the OperationLane via SpecForgeProgress.techSpec.stage.
   *  - `cardId`: the tldraw shape id once the card lands — pumped so the
   *             lane connector can render before the runner returns. */
  onProgress?: (update: { label?: string; cardId?: string }) => void;
  /** Prototype-on-selection: after the tech spec lands, go straight to
   *  building the prototype (fire BUILD_PROTOTYPE_EVENT) instead of leaving
   *  the user with the click-to-open notification. */
  autoPrototype?: boolean;
}

const CARD_W = 308;
const CARD_H = 184;

/** Find where the forge unfurl bottoms out so the Tech Spec card lands just
 *  below it (centered on the unfurl), not on top of the cards. */
function placementBelowForge(
  editor: Editor,
  anchorShapeId?: string,
): { x: number; y: number } {
  const forgeCards = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "specforge-card" &&
        !(s.meta as { connector?: boolean })?.connector,
    );
  const boundsList = forgeCards
    .map((s) => editor.getShapePageBounds(s.id))
    .filter((b): b is NonNullable<typeof b> => !!b);

  if (boundsList.length > 0) {
    const maxY = Math.max(...boundsList.map((b) => b.maxY));
    const midX =
      boundsList.reduce((a, b) => a + b.midX, 0) / boundsList.length;
    return { x: midX - CARD_W / 2, y: maxY + 48 };
  }

  // Fallback: below the source idea, else viewport center.
  const ab = anchorShapeId
    ? editor.getShapePageBounds(anchorShapeId as TLShapeId)
    : undefined;
  if (ab) return { x: ab.midX - CARD_W / 2, y: ab.maxY + 48 };
  const vp = editor.getViewportPageBounds();
  return { x: vp.center.x - CARD_W / 2, y: vp.center.y };
}

/** Persist the spec to the artifacts table so it shows up in the Library
 *  rail's Artifacts shelf. Soft-fails — the on-board card always wins as
 *  the source of truth; persistence is a recoverability backstop. */
async function persistTechSpecArtifact(
  spaceId: string,
  args: {
    cardId: string;
    title: string;
    specJson: string;
    markdown: string;
    sourceShapeId?: string;
    status: "ready" | "error";
  },
): Promise<void> {
  try {
    await fetch(`/api/objective/${spaceId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        artifactType: "document",
        engineKey: "tech_spec",
        title: args.title,
        status: args.status,
        content: { specJson: args.specJson, markdown: args.markdown },
        boardShapeId: args.cardId,
        sourceShapeIds: args.sourceShapeId ? [args.sourceShapeId] : undefined,
        // First write also pins an immutable version so the Library has
        // history even before the user edits anything.
        appendVersion: args.status === "ready",
      }),
    });
  } catch (err) {
    console.warn("[forge-pipeline] persist artifact failed (soft):", err);
  }
}

/** Run the tech-spec stage and surface the card + lane handoff. Soft-fails.
 *  No longer auto-opens the document; instead fires TECH_SPEC_READY_EVENT
 *  so the OperationLane can offer a click-to-open row + the notification
 *  chip can read as "Tech spec ready". */
export async function runForgePipeline(
  editor: Editor,
  spaceId: string,
  forge: SpecForgeResult,
  opts: PipelineOptions = {},
): Promise<void> {
  opts.onProgress?.({
    label: opts.inspirationImages?.length
      ? "Reading inspiration & writing the tech spec…"
      : "Writing the tech spec…",
  });

  const res = await fetch(`/api/canvas/specforge/tech-spec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      spaceId,
      idea: forge.idea,
      forgeContext: forge.context,
      inspirationImages: opts.inspirationImages ?? [],
    }),
  });
  if (!res.ok) {
    // Visible failure — drop an error tech-spec card on the board so the user
    // sees that the chain ran but the spec step failed (no more silent
    // disappearance). Skip the prototype branch on the way out.
    const why = await safeErrorMessage(res);
    const failed = placeErrorTechSpec(editor, opts.anchorShapeId, forge.idea, why);
    // Persist the failure too so the Library shelf reflects it (status:error)
    // and the user knows where the artifact attempt lives.
    void persistTechSpecArtifact(spaceId, {
      cardId: failed.cardId,
      title: failed.title,
      specJson: "",
      markdown: failed.markdown,
      sourceShapeId: opts.anchorShapeId,
      status: "error",
    });
    opts.onProgress?.({ label: "Tech spec failed", cardId: failed.cardId });
    try {
      window.dispatchEvent(
        new CustomEvent<TechSpecFailedDetail>(TECH_SPEC_FAILED_EVENT, {
          detail: {
            anchorShapeId: opts.anchorShapeId,
            shapeId: failed.cardId,
            title: failed.title,
            reason: why,
          },
        }),
      );
    } catch {
      /* defensive */
    }
    return;
  }
  const data = (await res.json()) as { spec: TechSpec; markdown: string };

  opts.onProgress?.({ label: "Planning the UI…" });

  const { x, y } = placementBelowForge(editor, opts.anchorShapeId);
  const cardId = createShapeId();
  const specJson = JSON.stringify(data.spec);
  editor.createShape<TechSpecCardShape>({
    id: cardId,
    type: "tech-spec-card",
    x,
    y,
    props: {
      w: CARD_W,
      h: CARD_H,
      title: data.spec.title,
      specJson,
      markdown: data.markdown,
      featureCount: data.spec.features.length,
      phaseCount: data.spec.build_phases.length,
    },
    meta: { techSpec: true, sourceShapeId: opts.anchorShapeId ?? "" },
  });
  // Gentle camera nudge to bring the card into view (user complaint: "not
  // shown on the whiteboard"). We DON'T open the document — just make sure
  // the artifact is visible on the board so the lane→card connector reads,
  // and the notification's "Open" CTA reads as the explicit hand-off.
  try {
    editor.select(cardId);
    editor.centerOnPoint(
      { x: x + CARD_W / 2, y: y + CARD_H / 2 },
      { animation: { duration: 380 } },
    );
  } catch {
    /* tldraw race — fine; the card still exists */
  }
  // Pump the card id BEFORE persistence + the ready event so the connector
  // can paint as soon as the shape exists.
  opts.onProgress?.({ label: "Tech spec ready", cardId });

  // Persist as a `document` artifact (status:ready) — fire-and-forget so the
  // notification doesn't wait on the round-trip.
  void persistTechSpecArtifact(spaceId, {
    cardId,
    title: data.spec.title,
    specJson,
    markdown: data.markdown,
    sourceShapeId: opts.anchorShapeId,
    status: "ready",
  });

  const detail: TechSpecReadyDetail = {
    specJson,
    markdown: data.markdown,
    title: data.spec.title,
    shapeId: cardId,
    autoPrototype: opts.autoPrototype,
  };

  if (opts.autoPrototype) {
    // Prototype-on-selection: tech-spec card stays on the board (openable
    // later); jump straight to building the prototype off this spec.
    window.dispatchEvent(
      new CustomEvent<OpenTechSpecDetail>(BUILD_PROTOTYPE_EVENT, { detail }),
    );
  }
  // Always fire the ready event so the OperationLane can switch its
  // in-flight row into a click-to-open row and the notification chip can
  // render. The auto-open of the full-screen document is GONE — the user
  // chooses when to open it (clicking the lane row, the notification, or
  // the card itself).
  try {
    window.dispatchEvent(
      new CustomEvent<TechSpecReadyDetail>(TECH_SPEC_READY_EVENT, { detail }),
    );
  } catch {
    /* defensive */
  }
}

/** Read a useful one-liner from a failed response without throwing. */
async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return `${res.status} — ${j.error}`;
  } catch {
    /* not JSON */
  }
  return `tech-spec request failed (${res.status})`;
}

/** Drop a visible "Tech Spec failed" card on the board so the user sees that
 *  the chain ran but the spec step failed (instead of silent disappearance).
 *  The card still lands in the Powerup rail's Artifacts section — clicking
 *  Open spec reveals the error markdown explaining what happened. */
function placeErrorTechSpec(
  editor: Editor,
  anchorShapeId: string | undefined,
  idea: string,
  why: string,
): { cardId: string; title: string; markdown: string } {
  const { x, y } = placementBelowForge(editor, anchorShapeId);
  const cardId = createShapeId();
  const ideaLine = idea.length > 120 ? idea.slice(0, 117).trimEnd() + "…" : idea;
  const markdown =
    `# Tech spec failed\n\n` +
    `The forge engine cards generated, but the tech-spec stage couldn't complete.\n\n` +
    `**Reason:** ${why}\n\n` +
    (ideaLine ? `**Idea:** ${ideaLine}\n\n` : "") +
    `Try again — if it keeps failing, the Anthropic model id in ` +
    `\`src/lib/llm.ts\` (BEST_CLAUDE_MODEL) may need a bump.`;
  const title = "Tech spec failed";
  editor.createShape<TechSpecCardShape>({
    id: cardId,
    type: "tech-spec-card",
    x,
    y,
    props: {
      w: CARD_W,
      h: CARD_H,
      title,
      specJson: "",
      markdown,
      featureCount: 0,
      phaseCount: 0,
    },
    meta: { techSpec: true, error: true, sourceShapeId: anchorShapeId ?? "" },
  });
  return { cardId, title, markdown };
}
