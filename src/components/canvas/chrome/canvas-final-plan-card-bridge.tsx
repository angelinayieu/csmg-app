"use client";

// ── Canvas final-plan card bridge ──────────────────────────────────────
//
// Two responsibilities, kept in one file because they share the same
// `final-plan-card:*` event vocabulary and editor reference:
//
//   1. SPAWN — listens for `final-plan-card:spawn` (fired by the
//      strategy drawer's confirm handler) and drops a final-plan-card
//      shape on the canvas with the execution brief baked into props.
//      Idempotent on (spaceId, recommendationId) so repeated approves
//      regenerate the card body in place instead of stacking.
//
//   2. ACTIONS — listens for `final-plan-card:action` (fired by the
//      shape's header buttons + view-mode tabs) and:
//        - regenerate     → re-fetch brief, replace briefJson
//        - set-mode       → switch viewMode prop; for "flowchart"
//                           also fires the flowchart generator that
//                           paints arrow shapes near the card
//        - open-as-prd    → POST /api/spaces/[id]/reports + open
//                           /app/space/[id]/report/[id] in new tab
//        - open-strategy-drawer → set ?drawer=strategy in the URL
//
// We DON'T persist the card server-side. It lives as a tldraw shape;
// canvas-persistence preserves it across reloads. `briefJson` is the
// canonical body store. Server-side persistence (a `final_plans`
// table) is a follow-up if the UX needs cross-session listing.

import { useCallback, useEffect } from "react";
import { useEditor, createShapeId, type Editor, type TLShapeId, type TLArrowShape, type TLShapePartial, toRichText } from "tldraw";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/hooks/use-toast";
import {
  FINAL_PLAN_CARD_DEFAULT_W,
  FINAL_PLAN_CARD_DEFAULT_H,
} from "../shapes/final-plan-card-shape";
import type { FinalPlanCardShape } from "../shapes/types";
import type { ExecutionBrief } from "@/types/execution-brief";
import {
  ROOM_W,
  ROOM_GAP,
  ROOM_PADDING,
  STAGE_HEIGHT,
} from "@/lib/whiteboard/room-layout";

interface SpawnDetail {
  spaceId: string;
  recommendationId: string | null;
  source: "confirm" | "manual" | "regenerate";
}

interface ActionDetail {
  planId: string;
  shapeId: TLShapeId;
  action: "regenerate" | "open-as-prd" | "set-mode" | "open-strategy-drawer";
  payload?: { mode?: "prd" | "flowchart" | "prototype" | "summary" };
}

interface FinalPlanCardLikeShape {
  id: TLShapeId;
  type: "final-plan-card";
  x: number;
  y: number;
  props: FinalPlanCardShape["props"];
}

function getCard(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any,
): FinalPlanCardLikeShape | null {
  if (!raw || raw.type !== "final-plan-card") return null;
  return raw as FinalPlanCardLikeShape;
}

// ── Results Room helper ─────────────────────────────────────────────
//
// The "results" stage is the terminal band of the canvas unfurl. No
// pipeline route currently emits stage_boundary(results, ...) because
// confirm runs synchronously without an active SSE channel. To still
// deliver the visual loop closure (final-plan-card lives inside its
// own Room labeled "Results" / ⑥), the bridge creates the Room itself
// when it spawns the card.
//
// The painter's existing dedup logic (in upsertRoomForStage) will
// adopt this Room on next encounter — so a subsequent SSE-driven
// re-paint won't create a duplicate.
//
// Placement: directly below the lowest existing Room with ROOM_GAP
// breathing room, using the same horizontal alignment. If there are
// no Rooms on canvas (manual/regenerate-from-empty case), fall back
// to the viewport center.
interface RoomShapeLike {
  id: TLShapeId;
  x: number;
  y: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: any;
}

