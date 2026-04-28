"use client";

// ── Canvas add buttons (Phase 4) ─────────────────────────────────
//
// Floating action chrome for manual authoring on the whiteboard.
// Gated by spaces.manual_authoring_enabled — when false, the
// component renders nothing. When true, surfaces a stack of:
//
//   + Subject       — POST /api/spaces/[id]/subjects, spawns a
//                     SubjectCardShape on the canvas at the
//                     viewport center.
//   + Intervention  — POST /api/spaces/[id]/entities/manual with
//                     kind="intervention". Fires SSE-style window
//                     event so the painter can spawn a kg-node
//                     ghost (or user opens the entity drawer).
//   + Variable      — Same, with kind="variable" + a sub-kind picker
//                     (outcome / mediator / modifier / instrument /
//                     condition).
//   + Paper         — Triggers the existing useIngest file picker so
//                     researchers have a discoverable button instead
//                     of relying on drag-drop.
//
// All creation gestures show a tiny inline form (popover) to capture
// minimum required fields, then close. v1 keeps the form to one
// input; richer editing happens later via the entity / subject
// detail drawers.

import { useCallback, useRef, useState } from "react";
import {
  Plus,
  X,
  Loader2,
  FlaskConical,
  Beaker,
  Variable as VariableIcon,
  FileUp,
} from "lucide-react";
import type { Subject, SubjectFocusKind } from "@/types/subject";
import type { LayerOntologyRow } from "@/types/layer-ontology";

// ── Window event payloads ────────────────────────────────────────
// CanvasAddButtons mounts OUTSIDE the tldraw editor tree (it lives
// in the whiteboard page's chrome layer, not in the InFrontOfTheCanvas
// overlay slot). To spawn a tldraw shape, it dispatches a window
// CustomEvent that a tiny in-canvas listener (CanvasSubjectSpawner)
// translates into editor.createShapes(...). This keeps the button
// chrome free of tldraw's editor-context coupling.
export interface SpawnSubjectCardDetail {
  spaceId: string;
  subject: Subject;
}

interface CanvasAddButtonsProps {
  spaceId: string;
  /** Per-space toggle from spaces.manual_authoring_enabled. When
   *  false, this component renders null. */
  enabled: boolean;
  /** Optional — when provided, the +Variable form lets the user
   *  pick a layer slug from the active plan's ontology. */
  layerOntology?: LayerOntologyRow[];
  /** Callback the +Paper button calls to delegate to the existing
   *  useIngest file picker. When omitted, +Paper button hides. */
  onTriggerPaperUpload?: () => void;
}

type FormKind = null | "subject" | "intervention" | "variable";

