"use client";

/**
 * CommandPalette — the cross-model power layer (⌘K / Ctrl+K).
 *
 * The single surface where a returning user can:
 *   1. Jump to any of their models by name
 *   2. Kick off a new sketch without leaving the current page
 *   3. Trigger primary actions (create model, open intelligence, open settings)
 *
 * This is the v1 foundation. Cross-model natural-language queries
 * ("compare leverage points across my strategy models") will route through
 * this same surface in a later pass — the UI layer is built for them
 * already: a single input with a live results list grouped by kind.
 *
 * Wired via a global keyboard handler (installed in Studio). Keeping it
 * portable means it can be mounted on any page later (entity pages, graph
 * view) without structural changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Sparkles,
  Plus,
  Radar,
  Settings,
  Boxes,
  ArrowUpRight,
  Command as CommandIcon,
  CornerDownLeft,
  CircleDot,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Space } from "@/types";
import type { Reaction } from "@/types/reactions";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: Space[];
}

type ResultKind = "model" | "action" | "entity" | "reaction";

interface Result {
  id: string;
  kind: ResultKind;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Color accent for the kind glyph (semantic where applicable). */
  accent?: string;
  run: () => void;
}

// Phase 45 — payload shape from /api/search
interface SearchEntity {
  id: string;
  name: string;
  space_id: string;
  entity_category: string | null;
  layer: string | null;
}
interface SearchReaction {
  id: string;
  name: string;
  reaction_type: Reaction["reaction_type"];
  probability: number;
  space_id: string;
  entity_ids: string[];
  created_at: string;
}
interface SearchResponse {
  entities: SearchEntity[];
  reactions: SearchReaction[];
  // We already render local spaces from the spaces prop; the endpoint's
  // spaces field is unused in the studio but documented for future use.
}

const REACTION_TYPE_COLOR: Record<Reaction["reaction_type"], string> = {
  emergent: "#16a34a",
  reinforcing: "#0891b2",
  tension: "#db2777",
  trivial: "#64748b",
};

