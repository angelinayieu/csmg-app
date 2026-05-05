"use client";

// ── Canvas cycle-detail drawer ──
//
// Cycles are the strategic-leverage artifacts: feedback loops the
// LLM traced during decomposition. Until now they were DB rows with
// no drawer — the canvas cycle-loop-shape exists but clicking it
// did nothing. Strategy LLM references them ("tighten the C3→C7→C3
// compounding loop") and users couldn't inspect what the cycle
// actually was.
//
// This drawer surfaces: classification (reinforcing / balancing /
// etc.), growth_type, cycle_time, estimated_multiplier, intervention
// point, plus the ordered list of member entities with their
// leverage/risk flags.

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Repeat,
  TrendingUp,
  Clock,
  Target,
  ArrowRight,
  Network,
  Loader2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cycle, Entity } from "@/types";
import { useFullscreenDrawer } from "./use-fullscreen-drawer";
import { DrawerFullscreenButton } from "./drawer-fullscreen-button";

export interface CycleDetailDrawerProps {
  cycleId: string | null;
  onClose: () => void;
}

interface CycleDetailResponse {
  cycle: Cycle;
  memberEntities: Entity[];
}

const CLASSIFICATION_TONE: Record<string, string> = {
  reinforcing: "bg-red-50 text-red-700 ring-red-200",
  balancing: "bg-blue-50 text-blue-700 ring-blue-200",
  convergent: "bg-purple-50 text-purple-700 ring-purple-200",
  divergent: "bg-amber-50 text-amber-700 ring-amber-200",
};