function ensureResultsRoom(
  editor: Editor,
  spaceId: string,
): { x: number; y: number; w: number; h: number } {
  // 1. Already exists? Adopt + return its bounds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (editor.getCurrentPageShapes() as ReadonlyArray<any>).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.type === "room" && s.props?.stage === "results",
  ) as RoomShapeLike | undefined;
  if (existing) {
    return {
      x: existing.x,
      y: existing.y,
      w: existing.props.w as number,
      h: existing.props.h as number,
    };
  }

  // 2. Compute placement. Prefer to land directly below the lowest
  //    existing room (so the cascade reads as continuous); fall back
  //    to viewport center when no rooms exist yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRooms = (editor.getCurrentPageShapes() as ReadonlyArray<any>).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.type === "room",
  ) as RoomShapeLike[];

  // Results Room needs to fit a 460-tall final-plan-card. Use the
  // intrinsic height for the stage (STAGE_HEIGHT.results = 320) when
  // we're confident the card auto-resize will catch up; for the
  // bridge path where we paint card immediately, oversize so the
  // card lands inside the room without auto-resize lag.
  const resultsH = Math.max(
    STAGE_HEIGHT.results,
    ROOM_PADDING.top + 16 + FINAL_PLAN_CARD_DEFAULT_H + ROOM_PADDING.bottom,
  );

  let topY: number;
  let centerX: number;
  if (allRooms.length > 0) {
    const lowest = allRooms.reduce((acc, s) =>
      s.y + (s.props.h as number) > acc.y + (acc.props.h as number) ? s : acc,
    );
    topY = lowest.y + (lowest.props.h as number) + ROOM_GAP;
    centerX = lowest.x + (lowest.props.w as number) / 2;
  } else {
    const vp = editor.getViewportPageBounds();
    centerX = vp.x + vp.w / 2;
    // Center the Room vertically on the viewport so the user sees it
    // even when no other rooms have been painted (e.g. confirm-from-
    // history case).
    topY = vp.y + vp.h / 2 - resultsH / 2;
  }

  const bounds = {
    x: centerX - ROOM_W / 2,
    y: topY,
    w: ROOM_W,
    h: resultsH,
  };

  const id = createShapeId();
  try {
    editor.createShape({
      id,
      type: "room",
      x: bounds.x,
      y: bounds.y,
      props: {
        w: bounds.w,
        h: bounds.h,
        stage: "results",
        state: "active",
        subtitle: "Final synthesis…",
        pulse: 0,
        spawnedAt: Date.now(),
        spaceId,
      },
      meta: { source: "final-plan-card-bridge:room" },
    });
    editor.sendToBack([id]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[final-plan-card-bridge] results Room create failed:", err);
  }

  return bounds;
}

/**
 * Compute the placement for a final-plan-card inside the results
 * Room — centered horizontally, ROOM_PADDING.top + 16 below the
 * room header.
 */
function placeCardInResultsRoom(
  bounds: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  return {
    x: bounds.x + bounds.w / 2 - FINAL_PLAN_CARD_DEFAULT_W / 2,
    y: bounds.y + ROOM_PADDING.top + 16,
  };
}

interface BriefFetchInput {
  spaceId: string;
  recommendationId: string;
  recommendationTitle: string;
  recommendationText: string;
  relatedEntityIds?: string[];
}

