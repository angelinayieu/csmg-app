"use client";

// ── System detail page ──
// Route: /app/space/[id]/systems/[systemId]
//
// Phase 5 — the inspect target for a saved System. Renders:
//   - Header: name, description, source-kind chip, classification
//     chips (Open/Closed, Probabilistic/Deterministic, Complex/Simple),
//     and the three core actions: Edit · Open in lab · Archive · Delete
//   - Composition mini-graph: real force-directed render of the
//     system's entities + edges (uses the same force-layout helper
//     the probability-space-shells use)
//   - Entity list with kind chips + click-through to the entity detail
//   - Contained cycles strip — every cycle whose entities sit fully
//     inside the system
//   - "Open in lab" deep-link to /app/space/[id]/lab?systemId=...
//     (lab page reads the query param and scopes its hero pool /
//     reagent bay to this system's entities)
//
// Hydrates from /api/systems/[id] (GET → SystemDetailResponse, which
// already returns hydrated entities + edges + contained_cycles).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  FlaskConical,
  Trash2,
  Archive,
  Pencil,
  Save,
  Network,
  GitBranch,
  Activity,
  Cog,
  Hand,
  Hexagon,
  Triangle,
  Lock,
  Unlock,
  Dice5,
  CircleDot,
  AlertCircle,
  Repeat,
  Plus,
  Minus,
  Check,
  Search,
  X,
} from "lucide-react";
import type { Entity } from "@/types";
import { cn } from "@/lib/utils";
import {
  ENTITY_KIND_ACCENT,
  ENTITY_KIND_LABEL,
  classifyEntityKind,
} from "@/lib/entities/kind-classifier";
import {
  SYSTEM_SOURCE_LABEL,
  type System,
  type SystemDetailResponse,
  type SystemSourceKind,
} from "@/types/system";
import { computeForceLayout } from "@/lib/graph/force-layout";

const SOURCE_ICON: Record<SystemSourceKind, typeof Network> = {
  cycle: Activity,
  convergent_point: GitBranch,
  root_cause_subtree: Triangle,
  mechanism: Cog,
  user_lasso: Hand,
  manual: Hexagon,
};

const SOURCE_ACCENT: Record<SystemSourceKind, string> = {
  cycle: "#0891b2",
  convergent_point: "#7c3aed",
  root_cause_subtree: "#dc2626",
  mechanism: "#ea580c",
  user_lasso: "#0284c7",
  manual: "#64748b",
};

const POLARITY_STROKE = {
  positive: "rgba(22, 163, 74, 0.6)",
  negative: "rgba(220, 38, 38, 0.6)",
  conditional: "rgba(217, 119, 6, 0.6)",
  neutral: "rgba(100, 116, 139, 0.5)",
} as const;

const CYCLE_TONE: Record<string, string> = {
  reinforcing: "bg-rose-50 text-rose-700 ring-rose-200",
  reinforcing_positive: "bg-rose-50 text-rose-700 ring-rose-200",
  reinforcing_negative: "bg-orange-50 text-orange-700 ring-orange-200",
  balancing: "bg-blue-50 text-blue-700 ring-blue-200",
};

