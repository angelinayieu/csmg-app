"use client";

// ── PreliminaryInsightsPanel ────────────────────────────────────────
//
// Surfaces topology-only insights (hubs, bridge candidates, isolated
// clusters, feedback loops) the moment Decompose finishes — no LLM
// cost, no server round-trip. Lets the user act on real structural
// patterns while the heavier research / synthesis stages run.
//
// Visibility logic:
//   - Shows once entities ≥ 5 and at least one signal exists.
//   - Hides automatically when synthesis_data populates (the LLM-
//     synthesized cards are richer; preliminary insights step aside).
//   - User can collapse/expand with the chip header.
//
// Click any insight row → pans + selects the relevant shape(s) on
// canvas using the deterministic kg-${entityId} shape ids that
// useSyncEntities + the painter both use.

import { useEffect, useState } from "react";
import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { Sparkles, ChevronDown, ChevronUp, Network, GitBranch, AlertTriangle, RefreshCcw } from "lucide-react";
import { usePreliminaryInsights } from "../hooks/use-preliminary-insights";
import type { Entity, Edge, Space } from "@/types";

interface PreliminaryInsightsPanelProps {
  editor: Editor | null;
  space: Space;
  entities: Entity[];
  edges: Edge[];
}

export function PreliminaryInsightsPanel({
  editor,
  space,
  entities,
  edges,
}: PreliminaryInsightsPanelProps) {
  const insights = usePreliminaryInsights(entities, edges);
  const [collapsed, setCollapsed] = useState(false);

  // When synthesis_data arrives, step aside — the synthesis cards are
  // richer and live on the canvas itself. We track presence not value
  // to avoid re-renders on every synthesis update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasSynthesis = !!(space as any)?.synthesis_data;

  // Auto-collapse a few seconds after synthesis arrives so the user
  // doesn't have to hunt for the X. They can still re-expand from the
  // header chip if they want.
  useEffect(() => {
    if (hasSynthesis) {
      const t = setTimeout(() => setCollapsed(true), 4000);
      return () => clearTimeout(t);
    }
  }, [hasSynthesis]);

  if (!insights) return null;
  const totalSignals =
    insights.hubs.length +
    insights.bridgeCandidates.length +
    insights.isolatedClusters.length +
    insights.feedbackLoops.length;
  if (totalSignals === 0) return null;

  return (
    <div className="pointer-events-auto fixed right-4 top-[160px] z-30 w-[320px]">
      <div className="overflow-hidden rounded-2xl border border-purple-100 bg-white/95 shadow-lg backdrop-blur-md">
        {/* Header — click to collapse/expand. */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-2 border-b border-purple-50 px-3.5 py-2.5 text-left transition-colors hover:bg-purple-50/40"
        >
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white">
            <Sparkles className="h-3 w-3" />
          </div>
          <div className="flex-1">
            <div className="text-[11.5px] font-semibold text-gray-900">
              Preliminary insights
            </div>
            <div className="text-[10px] text-gray-500">
              {totalSignals} structural signal{totalSignals === 1 ? "" : "s"} ·{" "}
              {hasSynthesis ? "superseded by synthesis" : "based on graph topology"}
            </div>
          </div>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          )}
        </button>

        {!collapsed && (
          <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
            {insights.hubs.length > 0 && (
              <Section
                title="Most-connected concepts"
                icon={Network}
                tint="blue"
              >
                {insights.hubs.map((hub) => (
                  <Row
                    key={hub.entityId}
                    label={hub.name}
                    detail={`${hub.degree} connection${hub.degree === 1 ? "" : "s"} · ${hub.outDegree} out, ${hub.inDegree} in`}
                    onClick={() => focusEntities(editor, [hub.entityId])}
                  />
                ))}
              </Section>
            )}

            {insights.bridgeCandidates.length > 0 && (
              <Section
                title="Bridge candidates"
                icon={GitBranch}
                tint="violet"
                hint="Pairs that share many neighbors but aren't directly connected"
              >
                {insights.bridgeCandidates.map((c) => (
                  <Row
                    key={`${c.aId}-${c.bId}`}
                    label={`${c.aName} ↔ ${c.bName}`}
                    detail={`${c.sharedNeighbors} shared neighbors · ${(c.jaccard * 100).toFixed(0)}% overlap`}
                    onClick={() => focusEntities(editor, [c.aId, c.bId])}
                  />
                ))}
              </Section>
            )}

            {insights.isolatedClusters.length > 0 && (
              <Section
                title="Isolated clusters"
                icon={AlertTriangle}
                tint="amber"
                hint="Sub-graphs disconnected from the main structure"
              >
                {insights.isolatedClusters.map((c, i) => (
                  <Row
                    key={i}
                    label={c.representativeName}
                    detail={`Cluster of ${c.size} entit${c.size === 1 ? "y" : "ies"}`}
                    onClick={() => focusEntities(editor, c.entityIds)}
                  />
                ))}
              </Section>
            )}

            {insights.feedbackLoops.length > 0 && (
              <Section
                title="Possible feedback loops"
                icon={RefreshCcw}
                tint="emerald"
                hint="Directed cycles — outputs feed back into inputs"
              >
                {insights.feedbackLoops.map((l, i) => (
                  <Row
                    key={i}
                    label={l.names.join(" → ")}
                    detail={`Length-${l.length} cycle`}
                    onClick={() => focusEntities(editor, l.entityIds)}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Internals ───────────────────────────────────────────────────────

function focusEntities(editor: Editor | null, entityIds: string[]) {
  if (!editor || entityIds.length === 0) return;
  const shapeIds: TLShapeId[] = [];
  for (const id of entityIds) {
    const sid = createShapeId(`kg-${id}`);
    const shape = editor.getShape(sid);
    if (shape) shapeIds.push(sid);
  }
  if (shapeIds.length === 0) return;
  try {
    editor.setSelectedShapes(shapeIds);
    // Union bounds for multi-shape focus.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sid of shapeIds) {
      const b = editor.getShapePageBounds(sid);
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX === Infinity) return;
    const PAD = 80;
    editor.zoomToBounds(
      { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 },
      { animation: { duration: 380 }, inset: 80 },
    );
  } catch (err) {
    console.warn("[preliminary-insights] focus failed:", err);
  }
}

interface SectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: "blue" | "violet" | "amber" | "emerald";
  hint?: string;
  children: React.ReactNode;
}

function Section({ title, icon: Icon, tint, hint, children }: SectionProps) {
  const tintBg =
    tint === "blue"
      ? "text-blue-600"
      : tint === "violet"
        ? "text-violet-600"
        : tint === "amber"
          ? "text-amber-600"
          : "text-emerald-600";
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">
        <Icon className={`h-2.5 w-2.5 ${tintBg}`} />
        {title}
        {hint && (
          <span
            className="ml-auto cursor-help text-[9px] font-medium normal-case tracking-normal text-gray-400"
            title={hint}
          >
            ⓘ
          </span>
        )}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

interface RowProps {
  label: string;
  detail: string;
  onClick: () => void;
}

function Row({ label, detail, onClick }: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-50"
    >
      <div className="truncate text-[11.5px] font-medium text-gray-900">{label}</div>
      <div className="truncate text-[10px] text-gray-500">{detail}</div>
    </button>
  );
}
