"use client";

// ── Canvas scenario panel (R5 Phase A — minimum UI completion) ───────
//
// Single panel that handles both flows:
//
//   CREATE mode:
//     - Loads snapshot entities/edges for pickers
//     - User composes an action list (3 most common ScenarioAction
//       kinds: update_entity_confidence, update_edge_strength,
//       flip_edge_polarity). The other 4 kinds are supported by the
//       API and can compose via direct POST — they stay out of the
//       minimum UI to keep the surface scannable.
//     - User submits → POST /scenarios
//     - On success, switches to detail mode on the new scenario
//
//   DETAIL mode:
//     - Loads scenario + deltas
//     - Shows the action list read-only
//     - Simulate section: target entity picker + run button
//     - Results: baseline vs variant bar chart + absolute/pct lift
//
// Deliberately minimal — one panel, no nested modals. Wraps and
// re-uses the snapshot/scenario API routes shipped earlier this pass.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  Minus,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  X,
  Zap,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TwinSnapshot } from "@/types/snapshot";
import type {
  Scenario,
  ScenarioAction,
  ScenarioDelta,
} from "@/types/scenario";

// Payload shape returned by POST /scenarios/[id]/simulate.
interface SimulateResponse {
  scenarioId: string;
  snapshotId: string;
  targetEntityId: string;
  iterations: number;
  seed: number;
  integrator: "discrete" | "ode_rk4";
  baseline: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    stddev: number;
  };
  variant: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    stddev: number;
  };
  lift: { absolute: number; pct: number; direction: "up" | "down" | "flat" };
  sampleCount: number;
}

export interface CanvasScenarioPanelProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** New scenario: pass snapshotId. Detail mode: pass scenarioId. */
  mode:
    | { kind: "new"; snapshotId: string }
    | { kind: "detail"; scenarioId: string };
  /** Invoked after a successful create — parent can refresh the drawer. */
  onCreated?: (scenarioId: string) => void;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "new";
      snapshot: TwinSnapshot;
      actions: ScenarioAction[];
      label: string;
      description: string;
      submitting: boolean;
    }
  | {
      kind: "detail";
      scenario: Scenario;
      deltas: ScenarioDelta[];
      /** Snapshot loaded on-demand when the user opens the simulate section. */
      snapshot: TwinSnapshot | null;
      target: string;
      simulating: boolean;
      result: SimulateResponse | null;
    };

