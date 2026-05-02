"use client";

// ── Canvas lasso → AI Summarize button ──
//
// Floating chrome that appears whenever the user has selected ≥ 2
// shapes carrying extractable content (entity, sticky, strategy, app,
// proposal, etc. — see lib/canvas/extract-shape-content.ts for the
// full registry). Clicking the button:
//
//   1. Snapshots the selection through `extractShapeContent()`
//   2. POSTs the items to `/api/spaces/[id]/lasso-summarize`
//   3. On success, creates a `summary-card` shape positioned below the
//      selection's bbox center, plus N tldraw `arrow` shapes bound
//      from each source to the summary card. Arrows are tagged with
//      `meta.summarySourceFor: summaryId` so the canvas root can fade
//      them when the owning summary card isn't selected.
//
// Sits next to the existing CanvasLassoSystemButton (same top-right
// region). The two are mutually visible — both show whenever the
// selection qualifies — because their actions are different (one
// persists a System graph object, the other generates a summary).

import { useCallback, useMemo, useState } from "react";
import { useEditor, useValue, createShapeId, type TLShapeId, type TLArrowShape, type TLShapePartial, toRichText } from "tldraw";
import { Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { extractShapeContent, describeSelection, type ExtractedSelection } from "@/lib/canvas/extract-shape-content";
import type { SummaryCardShape } from "../shapes/types";

interface Props {
  spaceId: string;
}

const MIN_SHAPES_TO_SUMMARIZE = 2;
const SUMMARY_CARD_W = 360;
const SUMMARY_CARD_H = 220;

export function CanvasLassoSummarizeButton({ spaceId }: Props) {
  const editor = useEditor();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Recompute on selection change. We deliberately memoize the whole
  // extraction result rather than just the shape ids — it's cheap (N
  // shapes selected, not N on canvas) and downstream UI wants the
  // counts/label too.
  const extracted = useValue<ExtractedSelection>(
    "lasso-summarize-extract",
    () => extractShapeContent(editor?.getSelectedShapes() ?? []),
    [editor],
  );

  const onSummarize = useCallback(async () => {
    if (!extracted.summarizable || extracted.items.length < MIN_SHAPES_TO_SUMMARIZE) return;
    if (state === "saving" || !editor) return;
    setState("saving");
    setErrorMsg(null);

    // Capture the placement target up-front — if the user moves the
    // selection or deselects mid-call, we still want the summary to
    // land in the spot they intended. Place 80px below the bbox center
    // (vertically) and centered horizontally on the selection.
    const sb = extracted.selectionBounds!;
    const summaryX = sb.x + sb.w / 2 - SUMMARY_CARD_W / 2;
    const summaryY = sb.y + sb.h + 80;
    const sourceShapeIds = extracted.items.map((it) => it.shapeId);
    const sourceLabel = describeSelection(extracted);
    const summaryId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const r = await fetch(`/api/spaces/${spaceId}/lasso-summarize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summaryId,
          sourceLabel,
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

      // ── Place the summary card + connector arrows ────────────────
      const cardId = createShapeId(`shape:summary-${summaryId.slice(0, 12)}`);
      const cardShape: TLShapePartial<SummaryCardShape> = {
        id: cardId,
        type: "summary-card",
        x: summaryX,
        y: summaryY,
        props: {
          w: SUMMARY_CARD_W,
          h: SUMMARY_CARD_H,
          summaryId,
          kind: "summary",
          title: data.title || "AI Summary",
          body: data.body || "",
          sourceShapeIds,
          sourceCount: sourceShapeIds.length,
          sourceLabel,
          status: "fresh",
          errorMessage: null,
          generatedAt: data.generatedAt ?? new Date().toISOString(),
        },
        meta: { source: "lasso-summarize", summaryId },
      };
      editor.createShapes([cardShape]);

      // Bind arrows from each source → the summary card. We reuse the
      // pattern from pipeline-event-painter.tetherBetween: solid grey
      // elbow arrows, single end-head, sans font (we don't label
      // these so it doesn't matter, but keeping the convention).
      const arrowIds: TLShapeId[] = [];
      for (const sid of sourceShapeIds) {
        try {
          const arrowId = createShapeId();
          const arrow: TLShapePartial<TLArrowShape> = {
            id: arrowId,
            type: "arrow",
            props: {
              color: "grey",
              size: "s",
              font: "sans",
              dash: "solid",
              kind: "elbow",
              arrowheadStart: "none",
              arrowheadEnd: "arrow",
              richText: toRichText(""),
            },
            meta: {
              source: "lasso-summarize",
              summarySourceFor: summaryId,
            },
          };
          editor.createShapes([arrow]);
          editor.createBindings([
            {
              fromId: arrowId,
              toId: sid as TLShapeId,
              type: "arrow",
              props: {
                terminal: "start",
                normalizedAnchor: { x: 0.5, y: 1 },
                isExact: false,
                isPrecise: false,
              },
              meta: {},
            },
            {
              fromId: arrowId,
              toId: cardId,
              type: "arrow",
              props: {
                terminal: "end",
                normalizedAnchor: { x: 0.5, y: 0 },
                isExact: false,
                isPrecise: false,
              },
              meta: {},
            },
          ]);
          arrowIds.push(arrowId);
        } catch (err) {
          // Per-arrow failure shouldn't break the whole card. Log and
          // keep going — the card itself still lands and lists its
          // sources in the footer.
          // eslint-disable-next-line no-console
          console.warn("[lasso-summarize] arrow bind failed:", err);
        }
      }

      // Surface a brief "saved" state, then return to idle. We also
      // select the new summary card so the user immediately sees the
      // result in tldraw's Properties panel and the arrows light up
      // (un-fade) per the meta-keyed CSS rule.
      editor.select(cardId);
      setState("saved");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
      setState("error");
      window.setTimeout(() => setState("idle"), 2800);
    }
  }, [editor, extracted, spaceId, state]);

  // Render rules — bail entirely when the selection is too small or
  // has no extractable content. We require ≥ 2 shapes because
  // "summarize one shape" is a no-op (and tldraw single-select happens
  // constantly while the user is just clicking around).
  const showButton = useMemo(() => {
    return (
      extracted.summarizable && extracted.items.length >= MIN_SHAPES_TO_SUMMARIZE
    );
  }, [extracted.summarizable, extracted.items.length]);

  if (!showButton) return null;

  const label = describeSelection(extracted);
  const count = extracted.items.length;

  return (
    <div
      // Top-right area, BELOW the topbar; sits to the LEFT of the
      // CanvasLassoSystemButton (which uses right-12). We use right-44
      // so both buttons are visible side-by-side without overlapping.
      className="pointer-events-none absolute right-44 top-3 z-[45]"
      role="region"
      aria-label="Summarize selection with AI"
    >
      <button
        type="button"
        onClick={onSummarize}
        disabled={state === "saving"}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-md transition",
          state === "saved"
            ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
            : state === "error"
              ? "border-rose-200 bg-rose-50/95 text-rose-700"
              : state === "saving"
                ? "cursor-wait border-violet-200 bg-white/95 text-violet-500"
                : "border-violet-300 bg-white/95 text-violet-700 hover:bg-violet-50",
        )}
        title={
          state === "error"
            ? `Summarize failed: ${errorMsg ?? "unknown"}`
            : `Summarize ${count} item${count === 1 ? "" : "s"} with AI · ${label}`
        }
      >
        {state === "saving" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === "saved" ? (
          <Check className="h-3 w-3" />
        ) : state === "error" ? (
          <AlertCircle className="h-3 w-3" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {state === "saved"
          ? "Summarized"
          : state === "error"
            ? "Failed"
            : state === "saving"
              ? `Summarizing ${count}…`
              : `Summarize ${count}`}
        {state === "idle" && (
          <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700">
            {label.length > 24 ? `${label.slice(0, 22)}…` : label}
          </span>
        )}
      </button>
    </div>
  );
}
