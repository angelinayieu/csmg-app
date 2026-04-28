"use client";

// ── Canvas lasso → save-as-subject button (Phase 6C) ─────────────
//
// Sibling to CanvasLassoSystemButton. Same lasso-extraction logic,
// different action: turns the selection into both a System (the
// scope) AND a Subject (the experiment composition pointing at
// that system). Atomic via /api/spaces/[id]/subjects/from-lasso.
//
// Renders next to the system button when ≥1 entity is extractable.
// Click → opens a tiny inline form for name + focus_kind, then
// POSTs. On success: dispatches the existing
// `interaxis:spawn-subject-card` event so the new SubjectCard lands
// on the canvas at viewport center.

import { useCallback, useMemo, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { FlaskConical, Loader2, Check, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Subject, SubjectFocusKind } from "@/types/subject";

interface ExtractedEntities {
  ids: string[];
  shapeCount: number;
  shapeKindLabel: string;
}

function extractEntityIdsFromSelection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedShapes: Array<any>,
): ExtractedEntities {
  const ids = new Set<string>();
  let shellCount = 0;
  let synthCount = 0;
  for (const shape of selectedShapes) {
    if (shape.type === "probability-space-shell") {
      shellCount++;
      try {
        const parsed = JSON.parse(shape.props.entitiesJson ?? "[]");
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            if (e && typeof e.entityId === "string") ids.add(e.entityId);
          }
        }
      } catch {
        /* malformed */
      }
    } else if (shape.type === "synthesis-intersection-card") {
      synthCount++;
      try {
        const parsed = JSON.parse(shape.props.rowsJson ?? "[]");
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            if (r && typeof r.entityId === "string") ids.add(r.entityId);
          }
        }
      } catch {
        /* malformed */
      }
    }
  }
  let label = "selection";
  if (shellCount > 0 && synthCount === 0) {
    label = shellCount === 1 ? "lens" : `${shellCount} lenses`;
  } else if (synthCount > 0 && shellCount === 0) {
    label = "synthesis convergence";
  } else if (shellCount > 0 && synthCount > 0) {
    label = `${shellCount} lens${shellCount === 1 ? "" : "es"} + synthesis`;
  }
  return {
    ids: Array.from(ids),
    shapeCount: shellCount + synthCount,
    shapeKindLabel: label,
  };
}

const FOCUS_KIND_OPTIONS: SubjectFocusKind[] = [
  "topic",
  "person",
  "document",
  "product",
  "environment",
  "system",
  "data",
  "reaction",
  "other",
];

interface Props {
  spaceId: string;
}

export function CanvasLassoSubjectButton({ spaceId }: Props) {
  const editor = useEditor();
  const [state, setState] = useState<"idle" | "open" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [focusKind, setFocusKind] = useState<SubjectFocusKind>("topic");

  const extracted = useValue<ExtractedEntities>(
    "lasso-subject-extract",
    () => extractEntityIdsFromSelection(editor?.getSelectedShapes() ?? []),
    [editor],
  );

  const onSave = useCallback(async () => {
    if (extracted.ids.length === 0 || !name.trim() || state === "saving") return;
    setState("saving");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/subjects/from-lasso`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            focus_kind: focusKind,
            focus_label: name.trim(),
            entity_ids: extracted.ids,
            description: `Scoped to ${extracted.ids.length} entities lassoed from ${extracted.shapeKindLabel}.`,
          }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`save failed: ${res.status} ${txt.slice(0, 120)}`);
      }
      const j = (await res.json()) as { subject: Subject | null };
      if (!j.subject) {
        throw new Error(
          "System saved but subject creation soft-failed. Try again from the Subjects panel.",
        );
      }
      // Spawn the SubjectCard shape via the existing window event
      // (handled by CanvasSubjectCardSpawner inside the editor).
      window.dispatchEvent(
        new CustomEvent("interaxis:spawn-subject-card", {
          detail: { spaceId, subject: j.subject },
        }),
      );
      setState("saved");
      setName("");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
      window.setTimeout(() => setState("idle"), 2400);
    }
  }, [
    extracted.ids,
    extracted.shapeKindLabel,
    name,
    focusKind,
    spaceId,
    state,
  ]);

  const showButton = useMemo(() => {
    return extracted.shapeCount > 0 && extracted.ids.length > 0;
  }, [extracted.shapeCount, extracted.ids.length]);

  if (!showButton) return null;

  return (
    <div
      // Top-right area, slightly above the system lasso button so
      // they stack visibly. Editor's lasso selection drives both.
      className="pointer-events-none absolute right-12 top-[3.4rem] z-[45]"
      role="region"
      aria-label="Save selection as subject"
    >
      {state === "open" ? (
        <div className="pointer-events-auto w-[300px] rounded-xl border border-blue-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
              New subject from lasso
            </span>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-2 text-[10.5px] text-gray-600">
            Scope: <strong>{extracted.ids.length}</strong> entit
            {extracted.ids.length === 1 ? "y" : "ies"} from{" "}
            {extracted.shapeKindLabel}.
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Subject name"
            className="mb-2 w-full rounded-md border border-gray-200 px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") setState("idle");
            }}
          />
          <div className="mb-2 flex items-center gap-2">
            <label className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
              Focus
            </label>
            <select
              value={focusKind}
              onChange={(e) => setFocusKind(e.target.value as SubjectFocusKind)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none"
            >
              {FOCUS_KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setState("idle")}
              className="rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!name.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create subject
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setState("open")}
          disabled={state === "saving"}
          className={cn(
            "pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-md transition",
            state === "saved"
              ? "border-emerald-300/60 bg-emerald-50 text-emerald-700"
              : state === "error"
                ? "border-red-300/60 bg-red-50 text-red-700"
                : "border-blue-200/70 bg-white/95 text-blue-700 hover:-translate-y-px hover:shadow-md",
          )}
          title={
            state === "saved"
              ? "Subject created"
              : state === "error"
                ? errorMsg ?? "Failed"
                : `Create a Subject scoped to ${extracted.ids.length} entities`
          }
        >
          {state === "saving" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : state === "saved" ? (
            <Check className="h-3 w-3" />
          ) : state === "error" ? (
            <AlertCircle className="h-3 w-3" />
          ) : (
            <FlaskConical className="h-3 w-3" />
          )}
          {state === "saved"
            ? "Subject saved"
            : state === "error"
              ? "Error"
              : `Make Subject (${extracted.ids.length})`}
        </button>
      )}
    </div>
  );
}
