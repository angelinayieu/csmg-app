// ── Canvas selection popover ──
//
// Replaces the lasso-chat button with a unified action menu that
// appears whenever ≥1 entity-bearing shape is selected. Adopts the
// pattern from synergy-node-action-popover.tsx — a 3×3 grid of
// action tiles + a "describe what you want" escape hatch — and
// applies it to multi-target selections on the canvas.
//
// MVP scope (Phase 2a #1):
//   ✅ Decompose   — POST /api/entities/[id]/deepen?depth=light (per-item)
//   ✅ Questions   — POST /api/entities/[id]/research-questions (per-item)
//   ✅ Research    — POST /api/canvas/card-web-search (collective)
//   ⏳ Variations  — disabled, "Coming soon" tooltip
//   ⏳ Make-a-plan — disabled
//   ⏳ Rank        — disabled
//   ⏳ Tidy        — calls editor.alignShapes (tldraw native)
//
// Describe field: routes through /api/canvas/lasso-chat (the
// existing endpoint) since it already accepts a selection + a
// custom prompt.
//
// Positioning: anchored below the selection's bounding box; falls
// back to bottom-right when the bbox covers >60% of viewport.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditor, useValue } from "tldraw";
import {
  Brain,
  HelpCircle,
  Layers,
  Loader2,
  Mic,
  Search,
  Send,
  Shuffle,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractShapeContent } from "@/lib/canvas/extract-shape-content";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  spaceId: string;
}

type ActionKey =
  | "decompose"
  | "variations"
  | "questions"
  | "research"
  | "actionable"
  | "rank"
  | "tidy";

interface ActionDef {
  key: ActionKey;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** "available" wires to an endpoint; "soon" disables with a tooltip. */
  status: "available" | "soon" | "native";
  /** Default scope for this action. Overridable per-invocation. */
  defaultScope: "per_item" | "collective";
}

const ACTIONS: ActionDef[] = [
  { key: "decompose", label: "Decompose", Icon: Layers, status: "available", defaultScope: "per_item" },
  { key: "variations", label: "Variations", Icon: Shuffle, status: "soon", defaultScope: "per_item" },
  { key: "questions", label: "Questions", Icon: HelpCircle, status: "available", defaultScope: "per_item" },
  { key: "research", label: "Research", Icon: Search, status: "available", defaultScope: "collective" },
  { key: "actionable", label: "Make a plan", Icon: Sparkles, status: "soon", defaultScope: "collective" },
  { key: "rank", label: "Rank", Icon: Trophy, status: "soon", defaultScope: "collective" },
  { key: "tidy", label: "Tidy", Icon: Brain, status: "native", defaultScope: "collective" },
];

const MIN_ITEMS = 1;

