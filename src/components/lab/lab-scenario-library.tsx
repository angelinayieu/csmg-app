"use client";

// ── Lab Scenario Library (Phase 5C) ──────────────────────────────
//
// Bottom-right panel listing preset configurations the user can
// snap the lab to with one click. Mirrors the photo's "SCENARIO
// LIBRARY" panel (Baseline Reference / Resident Post-Call at 3am /
// Chess Master in Flow / etc.).
//
// Source of presets:
//   1. twin_snapshots rows for this space (saved baselines)
//   2. twin_scenarios rows (saved scenarios with overrides)
//   3. Hardcoded "demo" presets shipped per-domain (later — for now,
//      just the two DB-backed kinds)
//
// Click → dispatches `lab:apply-scenario` window event with the
// snapshot/scenario id; the SpaceLab listener will:
//   • Patch liveConditions from the preset's conditions
//   • Patch parameters via the parameter hook
//   • Highlight the active preset for ~1s
//
// Lazy load — fetches once per spaceId, no realtime subscription.

import { useEffect, useState } from "react";
import { Bookmark, Star, ChevronRight } from "lucide-react";

interface ScenarioPreset {
  id: string;
  kind: "snapshot" | "scenario";
  name: string;
  description: string | null;
  is_baseline?: boolean;
  created_at: string;
}

interface RollupResponse {
  presets: ScenarioPreset[];
}

interface LabScenarioLibraryProps {
  spaceId: string;
  /** Currently active preset id, when applied. Highlights the
   *  matching row. */
  activePresetId?: string | null;
  onApply?: (preset: ScenarioPreset) => void;
}

async function fetchPresets(
  spaceId: string,
  signal: AbortSignal,
): Promise<RollupResponse> {
  const res = await fetch(`/api/spaces/${spaceId}/scenario-library`, {
    credentials: "include",
    signal,
    cache: "no-store",
  });
  if (!res.ok) return { presets: [] };
  return (await res.json()) as RollupResponse;
}

export function LabScenarioLibrary({
  spaceId,
  activePresetId,
  onApply,
}: LabScenarioLibraryProps) {
  const [presets, setPresets] = useState<ScenarioPreset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetchPresets(spaceId, ctrl.signal)
      .then((j) => setPresets(j.presets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [spaceId]);

  return (
    <section className="flex h-full flex-col bg-[rgba(8,12,22,0.5)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          <Bookmark className="h-3 w-3" />
          Scenario Library
        </h3>
        <span className="text-[9px] font-medium text-[#6a7a95]">
          {presets.length} preset{presets.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading && presets.length === 0 && (
        <div className="text-[10.5px] italic text-[#6a7a95]">
          Loading presets…
        </div>
      )}

      {!loading && presets.length === 0 && (
        <div className="rounded border border-dashed border-white/[0.08] bg-white/[0.02] px-2 py-3 text-center text-[10.5px] italic text-[#6a7a95]">
          No saved scenarios yet. Capture a baseline via Snapshots →
          Save snapshot to seed this library.
        </div>
      )}

      <ul className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {presets.map((p) => {
          const isActive = activePresetId === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onApply?.(p);
                  window.dispatchEvent(
                    new CustomEvent("lab:apply-scenario", {
                      detail: { id: p.id, kind: p.kind, spaceId },
                    }),
                  );
                }}
                className={`group flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.05]"
                }`}
              >
                {p.is_baseline ? (
                  <Star className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-400" />
                ) : (
                  <Bookmark className="mt-0.5 h-3 w-3 flex-shrink-0 text-cyan-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-[11px] font-semibold text-[#e8edf4]">
                      {p.name}
                    </span>
                    <ChevronRight className="h-3 w-3 flex-shrink-0 text-[#6a7a95] group-hover:text-[#a8b8d0]" />
                  </div>
                  {p.description && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-[#7a8da8]">
                      {p.description}
                    </div>
                  )}
                  <div className="mt-0.5 text-[9.5px] text-[#6a7a95]">
                    {p.kind === "snapshot" ? "Snapshot" : "Scenario"}
                    {p.is_baseline ? " · baseline" : ""}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