async function fetchExecutionBrief(input: BriefFetchInput): Promise<{
  brief: ExecutionBrief;
  evidenceCount: number;
  confidence: "high" | "moderate" | "low";
}> {
  const res = await fetch("/api/pipeline/execution-brief", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      spaceId: input.spaceId,
      recommendationType: "strategy",
      recommendationId: input.recommendationId,
      recommendationTitle: input.recommendationTitle,
      recommendationText: input.recommendationText,
      relatedEntityIds: input.relatedEntityIds ?? [],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as { brief?: ExecutionBrief };
  if (!data.brief) throw new Error("Empty brief response");
  return {
    brief: data.brief,
    evidenceCount: data.brief.research_backing?.evidence_sources?.length ?? 0,
    confidence: data.brief.research_backing?.confidence ?? "moderate",
  };
}

// Resolve the active strategy's title + summary from the space data.
// If we don't have it (the spawn fired before the spaces row was
// re-fetched, e.g.), fall back to a placeholder. The card itself
// will refresh from the brief response so the placeholder is
// transient.
async function fetchActiveStrategyMeta(spaceId: string): Promise<{
  recommendationId: string;
  title: string;
  text: string;
}> {
  try {
    const r = await fetch(`/api/spaces/${spaceId}/twin-proposal`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as {
      ranked_strategies?: Array<{
        rank?: number;
        is_primary?: boolean;
        recommendation_id?: string | null;
        title?: string | null;
        summary?: string | null;
      }>;
      // Fallback shape — older response format.
      strategy?: { title?: string; summary?: string; id?: string };
    };
    const primary =
      data.ranked_strategies?.find((s) => s.is_primary || s.rank === 1) ??
      data.ranked_strategies?.[0];
    if (primary) {
      return {
        recommendationId: primary.recommendation_id ?? primary.title ?? "strategy",
        title: primary.title ?? "Strategy",
        text: primary.summary ?? "",
      };
    }
    if (data.strategy) {
      return {
        recommendationId: data.strategy.id ?? data.strategy.title ?? "strategy",
        title: data.strategy.title ?? "Strategy",
        text: data.strategy.summary ?? "",
      };
    }
  } catch {
    /* fall through */
  }
  return {
    recommendationId: "strategy",
    title: "Final plan",
    text: "",
  };
}

export function CanvasFinalPlanCardBridge({ spaceId: _spaceId }: { spaceId: string }) {
  const editor = useEditor();
  const router = useRouter();

  // ── SPAWN ─────────────────────────────────────────────────────────
  const handleSpawn = useCallback(
    async (detail: SpawnDetail) => {
      if (!editor) return;
      // Resolve recommendation meta.
      const meta = detail.recommendationId
        ? { recommendationId: detail.recommendationId, title: "Final plan", text: "" }
        : await fetchActiveStrategyMeta(detail.spaceId);

      // Idempotent: if a card already exists for this recommendation,
      // mark it regenerating, refresh the brief, replace briefJson.
      const existing = editor
        .getCurrentPageShapes()
        .map(getCard)
        .find(
          (c): c is FinalPlanCardLikeShape =>
            c !== null && c.props.recommendationId === meta.recommendationId,
        );

      if (existing) {
        editor.updateShape<FinalPlanCardShape>({
          id: existing.id,
          type: "final-plan-card",
          props: { ...existing.props, status: "regenerating" },
        });
        try {
          const { brief, evidenceCount, confidence } = await fetchExecutionBrief({
            spaceId: detail.spaceId,
            recommendationId: meta.recommendationId,
            recommendationTitle: meta.title,
            recommendationText: meta.text,
          });
          editor.updateShape<FinalPlanCardShape>({
            id: existing.id,
            type: "final-plan-card",
            props: {
              ...existing.props,
              briefJson: JSON.stringify(brief),
              evidenceCount,
              confidence,
              status: "fresh",
              errorMessage: null,
              generatedAt: new Date().toISOString(),
            },
          });
          toast.success("Final plan refreshed");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          editor.updateShape<FinalPlanCardShape>({
            id: existing.id,
            type: "final-plan-card",
            props: {
              ...existing.props,
              status: "error",
              errorMessage: message.slice(0, 200),
            },
          });
          toast.error(`Final plan refresh failed: ${message.slice(0, 80)}`);
        }
        return;
      }

      // Brand-new card: ensure a "Results" Room exists (created here
      // because the confirm action runs synchronously without an SSE
      // channel — no stage_boundary event reaches the painter), then
      // place the card centered inside it. This closes the visual
      // unfurl loop: intake → landscape → kg → proposal → lab →
      // results, with the final-plan-card living in its own dedicated
      // band of the cascade.
      const roomBounds = ensureResultsRoom(editor, detail.spaceId);
      const placement = placeCardInResultsRoom(roomBounds);

      const planId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const cardId = createShapeId(`shape:final-plan-${planId.slice(0, 12)}`);

      try {
        editor.createShape<FinalPlanCardShape>({
          id: cardId,
          type: "final-plan-card",
          x: placement.x,
          y: placement.y,
          props: {
            w: FINAL_PLAN_CARD_DEFAULT_W,
            h: FINAL_PLAN_CARD_DEFAULT_H,
            planId,
            spaceId: detail.spaceId,
            recommendationId: meta.recommendationId,
            title: meta.title,
            viewMode: "prd",
            briefJson: "",
            evidenceCount: 0,
            confidence: null,
            status: "regenerating",
            errorMessage: null,
            generatedAt: new Date().toISOString(),
          },
          meta: { source: "final-plan-card:spawn" },
        });
        editor.select(cardId);
      } catch (err) {
        toast.error(
          `Couldn't drop final plan card: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
        );
        return;
      }

      // Now fetch the brief and update the card's body.
      try {
        const { brief, evidenceCount, confidence } = await fetchExecutionBrief({
          spaceId: detail.spaceId,
          recommendationId: meta.recommendationId,
          recommendationTitle: meta.title,
          recommendationText: meta.text,
        });
        editor.updateShape<FinalPlanCardShape>({
          id: cardId,
          type: "final-plan-card",
          props: {
            w: FINAL_PLAN_CARD_DEFAULT_W,
            h: FINAL_PLAN_CARD_DEFAULT_H,
            planId,
            spaceId: detail.spaceId,
            recommendationId: meta.recommendationId,
            title: meta.title,
            viewMode: "prd",
            briefJson: JSON.stringify(brief),
            evidenceCount,
            confidence,
            status: "fresh",
            errorMessage: null,
            generatedAt: new Date().toISOString(),
          },
        });
        toast.success("Final plan ready");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        editor.updateShape<FinalPlanCardShape>({
          id: cardId,
          type: "final-plan-card",
          props: {
            w: FINAL_PLAN_CARD_DEFAULT_W,
            h: FINAL_PLAN_CARD_DEFAULT_H,
            planId,
            spaceId: detail.spaceId,
            recommendationId: meta.recommendationId,
            title: meta.title,
            viewMode: "prd",
            briefJson: "",
            evidenceCount: 0,
            confidence: null,
            status: "error",
            errorMessage: message.slice(0, 200),
            generatedAt: new Date().toISOString(),
          },
        });
        toast.error(`Brief generation failed: ${message.slice(0, 80)}`);
      }
    },
    [editor],
  );

  // ── ACTIONS ───────────────────────────────────────────────────────
  const handleSetMode = useCallback(
    async (
      card: FinalPlanCardLikeShape,
      mode: "prd" | "flowchart" | "prototype" | "summary",
    ) => {
      if (!editor) return;
      // Update the prop first so the body re-renders into the new
      // mode immediately. The flowchart side-effect runs after.
      editor.updateShape<FinalPlanCardShape>({
        id: card.id,
        type: "final-plan-card",
        props: { ...card.props, viewMode: mode },
      });

      if (mode !== "flowchart") return;
      if (!card.props.briefJson) {
        toast.info("Generate the PRD first — flowchart needs the steps.");
        return;
      }

      // Call the flowchart endpoint to materialize per-step shapes.
      try {
        const r = await fetch(
          `/api/spaces/${card.props.spaceId}/final-plan-flowchart`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recommendationId: card.props.recommendationId,
              briefJson: card.props.briefJson,
            }),
          },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as {
          steps: Array<{ order: number; title: string; detail: string }>;
        };
        paintFlowchart(card, data.steps);
        toast.success(`Flowchart painted · ${data.steps.length} steps`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Flowchart failed: ${message.slice(0, 80)}`);
      }
    },
    [editor],
  );

  const paintFlowchart = useCallback(
    (
      card: FinalPlanCardLikeShape,
      steps: Array<{ order: number; title: string; detail: string }>,
    ) => {
      if (!editor || steps.length === 0) return;
      // Fan steps out to the right of the card in a vertical column.
      // Each step is a sticky-note (cheap reuse — we already have the
      // shape util and auto-decompose can pick them up if the user
      // wants to convert to entities). Tag with meta.flowchartFor =
      // recommendationId so we can clean up + re-paint on regen.
      const cardRight = card.x + card.props.w + 60;
      const stepW = 220;
      const stepH = 90;
      const stepGap = 18;
      const arrowMeta = {
        source: "final-plan-flowchart",
        flowchartFor: card.props.recommendationId,
      };

      const stepShapeIds: TLShapeId[] = [];
      // Remove any prior flowchart shapes for this recommendation
      // so a re-paint replaces instead of stacks.
      const stale = editor
        .getCurrentPageShapes()
        .filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s: any) =>
            s.meta?.flowchartFor === card.props.recommendationId,
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((s: any) => s.id as TLShapeId);
      if (stale.length) editor.deleteShapes(stale);

      try {
        steps.forEach((step, i) => {
          const id = createShapeId();
          editor.createShape({
            id,
            type: "sticky-note",
            x: cardRight,
            y: card.y + i * (stepH + stepGap),
            props: {
              w: stepW,
              h: stepH,
              text: `${step.order}. ${step.title}\n\n${step.detail.slice(0, 100)}`,
              color: "blue",
              dimension: null,
              aiTagged: true,
              entityId: null,
            },
            meta: arrowMeta,
          });
          stepShapeIds.push(id);
        });

        // Connect adjacent steps with arrows.
        for (let i = 0; i < stepShapeIds.length - 1; i++) {
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
            meta: arrowMeta,
          };
          editor.createShapes([arrow]);
          editor.createBindings([
            {
              fromId: arrowId,
              toId: stepShapeIds[i],
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
              toId: stepShapeIds[i + 1],
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
        }
        // Connector from card → first step.
        if (stepShapeIds.length > 0) {
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
            meta: arrowMeta,
          };
          editor.createShapes([arrow]);
          editor.createBindings([
            {
              fromId: arrowId,
              toId: card.id,
              type: "arrow",
              props: {
                terminal: "start",
                normalizedAnchor: { x: 1, y: 0.5 },
                isExact: false,
                isPrecise: false,
              },
              meta: {},
            },
            {
              fromId: arrowId,
              toId: stepShapeIds[0],
              type: "arrow",
              props: {
                terminal: "end",
                normalizedAnchor: { x: 0, y: 0.5 },
                isExact: false,
                isPrecise: false,
              },
              meta: {},
            },
          ]);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[final-plan-flowchart] paint failed:", err);
      }
    },
    [editor],
  );

  const handleAction = useCallback(
    async (detail: ActionDetail) => {
      if (!editor) return;
      const card = getCard(editor.getShape(detail.shapeId));
      if (!card) return;

      switch (detail.action) {
        case "regenerate":
          await handleSpawn({
            spaceId: card.props.spaceId,
            recommendationId: card.props.recommendationId,
            source: "regenerate",
          });
          break;
        case "set-mode": {
          const mode = detail.payload?.mode;
          if (!mode) {
            // Re-trigger flowchart paint when the same tab is
            // re-clicked; same-mode no-op otherwise.
            if (card.props.viewMode === "flowchart") {
              await handleSetMode(card, "flowchart");
            }
            return;
          }
          await handleSetMode(card, mode);
          break;
        }
        case "open-as-prd": {
          // Stub: future integration with /api/reports route. For now
          // we navigate to the strategy drawer's deliverables view —
          // same content, different surface.
          router.push(`/app/space/${card.props.spaceId}/strategy?tab=deliverables`);
          break;
        }
        case "open-strategy-drawer": {
          // Set ?drawer=strategy on the current URL so the drawer
          // opens above whatever page the user is on.
          const url = new URL(window.location.href);
          url.searchParams.set("drawer", "strategy");
          router.replace(url.pathname + url.search);
          break;
        }
      }
    },
    [editor, handleSpawn, handleSetMode, router],
  );

  useEffect(() => {
    function onSpawn(e: Event) {
      const detail = (e as CustomEvent<SpawnDetail>).detail;
      if (typeof detail?.spaceId === "string") void handleSpawn(detail);
    }
    function onAction(e: Event) {
      const detail = (e as CustomEvent<ActionDetail>).detail;
      if (detail && typeof detail === "object") void handleAction(detail);
    }
    window.addEventListener("final-plan-card:spawn", onSpawn);
    window.addEventListener("final-plan-card:action", onAction);
    return () => {
      window.removeEventListener("final-plan-card:spawn", onSpawn);
      window.removeEventListener("final-plan-card:action", onAction);
    };
  }, [handleSpawn, handleAction]);

  return null;
}