export function CycleDetailDrawer({ cycleId, onClose }: CycleDetailDrawerProps) {
  const [data, setData] = useState<CycleDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(cycleId !== null);
  // Phase 4 — "Save as system" gesture state. Tri-state: idle / saving /
  // saved (transient success badge for ~1.5s before resetting).
  const [savingState, setSavingState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedSystemId, setSavedSystemId] = useState<string | null>(null);

  useEffect(() => {
    if (!cycleId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/cycles/${cycleId}/detail`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Lookup failed (${res.status})`);
        }
        return res.json() as Promise<CycleDetailResponse>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Lookup failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  const handleClose = useCallback(() => {
    setData(null);
    setError(null);
    setSavingState("idle");
    setSavedSystemId(null);
    onClose();
  }, [onClose]);

  // Phase 4 — promote this cycle to a saved system. Source-tags as
  // `cycle` so the systems page renders the right icon + lets users
  // back-navigate to the cycle drawer if they want.
  const handleSaveAsSystem = useCallback(async () => {
    if (!data) return;
    const cycle = data.cycle as unknown as {
      id: string;
      space_id: string;
      name: string | null;
      entity_ids: string[] | null;
      description: string | null;
    };
    const entityIds = Array.isArray(cycle.entity_ids) ? cycle.entity_ids : [];
    if (entityIds.length === 0) {
      setSavingState("error");
      return;
    }
    setSavingState("saving");
    try {
      const res = await fetch(
        `/api/spaces/${cycle.space_id}/systems`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: cycle.name
              ? `Loop · ${cycle.name}`
              : `Loop · ${entityIds.length} nodes`,
            description: cycle.description ?? null,
            entity_ids: entityIds,
            // Edges auto-resolved server-side from entity_ids.
            source_kind: "cycle",
            source_ref_id: cycle.id,
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { system?: { id: string } };
      setSavedSystemId(json.system?.id ?? null);
      setSavingState("saved");
      // Auto-reset back to idle after a moment so the user can save
      // again if they want to (e.g., to a different objective).
      window.setTimeout(() => setSavingState("idle"), 1800);
    } catch (err) {
      console.warn("[cycle drawer] save-as-system failed:", err);
      setSavingState("error");
      window.setTimeout(() => setSavingState("idle"), 2200);
    }
  }, [data]);

  if (!cycleId) return null;

  if (loading && !data) {
    return (
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full flex-col items-center justify-center border-l border-gray-200 bg-white shadow-lg",
          isFullscreen ? "w-screen" : "w-[380px]",
        )}
        style={{ animation: "slideInRight 300ms ease forwards" }}
      >
        <div className="text-[12px] text-gray-400">Loading cycle…</div>
        <style jsx>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full flex-col items-center justify-center border-l border-gray-200 bg-white px-8 text-center shadow-lg",
          isFullscreen ? "w-screen" : "w-[380px]",
        )}
      >
        <div className="mb-3 text-[13px] font-semibold text-gray-700">Couldn&apos;t load cycle</div>
        <div className="mb-4 text-[11px] text-gray-500">{error}</div>
        <button
          onClick={handleClose}
          className="rounded-md border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { cycle, memberEntities } = data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ac = cycle as any;
  const classification = (ac.classification as string) ?? "unclassified";
  const classTone = CLASSIFICATION_TONE[classification] ?? "bg-gray-100 text-gray-700 ring-gray-200";

  // Order member entities by the cycle.entity_ids list so the drawer
  // reads in traversal order (A → B → C → A).
  const rawIds = (ac.entity_ids as string[] | null) ?? [];
  const byId = new Map<string, Entity>();
  const byCode = new Map<string, Entity>();
  for (const e of memberEntities) {
    byId.set(e.id, e);
    if (e.entity_id) byCode.set(e.entity_id, e);
  }
  const ordered = rawIds
    .map((id) => byId.get(id) ?? byCode.get(id))
    .filter((e): e is Entity => Boolean(e));

  return (
    <div
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full flex-col border-l border-gray-200 bg-white shadow-lg transition-[width] duration-200 ease-out",
        isFullscreen ? "w-screen" : "w-[380px]",
      )}
      style={{ animation: "slideInRight 300ms ease forwards" }}
    >
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              <Repeat className="h-2.5 w-2.5" />
              Cycle · {ordered.length} nodes
            </div>
            <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-gray-900">
              {cycle.name ?? "(unnamed cycle)"}
            </h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {/* Phase 4 — promote this cycle to a saved system. */}
            <button
              onClick={handleSaveAsSystem}
              disabled={savingState === "saving"}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition",
                savingState === "saved"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : savingState === "error"
                    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                    : "bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70",
              )}
              title={
                savedSystemId
                  ? "Saved! Click again to make another system."
                  : "Save this loop as a System you can experiment against in the lab."
              }
            >
              {savingState === "saving" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : savingState === "saved" ? (
                <Check className="h-3 w-3" />
              ) : (
                <Network className="h-3 w-3" />
              )}
              {savingState === "saved"
                ? "Saved"
                : savingState === "error"
                  ? "Failed"
                  : "Save as system"}
            </button>
            <DrawerFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
            <button
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
              title="Close drawer"
              aria-label="Close drawer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium ring-1", classTone)}>
            {classification}
          </span>
          {ac.growth_type && ac.growth_type !== "none" && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-indigo-200">
              {String(ac.growth_type).replace(/_/g, " ")}
            </span>
          )}
          {ac.estimated_multiplier && Number(ac.estimated_multiplier) > 1 && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
              {Number(ac.estimated_multiplier).toFixed(1)}× multiplier
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[12px]">
        {ac.description && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Description
            </h3>
            <p className="leading-relaxed text-gray-700">{ac.description}</p>
          </div>
        )}

        {ac.intervention_point && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Intervention point
            </h3>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
              <Target className="mr-1 inline-block h-3 w-3 -translate-y-[1px]" />
              {ac.intervention_point}
            </p>
            <p className="mt-1 text-[10.5px] text-gray-500">
              Where to apply leverage to reshape this loop.
            </p>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Properties
          </h3>
          <div className="space-y-1 text-[12px]">
            {ac.cycle_time && (
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-gray-500">
                  <Clock className="h-3 w-3" />
                  Cycle time
                </span>
                <span className="font-medium text-gray-700">{String(ac.cycle_time)}</span>
              </div>
            )}
            {ac.growth_type && (
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-gray-500">
                  <TrendingUp className="h-3 w-3" />
                  Growth
                </span>
                <span className="font-medium text-gray-700">{String(ac.growth_type).replace(/_/g, " ")}</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Cycle ring
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
              {ordered.length}
            </span>
          </h3>
          <div className="space-y-1">
            {ordered.map((e, i) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ae = e as any;
              const nextIsFirst = i === ordered.length - 1;
              return (
                <div key={e.id}>
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px]",
                      ae.is_leverage_point
                        ? "bg-amber-50 ring-1 ring-amber-200"
                        : ae.is_risk_point
                          ? "bg-red-50 ring-1 ring-red-200"
                          : "bg-gray-50",
                    )}
                  >
                    <span className="font-mono text-[9.5px] font-bold tabular-nums text-gray-400">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {e.entity_id && (
                      <span className="rounded bg-white px-1 py-0.5 font-mono text-[9.5px] text-gray-500 ring-1 ring-gray-200">
                        {e.entity_id}
                      </span>
                    )}
                    <span className="flex-1 truncate font-medium text-gray-800">{e.name}</span>
                    {ae.is_leverage_point && (
                      <span className="rounded-full bg-amber-100 px-1 text-[9px] font-bold text-amber-700">
                        LEV
                      </span>
                    )}
                    {ae.is_risk_point && (
                      <span className="rounded-full bg-red-100 px-1 text-[9px] font-bold text-red-700">
                        RISK
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-center py-0.5">
                    <ArrowRight
                      className={cn(
                        "h-3 w-3 rotate-90",
                        nextIsFirst ? "text-purple-400" : "text-gray-300",
                      )}
                    />
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-center text-[9.5px] italic text-gray-400">
              (loops back to {ordered[0]?.name ?? "first"})
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
