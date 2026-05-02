"use client";

// ── Summary card action handlers ───────────────────────────────────────
//
// The SummaryCardShapeUtil renders Regenerate / Decompose / Pin
// buttons that fire `summary-card:action` window events with
// { summaryId, shapeId, action, payload? }. This component bridges
// those events to actual editor mutations + API calls. Mounted once
// inside the tldraw editor tree (canvas overlays) so it has access to
// useEditor + useMaterialize.
//
// Lives separately from the shape util so the util stays render-only
// and we don't have to thread editor/spaceId through props.

import { useCallback, useEffect } from "react";
import { useEditor, createShapeId } from "tldraw";
import type { TLShapeId } from "tldraw";
import { useMaterialize } from "../hooks/use-materialize";
import { extractShapeContent, describeSelection } from "@/lib/canvas/extract-shape-content";
import { toast } from "@/lib/hooks/use-toast";
import type { SummaryCardShape } from "../shapes/types";

type SummaryAction = "regenerate" | "decompose" | "pin" | "zoom-source";

interface SummaryActionEvent {
  summaryId: string;
  shapeId: TLShapeId;
  action: SummaryAction;
  payload?: unknown;
}

interface Props {
  spaceId: string;
}

// Local helper — keep narrowing dead-simple, the only fields we need
// are the props off the registered SummaryCardShape.
function getSummaryShape(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any,
): SummaryCardShape | null {
  if (!raw || raw.type !== "summary-card") return null;
  return raw as SummaryCardShape;
}

