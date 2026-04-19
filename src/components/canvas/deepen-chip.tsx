"use client";

import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Deepen chip — Sprint 5.
 *
 * Renders next to an accepted concept. Clicking runs the scoped
 * hierarchical deepen (POST /api/entities/[id]/deepen) and expands
 * inline to show the resulting sub-concepts.
 *
 * If the entity has already been deepened, the first click returns
 * the existing children instantly (no LLM call).
 */

interface DeepenChild {
  id: string;
  entity_id: string;
  name: string;
  description: string | null;
  importance: string;
}

export function DeepenChip({
  entityId,
  entityName,
}: {
  entityId: string;
  entityName: string;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "done"; children: DeepenChild[]; alreadyExisted: boolean; expanded: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function runDeepen() {
    if (state.kind === "running") return;
    if (state.kind === "done") {
      setState({
        ...state,
        expanded: !state.expanded,
      });
      return;
    }
    setState({ kind: "running" });
    try {
      const res = await fetch(`/api/entities/${entityId}/deepen`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        children: DeepenChild[];
        already_deepened: boolean;
      };
      setState({
        kind: "done",
        children: data.children,
        alreadyExisted: data.already_deepened,
        expanded: true,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Deepen failed",
      });
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={runDeepen}
        disabled={state.kind === "running"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
          state.kind === "running"
            ? "bg-gray-100 text-gray-500"
            : state.kind === "done"
            ? "bg-interaxis-50 text-interaxis-700 hover:bg-interaxis-100"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200",
        )}
        title={
          state.kind === "done"
            ? state.expanded
              ? "Collapse"
              : "Show children"
            : `Decompose "${entityName}" into sub-concepts`
        }
      >
        {state.kind === "running" ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : state.kind === "done" ? (
          state.expanded ? (
            <ChevronDown className="h-2.5 w-2.5" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5" />
          )
        ) : (
          <Sparkles className="h-2.5 w-2.5" />
        )}
        {state.kind === "running"
          ? "Deepening…"
          : state.kind === "done"
          ? `${state.children.length} sub-concept${state.children.length === 1 ? "" : "s"}`
          : "Deepen"}
      </button>

      {state.kind === "error" && (
        <div className="mt-1 text-[10px] text-red-600">{state.message}</div>
      )}

      {state.kind === "done" && state.expanded && state.children.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg border border-interaxis-100 bg-interaxis-50/40 p-2">
          {state.alreadyExisted && (
            <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
              Already deepened
            </div>
          )}
          {state.children.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-white bg-white px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1 w-1 rounded-full bg-interaxis-600"
                  aria-hidden
                />
                <span className="text-[12px] font-semibold text-gray-900">
                  {c.name}
                </span>
                <span
                  className={cn(
                    "ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium uppercase",
                    c.importance === "fundamental" && "bg-red-50 text-red-700",
                    c.importance === "critical" && "bg-amber-50 text-amber-700",
                    c.importance === "important" && "bg-blue-50 text-blue-700",
                    c.importance === "moderate" && "bg-gray-100 text-gray-700",
                  )}
                >
                  {c.importance}
                </span>
              </div>
              {c.description && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-600">
                  {c.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
