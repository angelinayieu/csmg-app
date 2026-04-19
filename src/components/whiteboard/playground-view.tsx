"use client";

// ── PlaygroundView ──
//
// Top-level playground layout:
//
//   ┌────────────────────────────────────────────┬──────────────────┐
//   │ breadcrumb                                 │                  │
//   ├────────────────────────────────────────────┤                  │
//   │                                            │  side panel:     │
//   │        empty / playground canvas           │  - entities      │
//   │        (user drops matches from            │  - patterns      │
//   │         side panel; draws connections)     │  - claims        │
//   │                                            │  - open questions│
//   │                                            │                  │
//   ├────────────────────────────────────────────┤                  │
//   │ dock: [text input] [deep research] [⚡]    │                  │
//   └────────────────────────────────────────────┴──────────────────┘
//
// State ownership:
//   - Playground owns the "user's in-progress text" + debounced detection call
//   - Canvas view owns the visible entity subset (user drops matches here)
//   - Position overrides pipe through useWhiteboardPositions so persistence
//     works identically to the overview
//
// Phase D MVP scope:
//   - Drop matched entities onto canvas
//   - See suggestions as you type
//   - Click questions to add them as sticky notes (future — Phase D+)
//   - Submit → creates a new entity. Currently this is stubbed: it adds the
//     text as a provisional in-memory node so the user can see it. Real
//     backend creation is deferred until Phase E / custom-decompose path.

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Layers, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { PlaygroundDock } from "./playground-dock";
import { PlaygroundSidePanel, type DetectionResult } from "./playground-side-panel";
import { useWhiteboardPositions } from "./use-whiteboard-positions";
import type { Entity } from "@/types";

const DEBOUNCE_MS = 500;
const PANEL_WIDTH = 340;

