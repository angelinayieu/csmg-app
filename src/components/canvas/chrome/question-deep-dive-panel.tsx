"use client";

// ── QuestionDeepDivePanel ──────────────────────────────────────────
//
// Opens when the user clicks a probe question in the BrainstormPanel
// instead of appending it to the sticky. Shows:
//   1. The root question + original sticky context
//   2. A streaming-style AI answer
//   3. 4 sub-questions the user can expand (loads their own answer +
//      sub-sub-questions on demand — two levels deep)
//   4. Checkboxes to select questions / answers for planting
//
// Footer actions:
//   "Plant N"  — creates sticky notes radially around the origin shape
//   "Add to KG" — materializes selected content into the knowledge graph
//
// The panel occupies the same right-rail slot as BrainstormPanel
// (right-4, top-72) and slides over it. Back arrow returns to the
// brainstorm panel.

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  Check,
  Sprout,
  Sparkles,
  GitBranch,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import type { Editor, TLShapeId } from "tldraw";
import { createShapeId } from "tldraw";

// ── Types ──────────────────────────────────────────────────────────

type NodeStatus = "loading" | "ready" | "error";

interface SubQuestionNode {
  question: string;
  selected: boolean;
  expanded: boolean;
  status: NodeStatus;
  answer: string;
  subSubQuestions: string[];
}

export interface QuestionDeepDivePanelProps {
  question: string;
  /** The original sticky note text — used as context for the LLM. */
  context: string;
  spaceId: string;
  editor: Editor | null;
  /** Shape id of the sticky note the question came from — used for canvas placement. */
  originShapeId: string | null;
  relatedEntityNames?: string[];
  onBack: () => void;
  /** Called with the combined selected text when "Add to KG" is pressed. */
  onMaterialize?: (text: string) => void;
}

const ACCENT = "#8B5CF6";

// ── Panel ──────────────────────────────────────────────────────────

