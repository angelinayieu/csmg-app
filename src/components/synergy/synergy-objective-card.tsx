// ── Synergy processing — Objective card ──
//
// Three states:
//   1. Empty (no objective_statement) → CTA to "Detect from board"
//   2. Read-only (saved objective) → statement + constraints +
//      success_criteria, with re-detect + edit buttons
//   3. Editing → textarea + lists with add/remove + Save / Cancel
//
// detect, save are passed in from the parent so the same card can be
// reused on the processing page and (later) inline on the whiteboard.

"use client";

import { useState } from "react";
import {
  Crosshair,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Target,
  Trash2,
  X,
} from "lucide-react";
import type { DetectedObjective } from "@/lib/synergy/types";

interface ObjectiveValue extends DetectedObjective {
  detected_at: string | null;
}

interface Props {
  objective: ObjectiveValue;
  detecting: boolean;
  saving: boolean;
  onDetect: () => void;
  onSave: (next: DetectedObjective) => void;
}

export function SynergyObjectiveCard({
  objective,
  detecting,
  saving,
  onDetect,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DetectedObjective>({
    statement: objective.statement,
    constraints: [...objective.constraints],
    success_criteria: [...objective.success_criteria],
  });

  const empty = !objective.statement;

  const startEdit = () => {
    setDraft({
      statement: objective.statement,
      constraints: [...objective.constraints],
      success_criteria: [...objective.success_criteria],
    });
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const save = () => {
    const cleaned: DetectedObjective = {
      statement: draft.statement.trim(),
      constraints: draft.constraints.map((c) => c.trim()).filter(Boolean),
      success_criteria: draft.success_criteria.map((c) => c.trim()).filter(Boolean),
    };
    onSave(cleaned);
    setEditing(false);
  };

  if (empty && !editing) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <Crosshair className="mx-auto mb-3 h-6 w-6 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          No objective detected yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          Let the AI read your board and infer what you&apos;re actually trying
          to achieve. You can refine it by hand after.
        </p>
        <button
          onClick={onDetect}
          disabled={detecting}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
        >
          {detecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Crosshair className="h-4 w-4" />
          )}
          Detect from board
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
          <Target className="h-3 w-3 text-blue-600" />
          Objective
          {objective.detected_at && !editing && (
            <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
              AI-detected
            </span>
          )}
          {!objective.detected_at && objective.statement && !editing && (
            <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
              user-edited
            </span>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={onDetect}
              disabled={detecting}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
              title="Re-detect objective from the current board"
            >
              {detecting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Re-detect
            </button>
            <button
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <Editable draft={draft} setDraft={setDraft} />
      ) : (
        <ReadOnly objective={objective} />
      )}

      {editing && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={cancel}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-700 transition hover:text-gray-900"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save objective
          </button>
        </div>
      )}
    </div>
  );
}

function ReadOnly({ objective }: { objective: ObjectiveValue }) {
  return (
    <>
      <p className="mt-3 text-xl font-semibold leading-snug text-gray-900">
        {objective.statement}
      </p>

      {objective.constraints.length > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gray-500">
            Constraints
          </div>
          <ul className="space-y-1">
            {objective.constraints.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-800"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {objective.success_criteria.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gray-500">
            Success criteria
          </div>
          <ul className="space-y-1">
            {objective.success_criteria.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Editable({
  draft,
  setDraft,
}: {
  draft: DetectedObjective;
  setDraft: (n: DetectedObjective) => void;
}) {
  const setStatement = (s: string) => setDraft({ ...draft, statement: s });
  const setItem = (key: "constraints" | "success_criteria", i: number, v: string) =>
    setDraft({ ...draft, [key]: draft[key].map((x, j) => (j === i ? v : x)) });
  const addItem = (key: "constraints" | "success_criteria") =>
    draft[key].length < 10 && setDraft({ ...draft, [key]: [...draft[key], ""] });
  const removeItem = (key: "constraints" | "success_criteria", i: number) =>
    setDraft({ ...draft, [key]: draft[key].filter((_, j) => j !== i) });

  return (
    <>
      <textarea
        value={draft.statement}
        onChange={(e) => setStatement(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="What are you trying to achieve, in one sentence?"
        className="mt-3 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-lg font-semibold leading-snug text-gray-900 outline-none transition focus:border-blue-400"
      />
      <EditList
        label="Constraints"
        items={draft.constraints}
        onChange={(i, v) => setItem("constraints", i, v)}
        onRemove={(i) => removeItem("constraints", i)}
        onAdd={() => addItem("constraints")}
        accent="border-gray-200 bg-gray-50"
      />
      <EditList
        label="Success criteria"
        items={draft.success_criteria}
        onChange={(i, v) => setItem("success_criteria", i, v)}
        onRemove={(i) => removeItem("success_criteria", i)}
        onAdd={() => addItem("success_criteria")}
        accent="border-emerald-200 bg-emerald-50"
      />
    </>
  );
}

function EditList({
  label,
  items,
  onChange,
  onRemove,
  onAdd,
  accent,
}: {
  label: string;
  items: string[];
  onChange: (i: number, v: string) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  accent: string;
}) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li
            key={i}
            className={`flex items-center gap-2 rounded-md border ${accent} px-2 py-1`}
          >
            <input
              value={item}
              onChange={(e) => onChange(i, e.target.value)}
              maxLength={300}
              className="flex-1 bg-transparent px-1 py-1 text-sm outline-none"
            />
            <button
              onClick={() => onRemove(i)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 transition hover:bg-rose-50 hover:text-rose-600"
              aria-label="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={onAdd}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  );
}