export function CanvasAddButtons({
  spaceId,
  enabled,
  layerOntology = [],
  onTriggerPaperUpload,
}: CanvasAddButtonsProps) {
  const [open, setOpen] = useState(false);
  const [activeForm, setActiveForm] = useState<FormKind>(null);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-2">
      {open && (
        <div className="flex flex-col gap-1.5">
          <AddButton
            label="Twin"
            icon={<FlaskConical className="h-3.5 w-3.5" />}
            onClick={() => setActiveForm("subject")}
            color="from-blue-500 to-cyan-500"
          />
          <AddButton
            label="Intervention"
            icon={<Beaker className="h-3.5 w-3.5" />}
            onClick={() => setActiveForm("intervention")}
            color="from-orange-500 to-red-500"
          />
          <AddButton
            label="Variable"
            icon={<VariableIcon className="h-3.5 w-3.5" />}
            onClick={() => setActiveForm("variable")}
            color="from-emerald-500 to-teal-500"
          />
          {onTriggerPaperUpload && (
            <AddButton
              label="Paper"
              icon={<FileUp className="h-3.5 w-3.5" />}
              onClick={() => {
                onTriggerPaperUpload();
                setOpen(false);
              }}
              color="from-violet-500 to-purple-500"
            />
          )}
        </div>
      )}

      {/* Master toggle */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setActiveForm(null);
        }}
        className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[11.5px] font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-px hover:bg-white hover:shadow-md"
        title="Add intervention / variable / twin / paper to this space"
      >
        {open ? (
          <X className="h-3.5 w-3.5 text-gray-500" />
        ) : (
          <Plus className="h-3.5 w-3.5 text-gray-500" />
        )}
        Add
      </button>

      {/* Inline forms — each renders next to the button stack. */}
      {activeForm === "subject" && (
        <SubjectForm
          spaceId={spaceId}
          onClose={() => {
            setActiveForm(null);
            setOpen(false);
          }}
        />
      )}
      {activeForm === "intervention" && (
        <ManualEntityForm
          spaceId={spaceId}
          kind="intervention"
          layerOntology={layerOntology}
          onClose={() => {
            setActiveForm(null);
            setOpen(false);
          }}
        />
      )}
      {activeForm === "variable" && (
        <ManualEntityForm
          spaceId={spaceId}
          kind="variable"
          layerOntology={layerOntology}
          onClose={() => {
            setActiveForm(null);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Add button (atom) ────────────────────────────────────────────

function AddButton({
  label,
  icon,
  onClick,
  color,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full bg-gradient-to-br ${color} px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-md transition-all hover:-translate-y-px hover:shadow-lg`}
    >
      <Plus className="h-3 w-3" />
      {icon}
      {label}
    </button>
  );
}

// ── Subject form ─────────────────────────────────────────────────

const SUBJECT_FOCUS_KINDS: SubjectFocusKind[] = [
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

function SubjectForm({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [focusKind, setFocusKind] = useState<SubjectFocusKind>("topic");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/subjects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          focus_kind: focusKind,
          focus_label: name.trim(),
          source_kind: "manual",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { subject: Subject };
      // Dispatch a window event the in-canvas spawner picks up to
      // create the tldraw shape (we can't call useEditor() here
      // because this component lives outside the editor tree).
      window.dispatchEvent(
        new CustomEvent<SpawnSubjectCardDetail>("interaxis:spawn-subject-card", {
          detail: { spaceId, subject: j.subject },
        }),
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [name, focusKind, spaceId, onClose]);

  return (
    <FormShell title="New twin" onClose={onClose} error={err}>
      <input
        ref={inputRef}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder="Twin name (e.g. Healthy young adult, Working memory cohort, MyCognitiveGame)"
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <div className="flex items-center gap-2">
        <label className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
          Focus
        </label>
        <select
          value={focusKind}
          onChange={(e) => setFocusKind(e.target.value as SubjectFocusKind)}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none"
        >
          {SUBJECT_FOCUS_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <FormFooter
        busy={busy}
        canSubmit={name.trim().length > 0}
        submitLabel="Create subject"
        onSubmit={submit}
        onCancel={onClose}
      />
    </FormShell>
  );
}

// ── Manual entity form (intervention | variable) ─────────────────

function ManualEntityForm({
  spaceId,
  kind,
  layerOntology,
  onClose,
}: {
  spaceId: string;
  kind: "intervention" | "variable";
  layerOntology: LayerOntologyRow[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [variableKind, setVariableKind] =
    useState<"outcome" | "mediator" | "modifier" | "instrument" | "condition">(
      "outcome",
    );
  const [layerSlug, setLayerSlug] = useState<string>(
    layerOntology[0]?.slug ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/entities/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          kind,
          variable_kind: kind === "variable" ? variableKind : undefined,
          layer_slug: layerSlug || undefined,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      // Notify the canvas / shell that an entity has been added so
      // subscribers can re-fetch / paint. The painter listens for
      // entity_added events via SSE; for manual add we dispatch a
      // synthetic window event so the entity drawer / lookup refresh.
      const j = (await res.json()) as { entity: { id: string; name: string } };
      window.dispatchEvent(
        new CustomEvent("interaxis:entity-manually-added", {
          detail: { spaceId, entityId: j.entity.id, name: j.entity.name },
        }),
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [name, description, kind, variableKind, layerSlug, spaceId, onClose]);

  const title = kind === "intervention" ? "New intervention" : "New variable";

  return (
    <FormShell title={title} onClose={onClose} error={err}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder={
          kind === "intervention"
            ? "e.g. Aerobic exercise training (3×/week)"
            : "e.g. Working memory capacity (K)"
        }
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional description"
        rows={2}
        className="w-full resize-y rounded-md border border-gray-200 px-3 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      {kind === "variable" && (
        <div className="flex items-center gap-2">
          <label className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            Kind
          </label>
          <select
            value={variableKind}
            onChange={(e) =>
              setVariableKind(
                e.target.value as
                  | "outcome"
                  | "mediator"
                  | "modifier"
                  | "instrument"
                  | "condition",
              )
            }
            className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none"
          >
            <option value="outcome">Outcome</option>
            <option value="mediator">Mediator</option>
            <option value="modifier">Modifier</option>
            <option value="instrument">Instrument</option>
            <option value="condition">Condition</option>
          </select>
        </div>
      )}
      {layerOntology.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            Layer
          </label>
          <select
            value={layerSlug}
            onChange={(e) => setLayerSlug(e.target.value)}
            className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none"
          >
            <option value="">— unassigned —</option>
            {layerOntology.map((l) => (
              <option key={l.id} value={l.slug}>
                {l.ordinal}. {l.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <FormFooter
        busy={busy}
        canSubmit={name.trim().length > 0}
        submitLabel={kind === "intervention" ? "Create intervention" : "Create variable"}
        onSubmit={submit}
        onCancel={onClose}
      />
    </FormShell>
  );
}

// ── Form shell + footer (shared) ─────────────────────────────────

function FormShell({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  error: string | null;
}) {
  return (
    <div className="w-[320px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gray-500">
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
      {error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

function FormFooter({
  busy,
  canSubmit,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  canSubmit: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || busy}
        className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}