export default function SystemDetailPage() {
  const params = useParams<{ id: string; systemId: string }>();
  const router = useRouter();
  const spaceId = params.id;
  const systemId = params.systemId;

  const [data, setData] = useState<SystemDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit-name state. Compact inline editor so users don't need a
  // dialog to fix a typo.
  const [editingName, setEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A/B compare-with picker — list of OTHER systems in this space
  // available to pair with. Lazily loaded the first time the user
  // opens the picker so the detail page paints fast even when the
  // space has many systems.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [otherSystems, setOtherSystems] = useState<System[] | null>(null);
  const [otherSystemsLoading, setOtherSystemsLoading] = useState(false);

  // Composition editor state — when toggled on, the Entities section
  // swaps from a read-only grid to a checklist sourced from the
  // entity catalog. Saves via PATCH /api/systems/[id]; the server
  // re-runs the classifier + updates summary stats so flags +
  // counters refresh on the next read.
  const [editMode, setEditMode] = useState(false);
  const [allEntities, setAllEntities] = useState<Entity[] | null>(null);
  const [allEntitiesLoading, setAllEntitiesLoading] = useState(false);
  const [stagedIds, setStagedIds] = useState<Set<string> | null>(null);
  const [stagedSaving, setStagedSaving] = useState(false);
  const [editQuery, setEditQuery] = useState("");
  // Click-outside-to-dismiss for the compare-with picker. Keeps the
  // small dropdown from being trapped open when the user clicks
  // anywhere else on the page.
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const node = pickerRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    // Defer one tick so the click that opened the picker isn't
    // immediately caught here.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", onEsc);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [pickerOpen]);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/systems/${systemId}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const json = (await r.json()) as SystemDetailResponse;
      setData(json);
      setEditedName(json.system.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  const onSaveName = async () => {
    if (!data || !editedName.trim() || editedName.trim() === data.system.name)
      return;
    setSavingMeta(true);
    try {
      const r = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editedName.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      await fetchDetail();
      setEditingName(false);
    } catch (err) {
      console.warn("[system detail] name save failed:", err);
    } finally {
      setSavingMeta(false);
    }
  };

  const onArchive = async () => {
    if (!data) return;
    setArchiving(true);
    try {
      const nextStatus =
        data.system.status === "archived" ? "active" : "archived";
      const r = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!r.ok) throw new Error(await r.text());
      await fetchDetail();
    } catch (err) {
      console.warn("[system detail] archive failed:", err);
    } finally {
      setArchiving(false);
    }
  };

  const openComparePicker = useCallback(async () => {
    setPickerOpen((v) => !v);
    if (otherSystems !== null) return; // already loaded
    setOtherSystemsLoading(true);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/systems`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      const list = Array.isArray(json?.systems)
        ? (json.systems as System[]).filter((s) => s.id !== systemId)
        : [];
      setOtherSystems(list);
    } catch (err) {
      console.warn("[system detail] compare-picker load failed:", err);
      setOtherSystems([]);
    } finally {
      setOtherSystemsLoading(false);
    }
  }, [otherSystems, spaceId, systemId]);

  const enterEditMode = useCallback(async () => {
    if (!data) return;
    setEditMode(true);
    setStagedIds(new Set(data.system.entity_ids));
    setEditQuery("");
    if (allEntities !== null) return; // already cached this mount
    setAllEntitiesLoading(true);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/entities/catalog`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      const list = Array.isArray(json?.entities)
        ? (json.entities as Entity[])
        : [];
      setAllEntities(list);
    } catch (err) {
      console.warn("[system detail] entity catalog load failed:", err);
      setAllEntities([]);
    } finally {
      setAllEntitiesLoading(false);
    }
  }, [data, spaceId, allEntities]);

  const exitEditMode = () => {
    setEditMode(false);
    setStagedIds(null);
    setEditQuery("");
  };

  const onSaveComposition = async () => {
    if (!data || !stagedIds) return;
    const next = Array.from(stagedIds);
    if (next.length === 0) {
      window.alert("A system must contain at least one entity.");
      return;
    }
    setStagedSaving(true);
    try {
      const r = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_ids: next }),
      });
      if (!r.ok) throw new Error(await r.text());
      await fetchDetail();
      setEditMode(false);
      setStagedIds(null);
      setEditQuery("");
    } catch (err) {
      console.warn("[system detail] composition save failed:", err);
      window.alert(
        `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setStagedSaving(false);
    }
  };

  const toggleStagedId = (id: string) => {
    setStagedIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onDelete = async () => {
    if (!data) return;
    if (
      !window.confirm(
        `Delete system "${data.system.name}"? This cannot be undone. The underlying entities and edges remain in the space.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/systems/${systemId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      router.push(`/app/space/${spaceId}/systems`);
    } catch (err) {
      console.warn("[system detail] delete failed:", err);
      setDeleting(false);
    }
  };

  // ── Mini-graph layout (memoized on data) ───────────────────────
  const graphLayout = useMemo(() => {
    if (!data) return null;
    const entities = data.entities.map((e) => ({
      id: e.id,
      weight: typeof e.confidence === "number" ? e.confidence : 0.5,
    }));
    const edges = data.edges.map((e) => ({
      source: e.source_entity_id,
      target: e.target_entity_id,
    }));
    return computeForceLayout(entities, edges, {
      width: 720,
      height: 360,
      padding: 16,
    });
  }, [data]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading system…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white">
        <AlertCircle className="h-8 w-8 text-rose-400" />
        <div className="text-[13px] font-medium text-slate-700">
          Couldn&apos;t load this system
        </div>
        <div className="text-[11px] text-slate-500">{error}</div>
        <Link
          href={`/app/space/${spaceId}/systems`}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to systems
        </Link>
      </div>
    );
  }

  const { system, entities, edges, contained_cycles } = data;
  const Icon = SOURCE_ICON[system.source_kind];
  const accent = SOURCE_ACCENT[system.source_kind];
  const idToEntity = new Map(entities.map((e) => [e.id, e]));

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      {/* ── Header ── */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
          <Link
            href={`/app/space/${spaceId}/systems`}
            className="inline-flex items-center gap-1 hover:text-slate-700"
          >
            <ArrowLeft className="h-3 w-3" /> Systems
          </Link>
          <span className="text-slate-300">/</span>
          <span className="truncate font-medium text-slate-700">
            {system.name}
          </span>
          {system.status === "archived" && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
              archived
            </span>
          )}
        </div>

        <div className="flex items-start gap-4">
          {/* Source badge */}
          <div
            className="mt-0.5 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
              border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
            }}
            title={SYSTEM_SOURCE_LABEL[system.source_kind]}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            {/* Source label + name */}
            <div
              className="text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: accent }}
            >
              {SYSTEM_SOURCE_LABEL[system.source_kind]} · System
            </div>
            {editingName ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="flex-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-[16px] font-semibold outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onSaveName();
                    if (e.key === "Escape") {
                      setEditedName(system.name);
                      setEditingName(false);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={onSaveName}
                  disabled={savingMeta}
                  className="rounded-md bg-violet-600 p-1.5 text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70"
                  title="Save name (Enter)"
                >
                  {savingMeta ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ) : (
              <h1
                className="mt-1 text-[18px] font-semibold leading-tight tracking-tight text-slate-900"
                onDoubleClick={() => setEditingName(true)}
                title="Double-click to rename"
              >
                {system.name}
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="ml-2 rounded p-0.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                  title="Rename"
                  aria-label="Rename"
                >
                  <Pencil className="inline-block h-3 w-3" />
                </button>
              </h1>
            )}
            {system.description && (
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-600">
                {system.description}
              </p>
            )}

            {/* Classification + counts */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
              <ClassificationChip
                icon={system.is_open ? Unlock : Lock}
                label={system.is_open ? "Open" : "Closed"}
                tone={system.is_open ? "amber" : "slate"}
                tooltip={
                  system.is_open
                    ? "Has connections crossing the system boundary — needs external monitoring."
                    : "Self-contained — no boundary-crossing edges or bridges."
                }
              />
              <ClassificationChip
                icon={system.is_probabilistic ? Dice5 : CircleDot}
                label={
                  system.is_probabilistic ? "Probabilistic" : "Deterministic"
                }
                tone={system.is_probabilistic ? "violet" : "slate"}
                tooltip={
                  system.is_probabilistic
                    ? `Median edge confidence ${
                        system.median_edge_confidence != null
                          ? `${Math.round(system.median_edge_confidence * 100)}%`
                          : "—"
                      } — needs Monte Carlo.`
                    : "High-confidence edges — supports analytical reasoning."
                }
              />
              <ClassificationChip
                icon={system.is_complex ? Activity : AlertCircle}
                label={system.is_complex ? "Complex" : "Simple"}
                tone={system.is_complex ? "rose" : "slate"}
                tooltip={
                  system.is_complex
                    ? `Contains ${system.cycle_count} feedback loop${system.cycle_count === 1 ? "" : "s"}.`
                    : "No feedback loops — supports direct intervention."
                }
              />
              <span className="ml-1 text-slate-400">·</span>
              <span className="font-mono tabular-nums text-slate-500">
                {system.entity_count} entit
                {system.entity_count === 1 ? "y" : "ies"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-mono tabular-nums text-slate-500">
                {system.edge_count} edge
                {system.edge_count === 1 ? "" : "s"}
              </span>
              {system.cycle_count > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {system.cycle_count} cycle
                    {system.cycle_count === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action stack */}
          <div className="relative flex flex-shrink-0 flex-col gap-2">
            <Link
              href={`/app/space/${spaceId}/lab?systemId=${systemId}`}
              className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-violet-700"
              title="Open this system in the lab — scopes hero pool + reagent bay to its entities."
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Open in lab
              <ArrowRight className="h-3 w-3" />
            </Link>
            {/* A/B compare-with picker. Lazy-loads sibling systems on
                first open. Click a sibling → navigates to /lab with
                both systemId + systemB query params, surfacing the
                A/B swap pill in the lab header. */}
            <div ref={pickerRef}>
              <button
                type="button"
                onClick={openComparePicker}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-1 text-[10.5px] font-semibold text-cyan-700 transition hover:bg-cyan-100"
                title="Pair this system with another to compare them in the lab."
              >
                ⇄ Compare with…
              </button>
              {pickerOpen && (
                <div className="absolute right-0 z-20 mt-1 w-56 max-h-[280px] overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                  {otherSystemsLoading ? (
                    <div className="flex items-center justify-center gap-1 px-2 py-3 text-[10px] text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading systems…
                    </div>
                  ) : (otherSystems ?? []).length === 0 ? (
                    <div className="px-2 py-3 text-center text-[10px] italic text-slate-400">
                      No other systems to pair with yet.
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {(otherSystems ?? []).map((other) => (
                        <li key={other.id}>
                          <Link
                            href={`/app/space/${spaceId}/lab?systemId=${systemId}&systemB=${other.id}`}
                            className="block rounded px-2 py-1.5 text-[11px] hover:bg-cyan-50"
                            onClick={() => setPickerOpen(false)}
                          >
                            <div className="truncate font-medium text-slate-800">
                              {other.name}
                            </div>
                            <div className="truncate text-[9.5px] text-slate-500">
                              {other.entity_count} entities ·{" "}
                              {SYSTEM_SOURCE_LABEL[other.source_kind]}
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={onArchive}
                disabled={archiving}
                className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10.5px] text-slate-600 hover:bg-slate-50 disabled:cursor-wait"
                title={
                  system.status === "archived" ? "Restore to active" : "Archive"
                }
              >
                {archiving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Archive className="h-3 w-3" />
                )}
                {system.status === "archived" ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-[10.5px] text-rose-700 hover:bg-rose-50 disabled:cursor-wait"
                title="Delete system (entities/edges remain in space)"
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Mini-graph */}
        <section className="mb-6">
          <SectionHeading title="Composition" subtitle="Force-directed view of the system's entities + edges" />
          <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4">
            {graphLayout && entities.length > 0 ? (
              <SystemMiniGraph
                width={720}
                height={360}
                nodes={graphLayout.nodes}
                edges={edges}
                idToEntity={idToEntity}
                coreId={graphLayout.coreId}
                spaceId={spaceId}
              />
            ) : (
              <div className="py-8 text-center text-[11px] italic text-slate-400">
                no composition to render
              </div>
            )}
          </div>
        </section>

        {/* Cycles */}
        {contained_cycles.length > 0 && (
          <section className="mb-6">
            <SectionHeading
              title="Contained feedback loops"
              subtitle={`${contained_cycles.length} cycle${
                contained_cycles.length === 1 ? "" : "s"
              } whose entities sit fully inside this system`}
            />
            <ul className="space-y-2">
              {contained_cycles.map((c) => {
                const tone = CYCLE_TONE[c.classification] ?? CYCLE_TONE.balancing;
                const cycleEntities = c.entity_ids
                  .map((id) => idToEntity.get(id))
                  .filter((e): e is NonNullable<typeof e> => Boolean(e));
                return (
                  <li
                    key={c.id}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Repeat className="h-3 w-3 text-slate-400" />
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] ring-1",
                          tone,
                        )}
                      >
                        {c.classification.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {c.entity_ids.length} nodes
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {cycleEntities.map((e, i) => (
                        <span
                          key={e.id}
                          className="inline-flex items-center gap-1"
                        >
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-700">
                            {e.name}
                          </span>
                          {i < cycleEntities.length - 1 && (
                            <ArrowRight className="h-2.5 w-2.5 text-slate-300" />
                          )}
                        </span>
                      ))}
                      {cycleEntities.length > 0 && (
                        <span className="text-[10px] italic text-slate-400">
                          ↺ loops back
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Entities table — read-mode default, swaps to composition
            editor when user toggles edit mode. */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <SectionHeading
              title={editMode ? "Edit composition" : "Entities"}
              subtitle={
                editMode
                  ? `${stagedIds?.size ?? 0} of ${allEntities?.length ?? "—"} entities selected (server reclassifies on save)`
                  : `${entities.length} entit${entities.length === 1 ? "y" : "ies"} composing this system`
              }
            />
            {editMode ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={exitEditMode}
                  disabled={stagedSaving}
                  className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait"
                  title="Discard changes"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSaveComposition}
                  disabled={stagedSaving || (stagedIds?.size ?? 0) === 0}
                  className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
                  title="Save composition + reclassify"
                >
                  {stagedSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={enterEditMode}
                className="flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10.5px] font-semibold text-violet-700 hover:bg-violet-100"
                title="Edit which entities are part of this system"
              >
                <Pencil className="h-3 w-3" />
                Edit composition
              </button>
            )}
          </div>

          {editMode ? (
            <CompositionEditor
              spaceId={spaceId}
              loading={allEntitiesLoading}
              allEntities={allEntities ?? []}
              stagedIds={stagedIds ?? new Set()}
              originalIds={new Set(system.entity_ids)}
              onToggle={toggleStagedId}
              query={editQuery}
              onQueryChange={setEditQuery}
            />
          ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entities.map((entity) => {
              const kind = classifyEntityKind(entity);
              const kAccent = ENTITY_KIND_ACCENT[kind];
              return (
                <li key={entity.id}>
                  <Link
                    href={`/app/space/${spaceId}/entity/${entity.id}`}
                    className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-violet-300 hover:bg-violet-50/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{
                            background: `color-mix(in srgb, ${kAccent} 14%, transparent)`,
                            color: kAccent,
                          }}
                        >
                          <span
                            className="inline-block h-1 w-1 rounded-full"
                            style={{ background: kAccent }}
                          />
                          {ENTITY_KIND_LABEL[kind]}
                        </span>
                        <div className="mt-1 truncate text-[12.5px] font-semibold text-slate-900">
                          {entity.name}
                        </div>
                      </div>
                      {entity.is_leverage_point && (
                        <span
                          className="flex-shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[8.5px] font-bold uppercase text-amber-700"
                          title="Leverage point"
                        >
                          LP
                        </span>
                      )}
                    </div>
                    {entity.description && (
                      <p className="mt-1 line-clamp-2 text-[10.5px] text-slate-600">
                        {entity.description}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          )}
        </section>
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        Saved {new Date(system.created_at).toLocaleString()} · Updated{" "}
        {new Date(system.updated_at).toLocaleString()} · Source:{" "}
        {SYSTEM_SOURCE_LABEL[system.source_kind]}
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </h2>
      {subtitle && (
        <span className="text-[10px] text-slate-400">{subtitle}</span>
      )}
    </div>
  );
}

function ClassificationChip({
  icon: Icon,
  label,
  tooltip,
  tone,
}: {
  icon: typeof Lock;
  label: string;
  tooltip: string;
  tone: "amber" | "violet" | "rose" | "slate";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  } as const;
  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold",
        tones[tone],
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function SystemMiniGraph({
  width,
  height,
  nodes,
  edges,
  idToEntity,
  coreId,
  spaceId,
}: {
  width: number;
  height: number;
  nodes: Array<{ id: string; x: number; y: number; degree: number }>;
  edges: Array<{
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    polarity?: string | null;
    confidence?: number | null;
  }>;
  idToEntity: Map<string, { id: string; name: string }>;
  coreId: string | null;
  spaceId: string;
}) {
  const positionById = useMemo(() => {
    const m = new Map<string, { x: number; y: number; degree: number }>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));
  const router = useRouter();

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", maxHeight: 360 }}
    >
      {/* Edges */}
      {edges.map((edge) => {
        const a = positionById.get(edge.source_entity_id);
        const b = positionById.get(edge.target_entity_id);
        if (!a || !b) return null;
        const polarity = (edge.polarity ?? "neutral") as keyof typeof POLARITY_STROKE;
        const stroke = POLARITY_STROKE[polarity] ?? POLARITY_STROKE.neutral;
        const opacity =
          0.45 + Math.max(0, Math.min(1, edge.confidence ?? 0.5)) * 0.55;
        const dashed = polarity === "conditional";
        return (
          <line
            key={edge.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={stroke}
            strokeWidth={1.4}
            strokeDasharray={dashed ? "5 3" : undefined}
            opacity={opacity}
          />
        );
      })}
      {/* Nodes */}
      {nodes.map((n) => {
        const isCore = n.id === coreId;
        const r = 8 + (n.degree / maxDegree) * 10;
        const entity = idToEntity.get(n.id);
        return (
          <g
            key={n.id}
            style={{ cursor: "pointer" }}
            onClick={() => router.push(`/app/space/${spaceId}/entity/${n.id}`)}
          >
            {isCore && (
              <circle
                cx={n.x}
                cy={n.y}
                r={r + 6}
                fill="rgba(124, 58, 237, 0.16)"
              />
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill="white"
              stroke={isCore ? "#7c3aed" : "rgba(15,23,42,0.45)"}
              strokeWidth={isCore ? 2.4 : 1.5}
            />
            <text
              x={n.x}
              y={n.y + r + 12}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={isCore ? 700 : 500}
              fill={isCore ? "#7c3aed" : "#0f172a"}
              style={{ pointerEvents: "none" }}
            >
              {(entity?.name ?? "").slice(0, 22)}
            </text>
            <title>{entity?.name ?? n.id}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ── Composition editor ────────────────────────────────────────────
//
// Inline checklist that lets users add/remove entities from a saved
// system. Sources its candidate set from the entity catalog API
// (every entity in the space). Shows current members preselected;
// changes are staged client-side until "Save" — at which point the
// detail page POSTs PATCH /api/systems/[id] with the new
// entity_ids[]. The server re-runs the classifier so is_open /
// is_probabilistic / is_complex + summary stats refresh.
//
// Entries marked as "added" / "removed" / "unchanged" relative to
// the original membership get visual diff cues (green ring on
// added, rose strikethrough on removed) so the user can see the
// pending changeset at a glance before committing.

function CompositionEditor({
  spaceId,
  loading,
  allEntities,
  stagedIds,
  originalIds,
  onToggle,
  query,
  onQueryChange,
}: {
  spaceId: string;
  loading: boolean;
  allEntities: Entity[];
  stagedIds: Set<string>;
  originalIds: Set<string>;
  onToggle: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEntities;
    return allEntities.filter((e) => {
      const hay = `${e.name ?? ""} ${e.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allEntities, query]);

  const addedCount = useMemo(() => {
    let n = 0;
    for (const id of stagedIds) if (!originalIds.has(id)) n++;
    return n;
  }, [stagedIds, originalIds]);
  const removedCount = useMemo(() => {
    let n = 0;
    for (const id of originalIds) if (!stagedIds.has(id)) n++;
    return n;
  }, [stagedIds, originalIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-8 text-[12px] text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading entity catalog…
      </div>
    );
  }

  if (allEntities.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[12px] text-slate-500">
        No entities in this space yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter entities…"
            className="w-full rounded-md border border-slate-200 bg-white py-1 pl-8 pr-2 text-[11.5px] outline-none placeholder:text-slate-400 focus:border-violet-400"
          />
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {addedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
              <Plus className="h-2.5 w-2.5" />
              {addedCount} adding
            </span>
          )}
          {removedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700">
              <Minus className="h-2.5 w-2.5" />
              {removedCount} removing
            </span>
          )}
          {addedCount === 0 && removedCount === 0 && (
            <span className="text-slate-400 italic">no changes</span>
          )}
        </div>
      </div>

      {/* Entity rows */}
      <ul className="max-h-[480px] overflow-y-auto">
        {filtered.map((entity) => {
          const checked = stagedIds.has(entity.id);
          const wasOriginal = originalIds.has(entity.id);
          const isAdded = checked && !wasOriginal;
          const isRemoved = !checked && wasOriginal;
          const kind = classifyEntityKind(entity);
          const kAccent = ENTITY_KIND_ACCENT[kind];
          return (
            <li key={entity.id} className="border-b border-slate-50 last:border-b-0">
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 transition hover:bg-slate-50",
                  isAdded && "bg-emerald-50/60",
                  isRemoved && "bg-rose-50/60",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(entity.id)}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-400"
                />
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{
                    background: `color-mix(in srgb, ${kAccent} 14%, transparent)`,
                    color: kAccent,
                  }}
                >
                  <span
                    className="inline-block h-1 w-1 rounded-full"
                    style={{ background: kAccent }}
                  />
                  {ENTITY_KIND_LABEL[kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-[11.5px] font-medium",
                      isRemoved
                        ? "text-rose-700 line-through"
                        : "text-slate-900",
                    )}
                  >
                    {entity.name}
                  </div>
                  {entity.description && (
                    <div className="truncate text-[10px] text-slate-500">
                      {entity.description}
                    </div>
                  )}
                </div>
                {isAdded && (
                  <span className="rounded bg-emerald-100 px-1 py-0.5 text-[8.5px] font-bold uppercase text-emerald-700">
                    +
                  </span>
                )}
                {isRemoved && (
                  <span className="rounded bg-rose-100 px-1 py-0.5 text-[8.5px] font-bold uppercase text-rose-700">
                    −
                  </span>
                )}
                {wasOriginal && checked && !isAdded && (
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[8.5px] font-bold uppercase text-slate-500">
                    member
                  </span>
                )}
              </label>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-[11px] italic text-slate-400">
            No entities match &quot;{query}&quot;.
          </li>
        )}
      </ul>
      <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
        {filtered.length} of {allEntities.length} entities · server
        recomputes is_open / is_probabilistic / is_complex on save
      </div>
      {/* Hint about the spaceId so the unused param doesn't dangle —
          we keep it on the component signature to make future
          per-space scoping (e.g., bulk-add by axis) trivial. */}
      <span className="hidden">{spaceId}</span>
    </div>
  );
}