export function QuestionDeepDivePanel({
  question,
  context,
  spaceId,
  editor,
  originShapeId,
  relatedEntityNames = [],
  onBack,
  onMaterialize,
}: QuestionDeepDivePanelProps) {
  const [rootStatus, setRootStatus] = useState<NodeStatus>("loading");
  const [answer, setAnswer] = useState("");
  const [subQuestions, setSubQuestions] = useState<SubQuestionNode[]>([]);
  const [planting, setPlanting] = useState(false);
  const loadedRef = useRef(false);

  // ── Load root answer + sub-questions on mount ──────────────────
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    async function load() {
      try {
        const res = await fetch("/api/canvas/deep-dive", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            question,
            context,
            relatedEntityNames,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          answer: string;
          subQuestions: string[];
        };
        setAnswer(data.answer ?? "");
        setSubQuestions(
          (data.subQuestions ?? []).map((q) => ({
            question: q,
            selected: false,
            expanded: false,
            status: "ready" as NodeStatus,
            answer: "",
            subSubQuestions: [],
          })),
        );
        setRootStatus("ready");
      } catch {
        setRootStatus("error");
      }
    }
    load();
  }, [question, context, spaceId, relatedEntityNames]);

  // ── Expand/collapse a sub-question ────────────────────────────
  const handleExpand = useCallback(
    async (idx: number) => {
      const node = subQuestions[idx];
      if (!node) return;

      if (node.expanded) {
        setSubQuestions((prev) =>
          prev.map((n, i) => (i === idx ? { ...n, expanded: false } : n)),
        );
        return;
      }

      // Already fetched — just show
      if (node.answer) {
        setSubQuestions((prev) =>
          prev.map((n, i) => (i === idx ? { ...n, expanded: true } : n)),
        );
        return;
      }

      // Fetch
      setSubQuestions((prev) =>
        prev.map((n, i) =>
          i === idx ? { ...n, expanded: true, status: "loading" } : n,
        ),
      );

      try {
        const res = await fetch("/api/canvas/deep-dive", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            question: node.question,
            // Use the root answer as context for the sub-question
            context: answer || context,
            relatedEntityNames,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          answer: string;
          subQuestions: string[];
        };
        setSubQuestions((prev) =>
          prev.map((n, i) =>
            i === idx
              ? {
                  ...n,
                  status: "ready",
                  answer: data.answer ?? "",
                  subSubQuestions: data.subQuestions ?? [],
                }
              : n,
          ),
        );
      } catch {
        setSubQuestions((prev) =>
          prev.map((n, i) =>
            i === idx ? { ...n, status: "error" } : n,
          ),
        );
      }
    },
    [subQuestions, spaceId, answer, context, relatedEntityNames],
  );

  const toggleSelect = useCallback((idx: number) => {
    setSubQuestions((prev) =>
      prev.map((n, i) =>
        i === idx ? { ...n, selected: !n.selected } : n,
      ),
    );
  }, []);

  const selectedCount = subQuestions.filter((n) => n.selected).length;

  // ── Plant selected questions as stickies on canvas ────────────
  const handlePlant = useCallback(async () => {
    if (!editor || !originShapeId || selectedCount === 0) return;
    setPlanting(true);

    const originShape = editor.getShape(originShapeId as TLShapeId);
    const originX = (originShape?.x ?? 0) as number;
    const originY = (originShape?.y ?? 0) as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (originShape as any)?.props ?? {};
    const originW = (props.w as number | undefined) ?? 200;
    const originH = (props.h as number | undefined) ?? 200;

    const selectedNodes = subQuestions.filter((n) => n.selected);
    const count = selectedNodes.length;
    const radius = 320;

    // Fan out below the origin sticky. Spread angle grows with count,
    // capped at 160° so outer cards stay reachable.
    const spreadDeg = Math.min(count * 35, 160);
    const startDeg = -spreadDeg / 2;

    const newShapes = selectedNodes.map((node, i) => {
      const deg =
        count === 1 ? 0 : startDeg + (i / (count - 1)) * spreadDeg;
      // Rotate so 0° = straight down (below the origin)
      const rad = ((deg + 90) * Math.PI) / 180;

      const stickyText = node.answer
        ? `${node.question}\n\n${node.answer}`
        : node.question;

      return {
        id: createShapeId(),
        type: "sticky-note" as const,
        x: Math.round(
          originX + originW / 2 + Math.cos(rad) * radius - 100,
        ),
        y: Math.round(originY + originH + 40 + Math.sin(rad) * radius),
        props: {
          text: stickyText,
          color: "blue" as const,
          w: 200,
          h: 200,
          aiTagged: false,
          entityId: null,
          dimension: "question" as const,
        },
      };
    });

    editor.createShapes(newShapes);

    // Path A.1 — draw provenance arrows from the origin sticky out to
    // each planted sub-question. Without these the planted cards float
    // free and the user loses the "this came from that" relationship.
    // Pattern + props mirror placeMaterializedEntity's link-arrow in
    // interaxis-canvas.tsx (light-violet dotted, anchored center-to-
    // center, soft-fail on binding errors so a single bad shape doesn't
    // abort the whole plant batch).
    for (const newShape of newShapes) {
      try {
        const linkArrowId = createShapeId();
        editor.createShapes([
          {
            id: linkArrowId,
            type: "arrow",
            props: { color: "light-violet", size: "s", dash: "dotted" },
          },
        ]);
        editor.createBindings([
          {
            fromId: linkArrowId,
            toId: originShapeId as TLShapeId,
            type: "arrow",
            props: {
              terminal: "start",
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isExact: false,
              isPrecise: false,
            },
            meta: {},
          },
          {
            fromId: linkArrowId,
            toId: newShape.id,
            type: "arrow",
            props: {
              terminal: "end",
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isExact: false,
              isPrecise: false,
            },
            meta: {},
          },
        ]);
      } catch {
        // Non-fatal — selection feedback below still works without arrows.
      }
    }

    editor.select(...(newShapes.map((s) => s.id) as TLShapeId[]));
    setPlanting(false);
  }, [editor, originShapeId, selectedCount, subQuestions]);

  // ── Add selected content to KG ────────────────────────────────
  const handleAddToKG = useCallback(() => {
    const selected = subQuestions.filter((n) => n.selected);
    if (selected.length === 0) return;
    const combined = [
      context,
      ...selected.map((n) =>
        n.answer ? `${n.question}\n${n.answer}` : n.question,
      ),
    ].join("\n\n");
    onMaterialize?.(combined);
    onBack();
  }, [subQuestions, context, onMaterialize, onBack]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div
      className="pointer-events-auto absolute right-4 z-30"
      style={{ top: 72, maxHeight: "calc(100vh - 88px)" }}
    >
      <GlassPanel
        tier="float"
        radius={16}
        accent={ACCENT}
        className="flex w-[320px] flex-col overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-start gap-2 px-3 py-3"
          style={{ borderBottom: "1px solid var(--glass-hairline)" }}
        >
          <button
            onClick={onBack}
            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="Back to companion"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1">
            <div
              className="mb-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em]"
              style={{ color: ACCENT }}
            >
              Deep dive
            </div>
            <div className="text-[11.5px] font-semibold leading-snug text-gray-900 line-clamp-3">
              {question}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-3 overflow-y-auto px-3 py-3">
          {/* Root answer */}
          <SectionLabel icon={<Sparkles className="h-3 w-3 text-purple-400" />} label="Answer" gradient="from-purple-50 to-blue-50" />
          {rootStatus === "loading" ? (
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 shadow-sm">
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                style={{ color: ACCENT }}
              />
              <span className="text-[11.5px] text-gray-400">Thinking…</span>
            </div>
          ) : rootStatus === "error" ? (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[11.5px] text-rose-600 shadow-sm">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              Failed to load — tap back and try again.
            </div>
          ) : (
            <div className="rounded-xl bg-white px-3 py-2.5 text-[11.5px] leading-relaxed text-gray-800 shadow-sm">
              {answer}
            </div>
          )}

          {/* Sub-questions */}
          {rootStatus === "ready" && subQuestions.length > 0 && (
            <>
              <div className="flex items-center">
                <SectionLabel
                  icon={<GitBranch className="h-3 w-3 text-amber-500" />}
                  label="Explore further"
                  gradient="from-amber-50 to-orange-50"
                />
                {selectedCount > 0 && (
                  <span className="ml-auto text-[9px] font-semibold text-gray-400">
                    {selectedCount} selected
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {subQuestions.map((node, idx) => (
                  <SubQuestionItem
                    key={idx}
                    node={node}
                    onToggleSelect={() => toggleSelect(idx)}
                    onExpand={() => handleExpand(idx)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        {rootStatus === "ready" && (
          <div
            className="flex gap-2 px-3 py-2.5"
            style={{ borderTop: "1px solid var(--glass-hairline)" }}
          >
            <button
              onClick={handlePlant}
              disabled={selectedCount === 0 || planting || !editor}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold transition-all",
                selectedCount > 0 && !planting
                  ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                  : "cursor-not-allowed bg-gray-100 text-gray-400",
              )}
              title="Plant selected questions as sticky notes on canvas"
            >
              {planting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sprout className="h-3 w-3" />
              )}
              Plant{selectedCount > 0 ? ` ${selectedCount}` : ""}
            </button>

            {onMaterialize && (
              <button
                onClick={handleAddToKG}
                disabled={selectedCount === 0}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold transition-all",
                  selectedCount > 0
                    ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                    : "cursor-not-allowed bg-gray-100 text-gray-400",
                )}
                title="Materialize selected into the knowledge graph"
              >
                <Sparkles className="h-3 w-3" />
                Add to KG
              </button>
            )}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

// ── Sub-question item (expandable, selectable) ─────────────────────

function SubQuestionItem({
  node,
  onToggleSelect,
  onExpand,
}: {
  node: SubQuestionNode;
  onToggleSelect: () => void;
  onExpand: () => void;
}) {
  return (
    <li className="flex flex-col gap-1">
      {/* Row */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl bg-white px-2.5 py-2 shadow-sm transition-all",
          node.selected && "bg-purple-50/40 ring-1 ring-purple-200",
        )}
      >
        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className={cn(
            "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all",
            node.selected
              ? "border-purple-400 bg-purple-500"
              : "border-gray-300 hover:border-purple-300",
          )}
          title={node.selected ? "Deselect" : "Select"}
        >
          {node.selected && (
            <Check className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
          )}
        </button>

        {/* Question text — click to expand */}
        <button
          onClick={onExpand}
          className="min-w-0 flex-1 text-left text-[11.5px] leading-snug text-gray-700 hover:text-gray-900"
        >
          {node.question}
        </button>

        {/* Expand chevron */}
        <button
          onClick={onExpand}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-300 transition-colors hover:text-gray-500"
          title={node.expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              node.expanded && "rotate-90",
            )}
          />
        </button>
      </div>

      {/* Expanded content */}
      {node.expanded && (
        <div className="ml-5 flex flex-col gap-1">
          {node.status === "loading" ? (
            <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
              <span className="text-[10.5px] text-gray-400">Loading…</span>
            </div>
          ) : node.status === "error" ? (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-[10.5px] text-rose-500">
              Failed to load
            </div>
          ) : node.answer ? (
            <>
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-[10.5px] leading-relaxed text-gray-700">
                {node.answer}
              </div>
              {node.subSubQuestions.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {node.subSubQuestions.slice(0, 3).map((ssq, i) => (
                    <li
                      key={i}
                      className="rounded-xl bg-white px-3 py-1.5 text-[10px] leading-snug text-gray-500 shadow-sm"
                    >
                      {ssq}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}

// ── Section label atom ─────────────────────────────────────────────

function SectionLabel({
  icon,
  label,
  gradient,
}: {
  icon: React.ReactNode;
  label: string;
  gradient: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <div
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-md bg-gradient-to-br",
          gradient,
        )}
      >
        {icon}
      </div>
      <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-500">
        {label}
      </div>
    </div>
  );
}