export function CanvasScenarioPanel({
  open,
  onClose,
  spaceId,
  mode,
  onCreated,
}: CanvasScenarioPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      if (mode.kind === "new") {
        const res = await fetch(
          `/api/spaces/${spaceId}/snapshots/${mode.snapshotId}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
        const { snapshot } = (await res.json()) as { snapshot: TwinSnapshot };
        setState({
          kind: "new",
          snapshot,
          actions: [],
          label: "",
          description: "",
          submitting: false,
        });
      } else {
        const res = await fetch(
          `/api/spaces/${spaceId}/scenarios/${mode.scenarioId}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`scenario HTTP ${res.status}`);
        const { scenario, deltas } = (await res.json()) as {
          scenario: Scenario;
          deltas: ScenarioDelta[];
        };
        setState({
          kind: "detail",
          scenario,
          deltas,
          snapshot: null,
          target: "",
          simulating: false,
          result: null,
        });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "load failed",
      });
    }
  }, [mode, spaceId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  return (
    <>
      <div
        className="pointer-events-auto fixed inset-0 z-[55] bg-black/15 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={mode.kind === "new" ? "Create scenario" : "Scenario detail"}
        className="pointer-events-auto fixed right-[440px] top-0 z-[60] flex h-full w-full max-w-[520px] flex-col border-l border-gray-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-purple-600">
              {mode.kind === "new" ? "New scenario" : "Scenario"}
            </div>
            <div className="mt-0.5 text-[14px] font-semibold text-gray-900">
              {state.kind === "new"
                ? "Compose an intervention"
                : state.kind === "detail"
                  ? state.scenario.label
                  : mode.kind === "new"
                    ? "Loading snapshot…"
                    : "Loading scenario…"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {state.kind === "loading" && (
            <div className="p-6 text-center text-[12px] text-gray-500">
              Loading…
            </div>
          )}
          {state.kind === "error" && (
            <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
              {state.message}
            </div>
          )}
          {state.kind === "new" && (
            <NewScenarioBody
              spaceId={spaceId}
              state={state}
              setState={
                setState as React.Dispatch<React.SetStateAction<PanelState>>
              }
              onCreated={(scenarioId) => {
                onCreated?.(scenarioId);
                // Auto-switch to detail mode so the user can immediately
                // simulate what they just composed.
                (async () => {
                  try {
                    const res = await fetch(
                      `/api/spaces/${spaceId}/scenarios/${scenarioId}`,
                      { cache: "no-store" },
                    );
                    if (!res.ok) return;
                    const { scenario, deltas } = (await res.json()) as {
                      scenario: Scenario;
                      deltas: ScenarioDelta[];
                    };
                    setState({
                      kind: "detail",
                      scenario,
                      deltas,
                      snapshot: null,
                      target: "",
                      simulating: false,
                      result: null,
                    });
                  } catch {
                    /* soft-fail; drawer close will reload */
                  }
                })();
              }}
            />
          )}
          {state.kind === "detail" && (
            <DetailScenarioBody
              spaceId={spaceId}
              state={state}
              setState={
                setState as React.Dispatch<React.SetStateAction<PanelState>>
              }
            />
          )}
        </div>
      </aside>
    </>
  );
}

// ── New-scenario composer ────────────────────────────────────────────

function NewScenarioBody({
  spaceId,
  state,
  setState,
  onCreated,
}: {
  spaceId: string;
  state: Extract<PanelState, { kind: "new" }>;
  setState: React.Dispatch<React.SetStateAction<PanelState>>;
  onCreated: (scenarioId: string) => void;
}) {
  const { snapshot, actions, label, description, submitting } = state;
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateField = <K extends keyof Extract<PanelState, { kind: "new" }>>(
    key: K,
    value: Extract<PanelState, { kind: "new" }>[K],
  ) => {
    setState((prev) =>
      prev.kind === "new" ? { ...prev, [key]: value } : prev,
    );
  };

  const addAction = (kind: ScenarioAction["kind"]) => {
    // Seed with reasonable defaults; user refines below.
    const firstEntity = snapshot.entities[0]?.id ?? "";
    const firstEdge = snapshot.edges[0]?.id ?? "";
    let fresh: ScenarioAction | null = null;
    if (kind === "update_entity_confidence") {
      fresh = {
        kind: "update_entity_confidence",
        entityId: firstEntity,
        confidence: 0.8,
      };
    } else if (kind === "update_edge_strength") {
      fresh = { kind: "update_edge_strength", edgeId: firstEdge, strength: 0.7 };
    } else if (kind === "flip_edge_polarity") {
      fresh = {
        kind: "flip_edge_polarity",
        edgeId: firstEdge,
        to: "positive",
      };
    }
    if (fresh) updateField("actions", [...actions, fresh]);
  };

  const updateAction = (idx: number, next: ScenarioAction) => {
    const copy = actions.slice();
    copy[idx] = next;
    updateField("actions", copy);
  };

  const removeAction = (idx: number) => {
    const copy = actions.slice();
    copy.splice(idx, 1);
    updateField("actions", copy);
  };

  const submit = async () => {
    setSubmitError(null);
    if (label.trim().length === 0) {
      setSubmitError("Label is required");
      return;
    }
    if (actions.length === 0) {
      setSubmitError("Add at least one action");
      return;
    }
    updateField("submitting", true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_snapshot_id: snapshot.id,
          label: label.trim(),
          description: description.trim() || undefined,
          actions,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { scenarioId } = (await res.json()) as { scenarioId: string };
      onCreated(scenarioId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "submit failed");
      updateField("submitting", false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Parent snapshot
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-gray-700">
          #{snapshot.root_hash.slice(0, 8)} · {snapshot.entity_count} ent ·{" "}
          {snapshot.edge_count} edges
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Label
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => updateField("label", e.target.value)}
          placeholder="e.g. Raise C3 confidence to 0.9"
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[12.5px] font-medium text-gray-900 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-200"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Description <span className="text-gray-400 normal-case">(optional)</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="What does this intervention represent?"
          rows={2}
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11.5px] text-gray-800 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-200"
        />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Actions ({actions.length})
          </span>
          <ActionAddMenu onPick={addAction} />
        </div>
        {actions.length === 0 && (
          <div className="rounded-md border border-dashed border-gray-200 bg-gray-50/40 px-3 py-4 text-center text-[11.5px] text-gray-500">
            No actions yet. Add at least one to test against the snapshot.
          </div>
        )}
        {actions.map((action, idx) => (
          <ActionRow
            key={idx}
            action={action}
            snapshot={snapshot}
            onChange={(next) => updateAction(idx, next)}
            onRemove={() => removeAction(idx)}
          />
        ))}
      </div>

      {submitError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={submit}
          disabled={submitting || actions.length === 0 || label.trim() === ""}
          className="flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-3 w-3" />
          {submitting ? "Creating…" : "Create scenario"}
        </button>
      </div>
    </div>
  );
}

// ── Action-add dropdown (3 kinds) ───────────────────────────────────

function ActionAddMenu({
  onPick,
}: {
  onPick: (kind: ScenarioAction["kind"]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
      >
        <Plus className="h-3 w-3" />
        Add action
        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 flex w-[260px] flex-col gap-0.5 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {[
            {
              kind: "update_entity_confidence" as const,
              label: "Update entity confidence",
              hint: "Change how sure we are about one entity",
            },
            {
              kind: "update_edge_strength" as const,
              label: "Update edge strength",
              hint: "Change how strong one edge is",
            },
            {
              kind: "flip_edge_polarity" as const,
              label: "Flip edge polarity",
              hint: "Change an edge from positive ↔ negative",
            },
          ].map((item) => (
            <button
              key={item.kind}
              onClick={() => {
                onPick(item.kind);
                setOpen(false);
              }}
              className="rounded px-2 py-1.5 text-left hover:bg-purple-50"
            >
              <div className="text-[11.5px] font-semibold text-gray-900">
                {item.label}
              </div>
              <div className="mt-0.5 text-[10px] text-gray-500">{item.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-action editor row ───────────────────────────────────────────

function ActionRow({
  action,
  snapshot,
  onChange,
  onRemove,
}: {
  action: ScenarioAction;
  snapshot: TwinSnapshot;
  onChange: (next: ScenarioAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-purple-600">
          {actionLabel(action)}
        </span>
        <button
          onClick={onRemove}
          className="ml-auto text-gray-400 hover:text-red-500"
          title="Remove action"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {action.kind === "update_entity_confidence" && (
        <div className="flex flex-col gap-1.5">
          <EntityPicker
            value={action.entityId}
            snapshot={snapshot}
            onChange={(id) => onChange({ ...action, entityId: id })}
          />
          <NumberSlider
            label="New confidence"
            min={0}
            max={1}
            step={0.05}
            value={action.confidence}
            onChange={(v) => onChange({ ...action, confidence: v })}
          />
        </div>
      )}
      {action.kind === "update_edge_strength" && (
        <div className="flex flex-col gap-1.5">
          <EdgePicker
            value={action.edgeId}
            snapshot={snapshot}
            onChange={(id) => onChange({ ...action, edgeId: id })}
          />
          <NumberSlider
            label="New strength"
            min={0}
            max={1}
            step={0.05}
            value={action.strength}
            onChange={(v) => onChange({ ...action, strength: v })}
          />
        </div>
      )}
      {action.kind === "flip_edge_polarity" && (
        <div className="flex flex-col gap-1.5">
          <EdgePicker
            value={action.edgeId}
            snapshot={snapshot}
            onChange={(id) => onChange({ ...action, edgeId: id })}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              New polarity
            </span>
            <select
              value={action.to}
              onChange={(e) =>
                onChange({
                  ...action,
                  to: e.target.value as typeof action.to,
                })
              }
              className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-800 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-200"
            >
              <option value="positive">positive</option>
              <option value="negative">negative</option>
              <option value="neutral">neutral</option>
              <option value="conditional">conditional</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function actionLabel(action: ScenarioAction): string {
  switch (action.kind) {
    case "update_entity_confidence":
      return "Update entity confidence";
    case "update_edge_strength":
      return "Update edge strength";
    case "flip_edge_polarity":
      return "Flip edge polarity";
    case "add_entity":
      return "Add entity";
    case "add_edge":
      return "Add edge";
    case "remove_entity":
      return "Remove entity";
    case "remove_edge":
      return "Remove edge";
  }
}

// ── Small reusable inputs ───────────────────────────────────────────

function EntityPicker({
  value,
  snapshot,
  onChange,
}: {
  value: string;
  snapshot: TwinSnapshot;
  onChange: (entityId: string) => void;
}) {
  const options = useMemo(
    () =>
      snapshot.entities
        .map((e) => ({
          id: e.id,
          label: (e as unknown as { name?: string }).name ?? e.id.slice(0, 8),
        }))
        .slice(0, 200),
    [snapshot.entities],
  );
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 w-[92px]">
        Entity
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-[11.5px] font-medium text-gray-800 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-200"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EdgePicker({
  value,
  snapshot,
  onChange,
}: {
  value: string;
  snapshot: TwinSnapshot;
  onChange: (edgeId: string) => void;
}) {
  const entityName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of snapshot.entities) {
      m.set(
        e.id,
        (e as unknown as { name?: string }).name ?? e.id.slice(0, 8),
      );
    }
    return m;
  }, [snapshot.entities]);
  const options = useMemo(
    () =>
      snapshot.edges.slice(0, 300).map((e) => ({
        id: e.id,
        label: `${entityName.get(e.source_entity_id) ?? "?"} → ${entityName.get(e.target_entity_id) ?? "?"}`,
      })),
    [snapshot.edges, entityName],
  );
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 w-[92px]">
        Edge
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-[11.5px] font-medium text-gray-800 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-200"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 w-[92px]">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-purple-600"
      />
      <span className="w-[44px] text-right font-mono text-[11px] tabular-nums text-gray-700">
        {value.toFixed(2)}
      </span>
    </label>
  );
}

// ── Scenario-detail + simulate body ─────────────────────────────────

function DetailScenarioBody({
  spaceId,
  state,
  setState,
}: {
  spaceId: string;
  state: Extract<PanelState, { kind: "detail" }>;
  setState: React.Dispatch<React.SetStateAction<PanelState>>;
}) {
  const { scenario, deltas, snapshot, target, simulating, result } = state;

  // Lazy-load the snapshot so the target entity picker has options.
  useEffect(() => {
    if (!snapshot) {
      (async () => {
        try {
          const res = await fetch(
            `/api/spaces/${spaceId}/snapshots/${scenario.parent_snapshot_id}`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const { snapshot: snap } = (await res.json()) as {
            snapshot: TwinSnapshot;
          };
          setState((prev) =>
            prev.kind === "detail" ? { ...prev, snapshot: snap } : prev,
          );
        } catch {
          /* soft-fail — picker just stays empty */
        }
      })();
    }
  }, [snapshot, scenario.parent_snapshot_id, setState, spaceId]);

  const simulate = async () => {
    if (!target) return;
    setState((prev) =>
      prev.kind === "detail" ? { ...prev, simulating: true } : prev,
    );
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/scenarios/${scenario.id}/simulate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_entity_id: target, iterations: 400 }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const r = (await res.json()) as SimulateResponse;
      setState((prev) =>
        prev.kind === "detail"
          ? { ...prev, simulating: false, result: r }
          : prev,
      );
    } catch (err) {
      setState((prev) =>
        prev.kind === "detail" ? { ...prev, simulating: false } : prev,
      );
      // Error goes to console; the UI stays quiet to avoid yet another
      // error banner. A richer error toast belongs in a later pass.
      console.warn("[scenario-panel] simulate failed:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {/* Meta row */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            STATUS_TONE[scenario.status],
          )}
        >
          {scenario.status}
        </span>
        <span className="text-[11px] text-gray-500">
          {scenario.action_count} action{scenario.action_count === 1 ? "" : "s"} ·{" "}
          {scenario.delta_count} delta
          {scenario.delta_count === 1 ? "" : "s"}
        </span>
      </div>
      {scenario.description && (
        <div className="rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2 text-[11.5px] leading-snug text-gray-700">
          {scenario.description}
        </div>
      )}

      {/* Action list (read-only) */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Actions
        </div>
        {scenario.action_list.map((a, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-md border border-gray-100 bg-white px-2.5 py-1.5"
          >
            <GitBranch className="h-3 w-3 text-purple-500" />
            <span className="text-[11px] font-medium text-gray-800">
              {actionLabel(a)}
            </span>
            <span className="ml-auto font-mono text-[10px] text-gray-400 tabular-nums">
              #{idx}
            </span>
          </div>
        ))}
      </div>

      {/* Simulate section */}
      <div className="rounded-md border border-purple-200 bg-purple-50/40 px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-purple-700">
          <Zap className="h-3 w-3" />
          Simulate
        </div>
        <div className="mb-2 text-[10.5px] leading-snug text-gray-600">
          Runs baseline MC (snapshot only) + variant MC (snapshot +
          this scenario) with the same seed. The p50 delta is real
          structural lift.
        </div>
        {snapshot ? (
          <label className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 w-[92px]">
              Target entity
            </span>
            <select
              value={target}
              onChange={(e) =>
                setState((prev) =>
                  prev.kind === "detail"
                    ? { ...prev, target: e.target.value }
                    : prev,
                )
              }
              className="flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-[11.5px] font-medium text-gray-800 focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-200"
            >
              <option value="">— Select —</option>
              {snapshot.entities.slice(0, 200).map((e) => (
                <option key={e.id} value={e.id}>
                  {(e as unknown as { name?: string }).name ??
                    e.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mb-2 text-[10.5px] italic text-gray-400">
            Loading snapshot entities…
          </div>
        )}
        <button
          onClick={simulate}
          disabled={!target || simulating}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play className="h-3 w-3" />
          {simulating ? "Running…" : "Run simulation"}
        </button>
      </div>

      {result && <ResultChart result={result} />}

      {/* R5 Phase B — commit scenario to live KG. The irreversible
          step. Only offered when scenario.status is draft or testing;
          applied/rejected/superseded scenarios don't show the button. */}
      {(scenario.status === "draft" || scenario.status === "testing") && (
        <CommitSection
          spaceId={spaceId}
          scenario={scenario}
          simulated={Boolean(result)}
          onCommitted={(applied) => {
            // Re-load the scenario so the panel reflects the new
            // applied status + linked post_snapshot_id.
            (async () => {
              try {
                const res = await fetch(
                  `/api/spaces/${spaceId}/scenarios/${scenario.id}`,
                  { cache: "no-store" },
                );
                if (!res.ok) return;
                const { scenario: updated, deltas: updatedDeltas } =
                  (await res.json()) as {
                    scenario: Scenario;
                    deltas: ScenarioDelta[];
                  };
                setState((prev) =>
                  prev.kind === "detail"
                    ? {
                        ...prev,
                        scenario: updated,
                        deltas: updatedDeltas,
                      }
                    : prev,
                );
              } catch {
                /* soft-fail */
              }
              // Surface the applied count via console for now — a
              // toast belongs in a later pass.
              console.log(
                `[scenario-panel] committed ${applied.actionsApplied}/${scenario.action_count} actions (${applied.actionsSkipped.length} skipped)${applied.postSnapshotId ? `; post-snapshot ${applied.postSnapshotId}` : ""}`,
              );
            })();
          }}
        />
      )}

      {scenario.status === "applied" && scenario.post_snapshot_id && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
            <Check className="h-3 w-3" />
            Applied to live KG
          </div>
          <div className="text-[10.5px] leading-snug text-gray-600">
            Actions were committed on{" "}
            {scenario.applied_at
              ? new Date(scenario.applied_at).toLocaleString()
              : "—"}
            . Post-intervention snapshot{" "}
            <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[9.5px]">
              {scenario.post_snapshot_id.slice(0, 8)}…
            </code>{" "}
            captures the post-change state for before/after delta.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Commit section with HITL confirm dialog ─────────────────────────
//
// The brief's gate-only HITL default lives here in UI form: clicking
// "Commit to live KG" opens an in-panel confirm card that explains
// the irreversible step, lists the action count, warns about the
// absence of auto-rollback, and offers skip-post-snapshot for power
// users. Only the second button actually POSTs — first-click can't
// commit.

function CommitSection({
  spaceId,
  scenario,
  simulated,
  onCommitted,
}: {
  spaceId: string;
  scenario: Scenario;
  simulated: boolean;
  onCommitted: (r: {
    actionsApplied: number;
    actionsSkipped: Array<{ action_index: number; reason: string }>;
    postSnapshotId: string | null;
  }) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [skipSnapshot, setSkipSnapshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/scenarios/${scenario.id}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            skip_post_snapshot: skipSnapshot,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const r = (await res.json()) as {
        actionsApplied: number;
        actionsSkipped: Array<{ action_index: number; reason: string }>;
        postSnapshotId: string | null;
      };
      setSubmitting(false);
      setConfirmOpen(false);
      onCommitted(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "commit failed");
      setSubmitting(false);
    }
  };

  if (!confirmOpen) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50/30 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-rose-700">
          <ShieldAlert className="h-3 w-3" />
          Commit to live KG
        </div>
        <div className="mb-2 text-[10.5px] leading-snug text-gray-600">
          Replays this scenario&apos;s actions against the real{" "}
          <code className="font-mono">entities</code> /{" "}
          <code className="font-mono">edges</code> tables.{" "}
          <span className="font-semibold text-rose-800">
            Irreversible.
          </span>{" "}
          {simulated
            ? "Simulate first and confirm the lift before committing."
            : "You haven't simulated this scenario yet — recommended before applying."}
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-50"
        >
          <ShieldAlert className="h-3 w-3" />
          Commit to live KG…
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-3 ring-1 ring-rose-200">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-rose-800">
        <ShieldAlert className="h-3.5 w-3.5" />
        Confirm commit
      </div>
      <div className="mb-3 text-[11px] leading-relaxed text-rose-900">
        You are about to apply{" "}
        <span className="font-semibold">
          {scenario.action_count} action
          {scenario.action_count === 1 ? "" : "s"}
        </span>{" "}
        to the live KG. Each action mutates a real{" "}
        <code className="font-mono">entities</code> or{" "}
        <code className="font-mono">edges</code> row. There is no
        auto-rollback — if an action errors mid-stream, the scenario
        stays in its current status but some rows may already have
        been changed. Simulate first to confirm the expected lift.
      </div>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px] text-gray-700">
        <input
          type="checkbox"
          checked={skipSnapshot}
          onChange={(e) => setSkipSnapshot(e.target.checked)}
          className="h-3 w-3 accent-rose-600"
        />
        Skip post-intervention snapshot (not recommended — defeats
        before/after delta)
      </label>
      {error && (
        <div className="mb-2 rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] text-red-800">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setConfirmOpen(false);
            setError(null);
          }}
          disabled={submitting}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={commit}
          disabled={submitting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
        >
          {submitting ? (
            "Committing…"
          ) : (
            <>
              <ShieldAlert className="h-3 w-3" />
              Yes, commit
            </>
          )}
        </button>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  testing: "bg-blue-50 text-blue-700",
  applied: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  superseded: "bg-amber-50 text-amber-700",
};

// ── Before/after chart ──────────────────────────────────────────────

function ResultChart({ result }: { result: SimulateResponse }) {
  // Shared x-scale across both bars so they're comparable at a glance.
  const [lo, hi] = useMemo(() => {
    const all = [
      result.baseline.p10,
      result.baseline.p90,
      result.variant.p10,
      result.variant.p90,
    ];
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (max - min < 1e-4) {
      min -= 0.5;
      max += 0.5;
    }
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }, [result]);

  const liftAbs = result.lift.absolute;
  const liftPct = result.lift.pct * 100;
  const liftTone =
    result.lift.direction === "up"
      ? "text-emerald-600"
      : result.lift.direction === "down"
        ? "text-rose-600"
        : "text-gray-500";
  const LiftIcon =
    result.lift.direction === "up"
      ? Plus
      : result.lift.direction === "down"
        ? Minus
        : ArrowRight;

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
        <Zap className="h-3 w-3 text-blue-600" />
        Before / after
        <span className="ml-auto flex items-center gap-0.5 font-mono text-[10px] text-gray-400 tabular-nums normal-case">
          <Bot className="h-2.5 w-2.5" />
          {result.iterations} samples · seed {result.seed}
        </span>
      </div>

      <DistributionRow
        label="Baseline"
        dist={result.baseline}
        scaleMin={lo}
        scaleMax={hi}
        accent="#64748b"
      />
      <DistributionRow
        label="Variant"
        dist={result.variant}
        scaleMin={lo}
        scaleMax={hi}
        accent="#8b5cf6"
      />

      <div className="mt-2 flex items-baseline justify-between border-t border-gray-100 pt-2">
        <span className="text-[10.5px] font-bold uppercase tracking-widest text-gray-500">
          Lift
        </span>
        <span className={cn("flex items-baseline gap-1.5", liftTone)}>
          <LiftIcon className="h-3 w-3" />
          <span className="font-mono text-[13px] font-bold tabular-nums">
            {liftAbs >= 0 ? "+" : ""}
            {liftAbs.toFixed(3)}
          </span>
          <span className="font-mono text-[11px] tabular-nums">
            ({liftPct >= 0 ? "+" : ""}
            {liftPct.toFixed(1)}%)
          </span>
        </span>
      </div>
    </div>
  );
}

function DistributionRow({
  label,
  dist,
  scaleMin,
  scaleMax,
  accent,
}: {
  label: string;
  dist: SimulateResponse["baseline"];
  scaleMin: number;
  scaleMax: number;
  accent: string;
}) {
  const span = Math.max(scaleMax - scaleMin, 1e-4);
  const pctP10 = ((dist.p10 - scaleMin) / span) * 100;
  const pctP50 = ((dist.p50 - scaleMin) / span) * 100;
  const pctP90 = ((dist.p90 - scaleMin) / span) * 100;
  const bandWidth = Math.max(pctP90 - pctP10, 0.5);
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex items-baseline justify-between text-[10px]">
        <span className="font-bold uppercase tracking-wider text-gray-500">
          {label}
        </span>
        <span className="font-mono tabular-nums text-gray-700">
          {dist.p10.toFixed(2)} → {dist.p50.toFixed(2)} → {dist.p90.toFixed(2)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-gray-100">
        <div
          className="absolute top-0 bottom-0 rounded-full opacity-80"
          style={{
            left: `${pctP10}%`,
            width: `${bandWidth}%`,
            background: accent,
          }}
        />
        <div
          className="absolute top-[-2px] h-[12px] w-[2px] -translate-x-1/2 rounded-full bg-gray-900 shadow"
          style={{ left: `${pctP50}%` }}
        />
      </div>
    </div>
  );
}
