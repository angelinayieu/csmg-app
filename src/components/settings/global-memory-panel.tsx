"use client";

/**
 * GlobalMemoryPanel — Memory & Learning section for the global settings page.
 *
 * Controls:
 *   1. Default memory-on setting for new whiteboards (localStorage global default).
 *   2. Default scope (all_spaces vs this_space).
 *   3. "Clear all memory" — fires DELETE /api/memory/clear which wipes all
 *      memory_items rows for the current user.
 *
 * Per-space overrides live in each space's brainstorm settings and always
 * take precedence over these defaults.
 */

import { useState, useEffect } from "react";
import { Brain, Globe, Target, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemorySettings,
} from "@/lib/brainstorm/brainstorm-settings";

const GLOBAL_DEFAULTS_KEY = "interaxis:memory:global_defaults";

function loadGlobalDefaults(): Pick<MemorySettings, "enabled" | "scope"> {
  try {
    const raw = localStorage.getItem(GLOBAL_DEFAULTS_KEY);
    if (!raw) return { enabled: DEFAULT_MEMORY_SETTINGS.enabled, scope: DEFAULT_MEMORY_SETTINGS.scope };
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_MEMORY_SETTINGS.enabled,
      scope: (parsed.scope === "this_space" || parsed.scope === "all_spaces" || parsed.scope === "custom")
        ? parsed.scope
        : DEFAULT_MEMORY_SETTINGS.scope,
    };
  } catch {
    return { enabled: DEFAULT_MEMORY_SETTINGS.enabled, scope: DEFAULT_MEMORY_SETTINGS.scope };
  }
}

function saveGlobalDefaults(defaults: Pick<MemorySettings, "enabled" | "scope">) {
  try {
    localStorage.setItem(GLOBAL_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch { /* ignore */ }
}

export function GlobalMemoryPanel() {
  const [defaults, setDefaults] = useState<Pick<MemorySettings, "enabled" | "scope">>({
    enabled: false,
    scope: "all_spaces",
  });
  const [mounted, setMounted] = useState(false);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "clearing" | "done" | "error">("idle");
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    setDefaults(loadGlobalDefaults());
    setMounted(true);
  }, []);

  const updateDefaults = (patch: Partial<Pick<MemorySettings, "enabled" | "scope">>) => {
    const next = { ...defaults, ...patch };
    setDefaults(next);
    saveGlobalDefaults(next);
  };

  const handleClearMemory = async () => {
    if (clearState === "confirm") {
      setClearState("clearing");
      setClearError(null);
      try {
        const res = await fetch("/api/memory/clear", { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setClearState("done");
        setTimeout(() => setClearState("idle"), 3000);
      } catch (err) {
        setClearError(err instanceof Error ? err.message : "Unknown error");
        setClearState("error");
      }
    } else {
      setClearState("confirm");
    }
  };

  if (!mounted) {
    return (
      <div className="animate-pulse rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="h-4 w-32 rounded bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Section header */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
          <Brain className="h-4 w-4 text-indigo-500" strokeWidth={1.75} />
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-gray-900">Memory &amp; Learning</h3>
          <p className="text-[11px] text-gray-500">
            Default settings applied when you open a new whiteboard.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Default on/off */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
          <div>
            <div className="text-[12px] font-semibold text-gray-800">
              Enable memory by default
            </div>
            <div className="mt-0.5 text-[11px] text-gray-500">
              New whiteboards will retrieve relevant context from past analyses automatically.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={defaults.enabled}
            onClick={() => updateDefaults({ enabled: !defaults.enabled })}
            className={cn(
              "relative h-5 w-9 flex-shrink-0 rounded-full transition-all",
              defaults.enabled ? "" : "bg-gray-200",
            )}
            style={defaults.enabled ? { background: "#6366f1" } : undefined}
          >
            <span
              className="absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-all"
              style={{ left: defaults.enabled ? "calc(100% - 18px)" : "2px" }}
            />
          </button>
        </div>

        {/* Default scope */}
        <div className="flex flex-col gap-2">
          <div className="text-[11.5px] font-semibold text-gray-700">Default scope</div>
          <div className="flex gap-2">
            {(["all_spaces", "this_space"] as const).map((s) => {
              const active = defaults.scope === s;
              return (
                <button
                  key={s}
                  onClick={() => updateDefaults({ scope: s })}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-[11.5px] font-semibold transition-all",
                    active
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                  )}
                >
                  {s === "all_spaces" ? (
                    <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Target className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  {s === "all_spaces" ? "All spaces" : "Current space only"}
                </button>
              );
            })}
          </div>
          <p className="text-[10.5px] text-gray-400">
            {defaults.scope === "all_spaces"
              ? "Retrieves context from all your past analyses across every workspace."
              : "Only looks back at analyses done in the same workspace."}
          </p>
        </div>

        {/* Note about per-space overrides */}
        <div className="rounded-lg bg-blue-50/60 px-3 py-2 text-[10.5px] text-blue-700">
          <strong>Per-space overrides:</strong> You can adjust memory settings for any
          individual whiteboard inside the Brainstorm panel (⚡ button on the canvas).
          Those settings always take precedence over these defaults.
        </div>

        {/* Clear all memory */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold text-gray-800">
                Clear memory store
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500">
                Permanently deletes all indexed memories from your past analyses.
                This cannot be undone — future runs will start fresh.
              </div>
              {clearState === "error" && clearError && (
                <div className="mt-1 text-[11px] font-medium text-red-600">
                  {clearError}
                </div>
              )}
            </div>
            <button
              onClick={handleClearMemory}
              disabled={clearState === "clearing" || clearState === "done"}
              className={cn(
                "flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] font-semibold transition-all",
                clearState === "confirm" &&
                  "bg-red-600 text-white hover:bg-red-700",
                clearState === "clearing" &&
                  "cursor-not-allowed bg-red-100 text-red-400",
                clearState === "done" &&
                  "cursor-default bg-emerald-50 text-emerald-600",
                clearState === "error" &&
                  "bg-red-50 text-red-600 hover:bg-red-100",
                clearState === "idle" &&
                  "border border-red-200 bg-white text-red-600 hover:bg-red-50",
              )}
            >
              {clearState === "clearing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : clearState === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {clearState === "confirm"
                ? "Confirm delete"
                : clearState === "clearing"
                  ? "Clearing…"
                  : clearState === "done"
                    ? "Cleared"
                    : "Clear all"}
            </button>
          </div>
          {clearState === "confirm" && (
            <div className="mt-2 flex items-center gap-2">
              <p className="flex-1 text-[10.5px] font-medium text-red-600">
                All your memory items will be permanently deleted. Click "Confirm delete" to proceed or click away to cancel.
              </p>
              <button
                onClick={() => setClearState("idle")}
                className="rounded px-2 py-0.5 text-[10.5px] text-gray-500 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