export function CanvasSelectionPopover({ spaceId }: Props) {
  const editor = useEditor();
  const [busy, setBusy] = useState<ActionKey | "describe" | null>(null);
  const [describeText, setDescribeText] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  // Live subscription to the selection. tldraw's useValue re-renders
  // this component on every selection change with cheap diffing.
  const extracted = useValue(
    "selection-popover-extract",
    () => extractShapeContent(editor?.getSelectedShapes() ?? []),
    [editor],
  );

  // Only entity-bearing shapes can be acted on by these endpoints.
  const entityIds = useMemo(
    () => extracted.backendIdsByKind.entity ?? [],
    [extracted.backendIdsByKind],
  );

  const visible = extracted.items.length >= MIN_ITEMS && entityIds.length > 0;

  // Reset collapse + describe when selection clears.
  useEffect(() => {
    if (!visible) {
      setDescribeText("");
      setCollapsed(false);
    }
  }, [visible]);

  // Position — anchor under the selection's bbox unless the bbox is
  // too big, in which case dock to bottom-right.
  const position = useMemo(() => {
    if (!extracted.selectionBounds || !editor) {
      return { mode: "bottom-right" as const };
    }
    const bbox = extracted.selectionBounds;
    const viewport = editor.getViewportScreenBounds();
    // Compare bbox in PAGE coords to viewport in SCREEN coords. Project
    // bbox to screen so the ratio is meaningful.
    const screenBbox = {
      tl: editor.pageToScreen({ x: bbox.x, y: bbox.y }),
      br: editor.pageToScreen({ x: bbox.x + bbox.w, y: bbox.y + bbox.h }),
    };
    const screenW = Math.abs(screenBbox.br.x - screenBbox.tl.x);
    const screenH = Math.abs(screenBbox.br.y - screenBbox.tl.y);
    const tooWide = screenW / viewport.w > 0.6;
    const tooTall = screenH / viewport.h > 0.6;
    if (tooWide || tooTall) return { mode: "bottom-right" as const };
    return {
      mode: "anchored" as const,
      // Center horizontally under the bbox, 16px below
      x: (screenBbox.tl.x + screenBbox.br.x) / 2,
      y: screenBbox.br.y + 16,
    };
  }, [extracted.selectionBounds, editor]);

  // ── Action dispatchers ─────────────────────────────────────────

  const runDecompose = useCallback(async () => {
    setBusy("decompose");
    try {
      // Per-item: one /deepen call per selected entity, light depth.
      // Sequential rather than parallel so we don't slam Anthropic
      // with N concurrent calls on big selections.
      let created = 0;
      for (const entityId of entityIds) {
        const res = await fetch(
          `/api/entities/${entityId}/deepen?depth=light`,
          { method: "POST", credentials: "include" },
        );
        if (!res.ok) continue;
        const json = (await res.json().catch(() => ({}))) as {
          children?: { id: string }[];
        };
        created += json.children?.length ?? 0;
      }
      toast.success("Decomposed", {
        description: `${created} new entities across ${entityIds.length} selected.`,
      });
    } catch (e) {
      toast.error("Decompose failed", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }, [entityIds]);

  const runQuestions = useCallback(async () => {
    setBusy("questions");
    try {
      // The endpoint returns suggested questions per entity. For a
      // multi-target selection we surface a toast pointing the user
      // at the entity-detail drawer where the questions persist.
      let qCount = 0;
      for (const entityId of entityIds) {
        const res = await fetch(
          `/api/entities/${entityId}/research-questions`,
          { method: "POST", credentials: "include" },
        );
        if (!res.ok) continue;
        const json = (await res.json().catch(() => ({}))) as {
          questions?: unknown[];
        };
        qCount += json.questions?.length ?? 0;
      }
      toast.success("Questions generated", {
        description: `${qCount} questions across ${entityIds.length} entities. Open an entity to review.`,
      });
    } catch (e) {
      toast.error("Questions failed", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }, [entityIds]);

  const runResearch = useCallback(async () => {
    setBusy("research");
    try {
      // Collective scope: research across the whole selection.
      // Reuses card-web-search which accepts a card payload — we
      // synthesize a card-like payload from the first entity and
      // include all selected entity labels in the prompt context.
      const firstId = entityIds[0];
      if (!firstId) {
        toast.error("Nothing to research", {
          description: "Selection has no entities to anchor a search.",
        });
        return;
      }
      const summary = extracted.items
        .map((it) => it.oneLiner)
        .slice(0, 10)
        .join(" · ");
      const res = await fetch("/api/canvas/card-web-search", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          card: { entityId: firstId },
          query: summary,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status}`);
      }
      toast.success("Research complete", {
        description: "Findings will appear on the entity drawer.",
      });
    } catch (e) {
      toast.error("Research failed", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }, [entityIds, extracted.items, spaceId]);

  const runTidy = useCallback(() => {
    // Native tldraw layout — align + distribute the selected shapes.
    // No LLM, no API call.
    if (!editor) return;
    const ids = editor.getSelectedShapeIds();
    if (ids.length < 2) {
      toast.info("Select 2+ items to tidy", {
        description: "Tidy aligns and distributes the selection.",
      });
      return;
    }
    editor.alignShapes(ids, "center-horizontal");
    editor.distributeShapes(ids, "horizontal");
    toast.success("Tidied", { description: `${ids.length} items aligned.` });
  }, [editor]);

  const runDescribe = useCallback(async () => {
    const text = describeText.trim();
    if (text.length < 2 || busy) return;
    setBusy("describe");
    try {
      const res = await fetch("/api/canvas/lasso-chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          items: extracted.items.map((it) => ({
            shape_id: it.shapeId,
            shape_type: it.shapeType,
            backend_id: it.backendId,
            backend_kind: it.backendKind,
            one_liner: it.oneLiner,
            content: it.content,
          })),
          user_message: text,
          prior_turns: [],
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json().catch(() => ({}))) as { reply?: string };
      toast.success("Done", {
        description: json.reply?.slice(0, 120) ?? "Response sent.",
      });
      setDescribeText("");
    } catch (e) {
      toast.error("Describe failed", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }, [describeText, busy, extracted.items, spaceId]);

  const dispatchAction = useCallback(
    (action: ActionKey) => {
      if (busy) return;
      switch (action) {
        case "decompose":
          void runDecompose();
          break;
        case "questions":
          void runQuestions();
          break;
        case "research":
          void runResearch();
          break;
        case "tidy":
          runTidy();
          break;
        default:
          // Disabled actions — no-op, the button is grayed out.
          break;
      }
    },
    [busy, runDecompose, runQuestions, runResearch, runTidy],
  );

  if (!visible) return null;

  const positionStyle: React.CSSProperties =
    position.mode === "anchored"
      ? { left: position.x, top: position.y, transform: "translateX(-50%)" }
      : { right: 24, bottom: 100 };

  return (
    <div
      role="dialog"
      aria-label="Selection actions"
      className="fixed z-[60] w-[340px]"
      style={positionStyle}
    >
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: [
            "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
            "0 18px 40px -12px rgba(15, 23, 42, 0.22)",
          ].join(", "),
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">
            {entityIds.length} selected
          </span>
          <span className="font-mono text-[10px] text-gray-400">·</span>
          <span className="text-[11px] text-gray-600">choose an action</span>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {!collapsed && (
          <>
            {/* Action tiles — 3-column grid */}
            <div className="grid grid-cols-3 gap-1.5 p-3">
              {ACTIONS.map((a) => {
                const Icon = a.Icon;
                const isBusy = busy === a.key;
                const isDisabled = a.status === "soon" || busy !== null;
                const titleHint =
                  a.status === "soon"
                    ? `${a.label} — coming in Phase 2`
                    : `${a.label} · ${a.defaultScope === "per_item" ? "per item" : "collective"}`;
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => dispatchAction(a.key)}
                    disabled={isDisabled}
                    title={titleHint}
                    aria-label={a.label}
                    className={cn(
                      "group relative flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center transition",
                      isDisabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-gray-50 active:bg-gray-100",
                    )}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                      {isBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Icon className="h-3 w-3" />
                      )}
                    </span>
                    <span className="text-[10.5px] font-medium text-gray-700">
                      {a.label}
                    </span>
                    {a.status === "soon" && (
                      <span className="absolute -top-0.5 right-1 font-mono text-[7.5px] uppercase tracking-[0.1em] text-gray-400">
                        soon
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Describe field */}
            <div className="border-t border-black/[0.05] px-3 py-2.5">
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-gray-500">
                or describe what you want
              </div>
              <div className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white/80 px-2 py-1">
                <input
                  type="text"
                  value={describeText}
                  onChange={(e) => setDescribeText(e.target.value.slice(0, 400))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void runDescribe();
                    }
                  }}
                  disabled={busy !== null}
                  placeholder="e.g. summarize, find tensions, suggest experiments…"
                  className="flex-1 bg-transparent text-[12px] text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled
                  title="Voice input — coming in Phase 2"
                  aria-label="Voice input — coming soon"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-400 opacity-50"
                >
                  <Mic className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void runDescribe()}
                  disabled={busy !== null || describeText.trim().length < 2}
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full transition",
                    busy === "describe"
                      ? "bg-gray-200 text-gray-500"
                      : "bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40",
                  )}
                  aria-label="Send"
                >
                  {busy === "describe" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