export function PlaygroundView() {
  const ctx = useSpaceData();

  // ── Playground local state ──
  // "dropped" = the subset of entities the user has pulled onto the playground canvas.
  // Users start with an empty canvas and add things one by one.
  const [droppedEntityIds, setDroppedEntityIds] = useState<Set<string>>(new Set());
  const [userText, setUserText] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // ── Detection state ──
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [detectionLoading, setDetectionLoading] = useState(false);
  const latestQueryRef = useRef<string>("");

  // ── Positions hook ──
  const { positions, setPosition, setManyPositions, resetAll } = useWhiteboardPositions(ctx.space.id);

  // ── Debounced detection API call ──
  useEffect(() => {
    const text = userText.trim();
    latestQueryRef.current = text;

    // Very short text: clear detection + don't call API
    if (text.length < 3) {
      setDetection(null);
      setDetectionLoading(false);
      return;
    }

    setDetectionLoading(true);
    const handle = setTimeout(async () => {
      // Bail if user has typed more since scheduling this call
      if (latestQueryRef.current !== text) return;

      try {
        const res = await fetch("/api/whiteboard/playground/detect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ space_id: ctx.space.id, text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DetectionResult;
        // Only apply if this is still the latest query
        if (latestQueryRef.current !== text) return;
        setDetection(json);
      } catch (err) {
        console.warn("[PlaygroundView] Detection failed:", err);
      } finally {
        if (latestQueryRef.current === text) setDetectionLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [userText, ctx.space.id]);

  // ── Adding an entity to the playground canvas ──
  const addEntityToPlayground = useCallback(
    (entity: Entity) => {
      setDroppedEntityIds((prev) => {
        if (prev.has(entity.id)) return prev;
        const next = new Set(prev);
        next.add(entity.id);
        return next;
      });
      // If no position has been assigned, place it near the canvas center
      // so it appears where the user can see it.
      if (!positions.has(entity.id)) {
        // Rough default spot — the canvas layout engine will handle layering
        // but we want adds to be visible.
        const randomOffset = droppedEntityIds.size * 40;
        setPosition(entity.id, 200 + randomOffset, 200 + (randomOffset % 120));
      }
    },
    [positions, setPosition, droppedEntityIds.size],
  );

  // ── Adding a pattern (as a virtual sticky-note entity) ──
  const addPatternToPlayground = useCallback(
    (pattern: DetectionResult["patterns"][number]["pattern"]) => {
      // Phase D MVP: patterns can't become real entities (they're global
      // library records, not space-scoped entities). We surface a toast
      // explaining this and suggest adding the matching entities instead.
      // A richer flow (Phase D+) would materialize a pattern reference
      // node on the canvas without persisting.
      console.log(
        "[PlaygroundView] Pattern selected (Phase D MVP surface-only):",
        pattern.canonical_tag,
      );
    },
    [],
  );

  const addQuestionToPlayground = useCallback(
    (q: DetectionResult["open_questions"][number]) => {
      console.log("[PlaygroundView] Question selected (Phase D+ wires stickies):", q.text);
    },
    [],
  );

  // ── Materialize state — Phase D+ ──
  // When the user hits Decompose + Connect, we call /materialize which creates
  // the entity + predicted edges in one LLM call. After success we refresh
  // space data, drop the new entity onto canvas, and show accept/reject
  // affordances on its predicted edges.
  const [materializing, setMaterializing] = useState(false);
  const [materializeError, setMaterializeError] = useState<string | null>(null);
  const [lastMaterialized, setLastMaterialized] = useState<{
    entityId: string;
    name: string;
    edgeIds: string[];
  } | null>(null);

  const onSubmit = useCallback(async () => {
    const text = userText.trim();
    if (text.length < 3 || materializing) return;

    setMaterializing(true);
    setMaterializeError(null);
    try {
      // Place the new entity near the center of the current viewport-adjacent canvas area
      const placement = {
        x: 300 + (droppedEntityIds.size % 4) * 280,
        y: 300 + Math.floor(droppedEntityIds.size / 4) * 180,
      };

      const res = await fetch("/api/whiteboard/playground/materialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ space_id: ctx.space.id, text, placement }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json() as {
        entity: { id: string; name: string };
        predicted_edges: Array<{ id: string }>;
      };

      // Refresh space data so the new entity + edges appear via context
      ctx.refresh();
      // Wait a beat for hydration
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Add to playground canvas + track as "just materialized"
      setDroppedEntityIds((prev) => {
        const next = new Set(prev);
        next.add(json.entity.id);
        return next;
      });
      setLastMaterialized({
        entityId: json.entity.id,
        name: json.entity.name,
        edgeIds: json.predicted_edges.map((e) => e.id),
      });

      // Clear the input for the next idea
      setUserText("");
    } catch (err) {
      console.error("[PlaygroundView] Materialize failed:", err);
      setMaterializeError(err instanceof Error ? err.message : "Failed to materialize");
    } finally {
      setMaterializing(false);
    }
  }, [userText, materializing, ctx, droppedEntityIds.size]);

  // ── Accept / reject handlers for predicted edges ──

  const removeEdgeIdFromLastMaterialized = useCallback((edgeId: string) => {
    setLastMaterialized((prev) => {
      if (!prev) return null;
      const remaining = prev.edgeIds.filter((id) => id !== edgeId);
      if (remaining.length === 0) return null; // all resolved; clear banner
      return { ...prev, edgeIds: remaining };
    });
  }, []);

  const onAcceptPredictedEdge = useCallback(
    async (edgeId: string) => {
      const res = await fetch(`/api/whiteboard/edges/${encodeURIComponent(edgeId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (!res.ok) throw new Error(`Accept failed: HTTP ${res.status}`);
      removeEdgeIdFromLastMaterialized(edgeId);
      ctx.refresh();
    },
    [ctx, removeEdgeIdFromLastMaterialized],
  );

  const onRejectPredictedEdge = useCallback(
    async (edgeId: string) => {
      const res = await fetch(`/api/whiteboard/edges/${encodeURIComponent(edgeId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      if (!res.ok) throw new Error(`Reject failed: HTTP ${res.status}`);
      removeEdgeIdFromLastMaterialized(edgeId);
      ctx.refresh();
    },
    [ctx, removeEdgeIdFromLastMaterialized],
  );

  // ── Filter entities/edges to the dropped subset ──
  const playgroundEntities = useMemo(
    () => ctx.entities.filter((e) => droppedEntityIds.has(e.id)),
    [ctx.entities, droppedEntityIds],
  );
  const playgroundEdges = useMemo(
    () => ctx.edges.filter((e) => droppedEntityIds.has(e.source_entity_id) && droppedEntityIds.has(e.target_entity_id)),
    [ctx.edges, droppedEntityIds],
  );

  const latestRef = useRef<Array<{ entity_id: string; x: number; y: number; width: number; height: number }>>([]);
  const onPlacementsChanged = useCallback(
    (placements: typeof latestRef.current) => {
      latestRef.current = placements;
    },
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white/85 backdrop-blur-sm px-5 py-3 z-20">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Link href={`/app/space/${ctx.space.id}/graph`} className="inline-flex items-center gap-1 hover:text-gray-700">
            <ArrowLeft className="h-3 w-3" />
            Back to space
          </Link>
          <span>/</span>
          <Link href={`/app/space/${ctx.space.id}/whiteboard`} className="hover:text-gray-700">
            Whiteboard
          </Link>
          <span>/</span>
          <span className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <FlaskConical className="h-3 w-3" />
            Playground
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <span>
            <span className="font-semibold text-gray-900">{droppedEntityIds.size}</span> on canvas
          </span>
          <span className="text-gray-400">/</span>
          <span>
            <span className="font-semibold text-gray-900">{ctx.entities.length}</span> in graph
          </span>
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900"
            title={panelOpen ? "Hide side panel" : "Show side panel"}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Materialize success banner */}
      {lastMaterialized && (
        <div className="border-b border-indigo-200 bg-indigo-50/70 px-5 py-2 flex items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center gap-2 text-indigo-800">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              Created <span className="font-semibold">{lastMaterialized.name}</span>
              {lastMaterialized.edgeIds.length > 0 && (
                <>
                  {" "}with <span className="font-semibold">{lastMaterialized.edgeIds.length}</span> suggested connection
                  {lastMaterialized.edgeIds.length === 1 ? "" : "s"} — review on canvas
                </>
              )}
            </span>
          </div>
          <button
            onClick={() => setLastMaterialized(null)}
            className="text-indigo-500 hover:text-indigo-800 text-[10px] font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Materialize error banner */}
      {materializeError && (
        <div className="border-b border-rose-200 bg-rose-50/70 px-5 py-2 flex items-center justify-between gap-3 text-[11px] text-rose-800">
          <div>Materialize failed: {materializeError}</div>
          <button
            onClick={() => setMaterializeError(null)}
            className="text-rose-500 hover:text-rose-800 text-[10px] font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main body */}
      <div className="flex-1 min-h-0 flex">
        {/* Canvas + dock (left) */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            {droppedEntityIds.size === 0 ? (
              <EmptyPlaygroundHint graphSize={ctx.entities.length} hasGraph={ctx.entities.length > 0} />
            ) : (
              <WhiteboardCanvas
                spaceId={ctx.space.id}
                entities={playgroundEntities}
                edges={playgroundEdges}
                positionOverrides={positions}
                onNodeMoved={setPosition}
                onResetPositions={resetAll}
                onPlacementsChanged={onPlacementsChanged}
                onAcceptPredictedEdge={onAcceptPredictedEdge}
                onRejectPredictedEdge={onRejectPredictedEdge}
              />
            )}
          </div>

          {/* Dock */}
          <PlaygroundDock
            value={userText}
            onChange={setUserText}
            onSubmit={onSubmit}
            deepResearch={deepResearch}
            onToggleDeepResearch={setDeepResearch}
            loading={detectionLoading || materializing}
          />
        </div>

        {/* Side panel (right) */}
        {panelOpen && (
          <div style={{ width: PANEL_WIDTH }} className="flex-shrink-0">
            <PlaygroundSidePanel
              loading={detectionLoading}
              userText={userText}
              detection={detection}
              onAddEntity={addEntityToPlayground}
              onAddPattern={addPatternToPlayground}
              onAddQuestion={addQuestionToPlayground}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty-state hint ──

function EmptyPlaygroundHint({ graphSize, hasGraph }: { graphSize: number; hasGraph: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-gray-500">
      <div className="relative mb-5">
        <FlaskConical className="h-12 w-12 text-indigo-300" />
        <Layers className="h-5 w-5 text-indigo-400 absolute -top-1 -right-2" />
      </div>
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Playground canvas</h2>
      <p className="max-w-md text-sm leading-relaxed">
        Start typing an idea in the dock below. As you write, relevant entities, patterns, and
        claims from {hasGraph ? "your graph" : "the space"} appear in the panel.
        Click any match to drop it onto the canvas, or hit{" "}
        <span className="font-mono px-1 py-0.5 bg-gray-100 rounded text-[11px]">Decompose + Connect</span>{" "}
        to materialize your text as a new entity.
      </p>
      {hasGraph && (
        <p className="mt-4 text-[11px] text-gray-400">
          Detection searches {graphSize} entities + the global pattern library.
        </p>
      )}
      {!hasGraph && (
        <p className="mt-4 text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 rounded">
          This space has no entities yet. Run decomposition first, or start typing and the playground will
          suggest matches once the graph has content.
        </p>
      )}
    </div>
  );
}
