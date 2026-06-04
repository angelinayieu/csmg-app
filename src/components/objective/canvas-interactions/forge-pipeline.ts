// ── Forge pipeline (tldraw-coupled) ──
//
// The path AFTER SpecForge: take the chain's accumulated synthesis, POST it
// to the tech-spec route (Opus + UI agent skill, optionally with pasted
// inspiration images), drop a Tech Spec card at the bottom of the forge
// unfurl, and auto-open the full-screen spec page. Imported only by
// whiteboard-base. The prototype stage hangs off the card's "Build
// prototype" button (BUILD_PROTOTYPE_EVENT).

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";
import {
  OPEN_TECH_SPEC_EVENT,
  BUILD_PROTOTYPE_EVENT,
  type OpenTechSpecDetail,
  type TechSpecCardShape,
} from "../shapes/tech-spec-card-shape";
import type { SpecForgeResult } from "./specforge-runner";

export interface InspirationImage {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

interface PipelineOptions {
  anchorShapeId?: string;
  inspirationImages?: InspirationImage[];
  onProgress?: (label: string) => void;
  /** Prototype-on-selection: after the tech spec lands, go straight to
   *  building the prototype (fire BUILD_PROTOTYPE_EVENT) instead of
   *  auto-opening the full-screen spec page. */
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

/** Run the tech-spec stage and surface the card + page. Soft-fails. */
export async function runForgePipeline(
  editor: Editor,
  spaceId: string,
  forge: SpecForgeResult,
  opts: PipelineOptions = {},
): Promise<void> {
  opts.onProgress?.(
    opts.inspirationImages?.length
      ? "Reading inspiration & writing the tech spec…"
      : "Writing the tech spec…",
  );

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
  if (!res.ok) throw new Error(`tech-spec failed: ${res.status}`);
  const data = (await res.json()) as { spec: TechSpec; markdown: string };

  opts.onProgress?.("Planning the UI…");

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
  editor.select(cardId);
  editor.centerOnPoint(
    { x: x + CARD_W / 2, y: y + CARD_H / 2 },
    { animation: { duration: 320 } },
  );

  const detail: OpenTechSpecDetail = {
    specJson,
    markdown: data.markdown,
    title: data.spec.title,
    shapeId: cardId,
  };

  if (opts.autoPrototype) {
    // Prototype-on-selection: the tech-spec card stays on the board (openable
    // later); jump straight to building the prototype off this spec.
    opts.onProgress?.("Building prototype…");
    window.dispatchEvent(
      new CustomEvent<OpenTechSpecDetail>(BUILD_PROTOTYPE_EVENT, { detail }),
    );
  } else {
    // Auto-open the full-screen spec page (the "page at the end").
    window.dispatchEvent(
      new CustomEvent<OpenTechSpecDetail>(OPEN_TECH_SPEC_EVENT, { detail }),
    );
    opts.onProgress?.("Tech spec ready");
  }
}