export function CanvasSummaryCardActions({ spaceId }: Props) {
  const editor = useEditor();
  const { materialize } = useMaterialize(spaceId);

  // ── Regenerate: re-run the LLM on the live state of the same source
  // shapes. We deliberately re-extract from current shapes rather than
  // replay the original payload — if the user edited a sticky in the
  // meantime, regenerate should reflect that. Falls back to "stale"
  // status when source shapes have been deleted.
  const handleRegenerate = useCallback(
    async (event: SummaryActionEvent) => {
      const card = getSummaryShape(editor.getShape(event.shapeId));
      if (!card) return;

      const sourceShapes = card.props.sourceShapeIds
        .map((sid) => editor.getShape(sid as TLShapeId))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));

      if (sourceShapes.length < 2) {
        editor.updateShape<SummaryCardShape>({
          id: card.id,
          type: "summary-card",
          props: {
            ...card.props,
            status: "error",
            errorMessage: `Only ${sourceShapes.length} source shape${sourceShapes.length === 1 ? "" : "s"} still on canvas`,
          },
        });
        toast.error("Can't regenerate — too many sources have been removed");
        return;
      }

      editor.updateShape<SummaryCardShape>({
        id: card.id,
        type: "summary-card",
        props: { ...card.props, status: "regenerating", errorMessage: null },
      });

      try {
        const extracted = extractShapeContent(sourceShapes);
        const r = await fetch(`/api/spaces/${spaceId}/lasso-summarize`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summaryId: card.props.summaryId,
            sourceLabel: describeSelection(extracted),
            items: extracted.items.map((it) => ({
              shapeId: it.shapeId,
              shapeType: it.shapeType,
              backendId: it.backendId,
              backendKind: it.backendKind,
              oneLiner: it.oneLiner,
              content: it.content,
            })),
          }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status}: ${txt.slice(0, 160)}`);
        }
        const data = (await r.json()) as { title: string; body: string; generatedAt?: string };

        // Re-read the card after the await — user might have edited
        // body text or moved it. Merge instead of clobber.
        const fresh = getSummaryShape(editor.getShape(card.id));
        if (!fresh) return;
        editor.updateShape<SummaryCardShape>({
          id: fresh.id,
          type: "summary-card",
          props: {
            ...fresh.props,
            title: data.title || fresh.props.title,
            body: data.body || fresh.props.body,
            generatedAt: data.generatedAt ?? new Date().toISOString(),
            sourceLabel: describeSelection(extracted),
            sourceCount: extracted.items.length,
            status: "fresh",
            errorMessage: null,
          },
        });
        toast.success("Summary regenerated");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const fresh = getSummaryShape(editor.getShape(card.id));
        if (fresh) {
          editor.updateShape<SummaryCardShape>({
            id: fresh.id,
            type: "summary-card",
            props: {
              ...fresh.props,
              status: "error",
              errorMessage: message.slice(0, 200),
            },
          });
        }
        toast.error(`Regenerate failed: ${message.slice(0, 80)}`);
      }
    },
    [editor, spaceId],
  );

  // ── Decompose: turn the summary body into a KG entity placed below
  // the card. The auto-recursive-decompose hook (see useRecursiveDecompose)
  // picks up the resulting ghost entity after IDLE_MS=1500 and fans
  // children out from it — so a single click here ends up producing a
  // small subtree from the synthesis. The card itself stays in place
  // and the new entity points back at it visually via tldraw's
  // proximity (no explicit binding, since the ghost entity sits in
  // its own auto-decompose lineage).
  const handleDecompose = useCallback(
    async (event: SummaryActionEvent) => {
      const card = getSummaryShape(editor.getShape(event.shapeId));
      if (!card) return;
      const text = card.props.body?.trim();
      if (!text || text.length < 12) {
        toast.error("Summary body is too short to decompose");
        return;
      }

      // Position the decomposed entity 80px below the summary card,
      // centered horizontally. (Recursive decompose will fan its
      // children further below.)
      const placement = {
        x: card.x + card.props.w / 2,
        y: card.y + card.props.h + 80,
      };

      editor.updateShape<SummaryCardShape>({
        id: card.id,
        type: "summary-card",
        props: { ...card.props, status: "regenerating" },
      });

      try {
        const result = await materialize(text.slice(0, 600), placement);
        const fresh = getSummaryShape(editor.getShape(card.id));
        if (fresh) {
          editor.updateShape<SummaryCardShape>({
            id: fresh.id,
            type: "summary-card",
            props: { ...fresh.props, status: "fresh", errorMessage: null },
          });
        }
        if (result) {
          toast.success(`Decomposed → ${result.entity.name}`);
        } else {
          toast.info("Decompose returned no entity");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const fresh = getSummaryShape(editor.getShape(card.id));
        if (fresh) {
          editor.updateShape<SummaryCardShape>({
            id: fresh.id,
            type: "summary-card",
            props: {
              ...fresh.props,
              status: "error",
              errorMessage: message.slice(0, 200),
            },
          });
        }
        toast.error(`Decompose failed: ${message.slice(0, 80)}`);
      }
    },
    [editor, materialize],
  );

  // ── Pin: tag the card as pinned (drives a future visual treatment)
  // and write the summary into space.synthesis_data.pinned_summaries
  // so the strategy drawer can list pins later. Until that drawer
  // surface ships, the user-visible feedback is the toast + the
  // pinned-state badge inside the card chrome.
  //
  // We persist via a small POST to /api/spaces/[id]/pin-summary so
  // the pin survives reload independently of the canvas snapshot.
  const handlePin = useCallback(
    async (event: SummaryActionEvent) => {
      const card = getSummaryShape(editor.getShape(event.shapeId));
      if (!card) return;
      if (!card.props.body || card.props.body.trim().length < 4) {
        toast.error("Nothing to pin yet — generate a summary first");
        return;
      }
      try {
        const r = await fetch(`/api/spaces/${spaceId}/pin-summary`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summaryId: card.props.summaryId,
            title: card.props.title,
            body: card.props.body,
            sourceCount: card.props.sourceCount,
            sourceLabel: card.props.sourceLabel,
            generatedAt: card.props.generatedAt,
          }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status}: ${txt.slice(0, 120)}`);
        }
        // Annotate the shape so the renderer can show a pinned badge
        // and the user gets persistent feedback across this session.
        const fresh = getSummaryShape(editor.getShape(card.id));
        if (fresh) {
          editor.updateShape<SummaryCardShape>({
            id: fresh.id,
            type: "summary-card",
            meta: { ...fresh.meta, pinned: true, pinnedAt: new Date().toISOString() },
          });
        }
        toast.success("Pinned to strategy");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Pin failed: ${message.slice(0, 80)}`);
      }
    },
    [editor, spaceId],
  );

  // ── Focus: invoked by the strategy-drawer's "Show on canvas" button
  // on a pinned synthesis row. Looks up the live shape with the
  // matching summaryId; zooms + selects if present, toasts otherwise.
  // (We deliberately don't recreate a deleted card here — the user
  // pinned it as data, the shape is just a viewing surface, and
  // recreating could confuse the lasso → fork lineage.)
  const handleFocus = useCallback(
    (summaryId: string) => {
      const matching = editor
        .getCurrentPageShapes()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find((s: any) => s.type === "summary-card" && s.props?.summaryId === summaryId);
      if (!matching) {
        toast.info("Pinned summary's card has been removed from the canvas");
        return;
      }
      editor.select(matching.id);
      editor.zoomToSelection({ animation: { duration: 320 } });
    },
    [editor],
  );

  // ── Unpinned: invoked when the user clicks Unpin in the strategy
  // drawer. Clears the local meta.pinned flag on the matching shape
  // (if still present) so the gold "📌 PINNED" badge disappears in
  // real time without requiring the canvas to re-fetch state.
  const handleUnpinned = useCallback(
    (summaryId: string) => {
      const matching = editor
        .getCurrentPageShapes()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find((s: any) => s.type === "summary-card" && s.props?.summaryId === summaryId);
      if (!matching) return;
      editor.updateShape({
        id: matching.id,
        type: "summary-card",
        meta: { ...matching.meta, pinned: false, pinnedAt: null },
      });
    },
    [editor],
  );

  useEffect(() => {
    function onAction(e: Event) {
      const detail = (e as CustomEvent<SummaryActionEvent>).detail;
      if (!detail || typeof detail !== "object") return;
      switch (detail.action) {
        case "regenerate":
          void handleRegenerate(detail);
          break;
        case "decompose":
          void handleDecompose(detail);
          break;
        case "pin":
          void handlePin(detail);
          break;
        // "zoom-source" is handled inline in the shape render — no
        // round-trip needed.
        default:
          break;
      }
    }
    function onFocus(e: Event) {
      const detail = (e as CustomEvent<{ summaryId?: string }>).detail;
      if (typeof detail?.summaryId === "string") handleFocus(detail.summaryId);
    }
    function onUnpinned(e: Event) {
      const detail = (e as CustomEvent<{ summaryId?: string }>).detail;
      if (typeof detail?.summaryId === "string") handleUnpinned(detail.summaryId);
    }
    window.addEventListener("summary-card:action", onAction);
    window.addEventListener("summary-card:focus", onFocus);
    window.addEventListener("summary-card:unpinned", onUnpinned);
    return () => {
      window.removeEventListener("summary-card:action", onAction);
      window.removeEventListener("summary-card:focus", onFocus);
      window.removeEventListener("summary-card:unpinned", onUnpinned);
    };
  }, [handleRegenerate, handleDecompose, handlePin, handleFocus, handleUnpinned]);

  return null;
}
