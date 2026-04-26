"use client";

// ── Mechanisms browse page ──
// Route: /app/space/[id]/mechanisms
//
// First UI surface for the `mechanisms` table. Lists every mechanism
// in the space with its kind / cycle pattern / status / agent count
// + a "Save as system" gesture that derives entity scope from
// the union of dominant_entity_ids across the apps that point at
// this mechanism (apps.parent_mechanism_id).
//
// Detail-level mechanism inspection (per-mechanism agent assignments,
// cycle pattern viz) is deferred. The browse + promote flow is the
// minimum viable surfacing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Cog,
  Loader2,
  Network,
  Search,
  Check,
  AlertCircle,
  Activity,
  Eye,
  PlayCircle,
  PauseCircle,
  Archive,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  MechanismListEntry,
  MechanismsListResponse,
} from "@/app/api/spaces/[id]/mechanisms/route";

const KIND_LABEL: Record<string, string> = {
  simulation: "Simulation",
  prediction: "Prediction",
  validation: "Validation",
  baseline_tracking: "Baseline tracking",
  deviation_capture: "Deviation capture",
  game: "Game",
  ml_personalization: "ML personalization",
};

const KIND_ACCENT: Record<string, string> = {
  simulation: "#0891b2",
  prediction: "#7c3aed",
  validation: "#16a34a",
  baseline_tracking: "#0284c7",
  deviation_capture: "#dc2626",
  game: "#ea580c",
  ml_personalization: "#a855f7",
};

const STATUS_TONE: Record<
  string,
  { bg: string; fg: string; Icon: typeof PlayCircle }
> = {
  proposed: { bg: "bg-slate-100", fg: "text-slate-600", Icon: Sparkles },
  approved: { bg: "bg-blue-100", fg: "text-blue-700", Icon: Check },
  active: { bg: "bg-emerald-100", fg: "text-emerald-700", Icon: PlayCircle },
  paused: { bg: "bg-amber-100", fg: "text-amber-700", Icon: PauseCircle },
  retired: { bg: "bg-slate-100", fg: "text-slate-500", Icon: Archive },
};