export function CommandPalette({ open, onOpenChange, spaces }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Phase 45 — cross-surface search. /api/search?q= returns entities +
  // reactions matching the query across every space the user owns.
  // Debounced 150ms so a fast typist doesn't hammer the endpoint.
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchData(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      const ctrl = new AbortController();
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((json: SearchResponse) => setSearchData(json))
        .catch(() => setSearchData(null))
        .finally(() => setSearchLoading(false));
      return () => ctrl.abort();
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const spacesById = useMemo(() => {
    const m = new Map<string, Space>();
    for (const s of spaces) m.set(s.id, s);
    return m;
  }, [spaces]);

  // Reset query + cursor when the palette opens, and focus the input
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setSearchData(null);
      // Defer to next tick so the modal is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const list: Result[] = [];

    // Actions first — so an empty query shows the primary actions
    const actions: Result[] = [
      {
        id: "action:sketch",
        kind: "action",
        label: query.length > 0 ? `Sketch: "${query}"` : "Start a new sketch",
        hint: "~10s, zero commitment",
        icon: Sparkles,
        run: () => {
          const params = new URLSearchParams();
          if (query.trim()) params.set("seed", query.trim());
          params.set("mode", "sketch");
          router.push(`/app/analyze?${params.toString()}`);
          onOpenChange(false);
        },
      },
      {
        id: "action:analyze",
        kind: "action",
        label: query.length > 0 ? `Full analysis: "${query}"` : "New full analysis",
        hint: "commits to a persistent model",
        icon: Plus,
        run: () => {
          const params = new URLSearchParams();
          if (query.trim()) params.set("seed", query.trim());
          router.push(`/app/analyze${params.toString() ? `?${params.toString()}` : ""}`);
          onOpenChange(false);
        },
      },
      {
        id: "action:settings",
        kind: "action",
        label: "Settings",
        icon: Settings,
        run: () => {
          router.push("/app/settings");
          onOpenChange(false);
        },
      },
    ];

    // Models filtered by query (fallback to first 8 when empty)
    const filteredSpaces =
      q.length === 0
        ? spaces.slice(0, 8)
        : spaces.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 12);

    const modelResults: Result[] = filteredSpaces.map((s) => ({
      id: `model:${s.id}`,
      kind: "model",
      label: s.name,
      hint: `${s.entity_count ?? 0} entities · ${s.edge_count ?? 0} edges`,
      icon: Boxes,
      run: () => {
        router.push(`/app/space/${s.id}`);
        onOpenChange(false);
      },
    }));

    // Jump-to-intelligence for the most recent model (power-user shortcut)
    if (spaces.length > 0 && q.length === 0) {
      const latest = spaces[0];
      modelResults.push({
        id: `action:intelligence:${latest.id}`,
        kind: "action",
        label: `Intelligence · ${latest.name}`,
        hint: "reflexive loop dashboard",
        icon: Radar,
        run: () => {
          router.push(`/app/space/${latest.id}/intelligence`);
          onOpenChange(false);
        },
      });
    }

    // Phase 45 — entity + reaction results from /api/search. Only land
    // when the user has typed enough; spaces+actions still always show.
    const entityResults: Result[] = (searchData?.entities ?? []).map((e) => {
      const space = spacesById.get(e.space_id);
      const spaceName = space?.name ?? "(space)";
      const cat = e.entity_category ?? "concept";
      return {
        id: `entity:${e.id}`,
        kind: "entity" as const,
        label: e.name,
        hint: `${cat} · ${spaceName}`,
        icon: CircleDot,
        accent: "#0a6aee",
        run: () => {
          router.push(`/app/space/${e.space_id}/entity/${e.id}/lab`);
          onOpenChange(false);
        },
      };
    });
    const reactionResults: Result[] = (searchData?.reactions ?? []).map((r) => {
      const space = spacesById.get(r.space_id);
      const spaceName = space?.name ?? "(space)";
      const drillEntityId = r.entity_ids[0];
      const href = drillEntityId
        ? `/app/space/${r.space_id}/entity/${drillEntityId}/lab?rxn=${r.id}`
        : `/app/space/${r.space_id}/lab?rxn=${r.id}`;
      return {
        id: `reaction:${r.id}`,
        kind: "reaction" as const,
        label: r.name,
        hint: `${r.reaction_type} · ${Math.round(r.probability * 100)}% · ${spaceName}`,
        icon: FlaskConical,
        accent: REACTION_TYPE_COLOR[r.reaction_type],
        run: () => {
          router.push(href);
          onOpenChange(false);
        },
      };
    });

    // Ordering when the user is searching:
    //   entities first  (strongest "I want to find a thing" intent)
    //   reactions next  (richer than spaces — carries thinking)
    //   spaces          (fallback navigation)
    //   actions         (escape hatch — never first)
    // When idle, actions + spaces only (search is async; entities won't
    // be there yet anyway).
    if (q.length > 0) {
      list.push(...entityResults, ...reactionResults, ...modelResults, ...actions);
    } else {
      list.push(...actions, ...modelResults);
    }

    return list;
  }, [
    query,
    spaces,
    spacesById,
    router,
    onOpenChange,
    searchData,
  ]);

  // Clamp cursor into valid range when results change
  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [cursor, results.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = results[cursor];
        if (r) r.run();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [results, cursor, onOpenChange],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[15vh]"
      onClick={() => onOpenChange(false)}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        style={{ animation: "cmdFadeIn 140ms ease-out" }}
      />

      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[600px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_32px_64px_-20px_rgba(0,20,100,0.35)]"
        style={{ animation: "cmdRise 180ms ease-out" }}
      >
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <Search
            className="h-4 w-4"
            style={{ color: searchLoading ? "#0a6aee" : "#9ca3af" }}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find an entity, reaction, model, or run an action…"
            className="flex-1 bg-transparent text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          {searchLoading && (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-interaxis-200 border-t-interaxis-500"
              aria-label="Searching"
            />
          )}
          <span className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
            <CommandIcon className="h-2.5 w-2.5" /> K
          </span>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-gray-400">
              Nothing matches. Press Enter to start a sketch with this text.
            </div>
          ) : (
            <ul>
              {results.map((r, i) => {
                const Icon = r.icon;
                const active = i === cursor;
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => r.run()}
                      onMouseEnter={() => setCursor(i)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        active ? "bg-interaxis-50" : "hover:bg-gray-50",
                      )}
                    >
                      <Icon
                        className="h-4 w-4 shrink-0"
                        style={{
                          color:
                            r.accent ??
                            (active ? "#0a6aee" : "#9ca3af"),
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-[13px] font-semibold", active ? "text-interaxis-900" : "text-gray-800")}>
                          {r.label}
                        </div>
                        {r.hint && (
                          <div className="truncate text-[10.5px] text-gray-500">{r.hint}</div>
                        )}
                      </div>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                        style={
                          r.accent
                            ? {
                                color: r.accent,
                                background: `${r.accent}15`,
                              }
                            : { color: "#6b7280", background: "#f3f4f6" }
                        }
                      >
                        {r.kind}
                      </span>
                      {active && <CornerDownLeft className="h-3 w-3 text-interaxis-500" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer legend */}
        <div className="flex items-center gap-3 border-t border-gray-100 bg-gray-50/60 px-4 py-2 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-sans text-gray-600">↑↓</kbd>
            navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-sans text-gray-600">↵</kbd>
            open
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-sans text-gray-600">esc</kbd>
            close
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-gray-400">
            <ArrowUpRight className="h-3 w-3" />
            cross-model queries coming
          </span>
        </div>

        <style jsx>{`
          @keyframes cmdFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes cmdRise {
            from { opacity: 0; transform: translateY(-8px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}

/** Global ⌘K / Ctrl+K hook — opens the palette from anywhere. */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