export default function MechanismsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const spaceId = params.id;

  const [rows, setRows] = useState<MechanismListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  // Per-mechanism save-as-system state.
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savedSystemIds, setSavedSystemIds] = useState<Map<string, string>>(
    new Map(),
  );
  const [errorMsgs, setErrorMsgs] = useState<Map<string, string>>(new Map());

  const fetchMechanisms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/mechanisms`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const json = (await r.json()) as MechanismsListResponse;
      setRows(json.mechanisms ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetchMechanisms();
  }, [fetchMechanisms]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.kind) set.add(r.kind);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter && r.kind !== kindFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.description ?? ""} ${r.cycle_pattern ?? ""} ${r.rationale ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, kindFilter]);

  const onSaveAsSystem = useCallback(
    async (m: MechanismListEntry) => {
      if (saving.has(m.id)) return;
      if (m.derived_entity_ids.length === 0) {
        setErrorMsgs((prev) => {
          const next = new Map(prev);
          next.set(
            m.id,
            "no entities derived (no apps reference this mechanism yet)",
          );
          return next;
        });
        return;
      }
      setSaving((s) => new Set(s).add(m.id));
      setErrorMsgs((prev) => {
        const next = new Map(prev);
        next.delete(m.id);
        return next;
      });
      try {
        const r = await fetch(`/api/spaces/${spaceId}/systems`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `Mechanism · ${m.name}`,
            description:
              `Promoted from mechanism (${KIND_LABEL[m.kind] ?? m.kind})` +
              (m.cycle_pattern ? ` — cycle: ${m.cycle_pattern}` : "") +
              `. Entity scope derived from ${m.app_count} app${m.app_count === 1 ? "" : "s"}' dominant entities.`,
            entity_ids: m.derived_entity_ids,
            source_kind: "mechanism",
            source_ref_id: m.id,
          }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`save failed: ${r.status} ${txt.slice(0, 120)}`);
        }
        const json = (await r.json()) as { system?: { id: string } };
        setSaved((s) => new Set(s).add(m.id));
        if (json.system?.id) {
          setSavedSystemIds((prev) => {
            const next = new Map(prev);
            next.set(m.id, json.system!.id);
            return next;
          });
        }
        // Auto-clear the saved badge after a few seconds.
        window.setTimeout(() => {
          setSaved((s) => {
            const next = new Set(s);
            next.delete(m.id);
            return next;
          });
        }, 2400);
      } catch (err) {
        setErrorMsgs((prev) => {
          const next = new Map(prev);
          next.set(m.id, err instanceof Error ? err.message : String(err));
          return next;
        });
      } finally {
        setSaving((s) => {
          const next = new Set(s);
          next.delete(m.id);
          return next;
        });
      }
    },
    [saving, spaceId],
  );

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">
            Mechanisms
          </div>
          <div className="text-[14px] font-semibold text-slate-900">
            Cycle patterns staffed by agents in this space
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, cycle pattern, rationale…"
              className="w-72 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[12px] outline-none placeholder:text-slate-400 focus:border-cyan-400"
            />
          </div>
          <Link
            href={`/app/space/${spaceId}/systems`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Systems
          </Link>
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Whiteboard
          </Link>
        </div>
      </div>

      {/* ── Kind chips ── */}
      {kinds.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-6 py-2 text-[11px]">
          <button
            type="button"
            onClick={() => setKindFilter(null)}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium transition",
              !kindFilter
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            All ({rows.length})
          </button>
          {kinds.map((k) => {
            const accent = KIND_ACCENT[k] ?? "#64748b";
            const count = rows.filter((r) => r.kind === k).length;
            const selected = kindFilter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(selected ? null : k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition",
                  selected
                    ? "text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
                style={selected ? { background: accent } : undefined}
              >
                <Cog className="h-3 w-3" />
                {KIND_LABEL[k] ?? k} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading mechanisms…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-red-600">
            Failed to load: {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
            <Cog className="h-8 w-8 text-slate-300" />
            <div className="max-w-md text-[12px] text-slate-500">
              {query || kindFilter
                ? "No mechanisms match the current filter."
                : "No mechanisms yet. Mechanisms materialize when strategy-refresh + wire-twin-proposal run on a fresh space."}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((m) => (
              <MechanismRow
                key={m.id}
                mechanism={m}
                spaceId={spaceId}
                isSaving={saving.has(m.id)}
                isSaved={saved.has(m.id)}
                savedSystemId={savedSystemIds.get(m.id) ?? null}
                errorMsg={errorMsgs.get(m.id) ?? null}
                onSave={() => onSaveAsSystem(m)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer count */}
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        {filtered.length} of {rows.length}{" "}
        {rows.length === 1 ? "mechanism" : "mechanisms"}
        {kindFilter && (
          <span> · filtered to {KIND_LABEL[kindFilter] ?? kindFilter}</span>
        )}
        {query && <span> · matching &quot;{query}&quot;</span>}
      </div>
    </div>
  );
}

function MechanismRow({
  mechanism,
  spaceId,
  isSaving,
  isSaved,
  savedSystemId,
  errorMsg,
  onSave,
}: {
  mechanism: MechanismListEntry;
  spaceId: string;
  isSaving: boolean;
  isSaved: boolean;
  savedSystemId: string | null;
  errorMsg: string | null;
  onSave: () => void;
}) {
  const accent = KIND_ACCENT[mechanism.kind] ?? "#64748b";
  const statusTone = STATUS_TONE[mechanism.status] ?? STATUS_TONE.proposed;
  const StatusIcon = statusTone.Icon;
  const agentArr = Array.isArray(mechanism.agent_assignments)
    ? mechanism.agent_assignments
    : [];
  const noEntities = mechanism.derived_entity_ids.length === 0;

  return (
    <li className="px-6 py-3 transition hover:bg-cyan-50/30">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
          title={KIND_LABEL[mechanism.kind] ?? mechanism.kind}
        >
          <Cog className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-slate-900">
              {mechanism.name}
            </h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider",
                statusTone.bg,
                statusTone.fg,
              )}
            >
              <StatusIcon className="h-2.5 w-2.5" />
              {mechanism.status}
            </span>
          </div>
          {mechanism.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
              {mechanism.description}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold"
              style={{
                background: `color-mix(in srgb, ${accent} 10%, transparent)`,
                color: accent,
                borderColor: `color-mix(in srgb, ${accent} 25%, transparent)`,
              }}
            >
              {KIND_LABEL[mechanism.kind] ?? mechanism.kind}
            </span>
            {mechanism.cycle_pattern && (
              <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono tabular-nums text-slate-700">
                <Activity className="h-2.5 w-2.5" />
                {mechanism.cycle_pattern}
              </span>
            )}
            <span className="text-slate-300">·</span>
            <span className="font-mono tabular-nums text-slate-500">
              {mechanism.app_count} app{mechanism.app_count === 1 ? "" : "s"}
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-mono tabular-nums text-slate-500">
              {mechanism.derived_entity_ids.length} entit
              {mechanism.derived_entity_ids.length === 1 ? "y" : "ies"} (derived)
            </span>
            {agentArr.length > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {agentArr.length} agent
                  {agentArr.length === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
          {mechanism.rationale && (
            <p className="mt-1.5 line-clamp-2 text-[10.5px] italic text-slate-500">
              {mechanism.rationale}
            </p>
          )}
          {errorMsg && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
              <AlertCircle className="h-3 w-3" />
              {errorMsg}
            </div>
          )}
          {isSaved && savedSystemId && (
            <Link
              href={`/app/space/${spaceId}/systems/${savedSystemId}`}
              className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <Check className="h-3 w-3" />
              Saved — open system →
            </Link>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || noEntities}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition",
              isSaving
                ? "cursor-wait bg-slate-100 text-slate-500"
                : noEntities
                  ? "cursor-not-allowed border border-slate-200 bg-white text-slate-400"
                  : isSaved
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "bg-violet-600 text-white hover:bg-violet-700",
            )}
            title={
              noEntities
                ? "No apps reference this mechanism yet — nothing to scope a system to."
                : isSaved
                  ? "Already saved — click to save again as a separate system."
                  : `Save the union of ${mechanism.derived_entity_ids.length} entities (across ${mechanism.app_count} app${mechanism.app_count === 1 ? "" : "s"}) as a System.`
            }
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isSaved ? (
              <Check className="h-3 w-3" />
            ) : (
              <Network className="h-3 w-3" />
            )}
            {isSaved ? "Saved" : "Save as system"}
          </button>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-md p-1.5 text-slate-300"
            title="Per-mechanism detail view is deferred."
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}
