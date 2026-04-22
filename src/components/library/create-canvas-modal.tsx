"use client";

import { useMemo, useState } from "react";
import { X, Check, Globe2, FolderKanban, Target, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CanvasCardData,
  CanvasScope,
  CanvasScopeRefType,
  CreateCanvasInput,
} from "@/types";
import { canvasScopeColors } from "@/lib/design-tokens";

interface CreateCanvasModalProps {
  onClose: () => void;
  onCreated: (canvas: CanvasCardData) => void;
  spaceOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string }>;
  appOptions: Array<{ id: string; name: string; space_id: string }>;
}

// Per-scope picker metadata: icon, helper copy, and how to resolve a
// picked ref into (scope_ref_type, scope_ref_id).
const SCOPE_META: Record<
  CanvasScope,
  {
    icon: React.ComponentType<{ className?: string }>;
    helper: string;
    refType: CanvasScopeRefType | null;
    refFieldLabel: string | null;
  }
> = {
  universal: {
    icon: Globe2,
    helper:
      "Cross-project surface. Use this canvas to intersect work from multiple projects, objectives, or apps.",
    refType: null,
    refFieldLabel: null,
  },
  project: {
    icon: FolderKanban,
    helper: "Scoped to one project (space). One active canvas per space.",
    refType: "space",
    refFieldLabel: "Project",
  },
  objective: {
    icon: Target,
    helper: "Scoped to a single improvement goal / objective.",
    refType: "improvement_goal",
    refFieldLabel: "Objective",
  },
  app: {
    icon: Boxes,
    helper: "Leaf-level canvas attached to a generated app.",
    refType: "app",
    refFieldLabel: "App",
  },
};

export function CreateCanvasModal({
  onClose,
  onCreated,
  spaceOptions,
  goalOptions,
  appOptions,
}: CreateCanvasModalProps) {
  const [scope, setScope] = useState<CanvasScope>("universal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [refId, setRefId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = SCOPE_META[scope];

  // The ref options visible in the picker depend on scope.
  const refOptions = useMemo(() => {
    if (scope === "project")
      return spaceOptions.map((s) => ({ id: s.id, label: s.name }));
    if (scope === "objective")
      return goalOptions.map((g) => ({ id: g.id, label: g.title }));
    if (scope === "app")
      return appOptions.map((a) => ({ id: a.id, label: a.name }));
    return [];
  }, [scope, spaceOptions, goalOptions, appOptions]);

  const canSubmit =
    !submitting &&
    title.trim().length >= 1 &&
    (scope === "universal" || refId.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const payload: CreateCanvasInput = {
      scope,
      title: title.trim(),
      description: description.trim() || undefined,
    };
    if (scope !== "universal" && meta.refType) {
      payload.scope_ref_type = meta.refType;
      payload.scope_ref_id = refId;
    }

    try {
      const res = await fetch("/api/canvases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create canvas");
      }
      // Hydrate optimistic shape matching CanvasCardData.
      const created: CanvasCardData = {
        ...data.canvas,
        scope_ref_name:
          scope === "universal"
            ? null
            : refOptions.find((r) => r.id === refId)?.label ?? null,
        pending_proposals: 0,
      };
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create canvas");
      setSubmitting(false);
    }
  }

  function handleScopeChange(next: CanvasScope) {
    setScope(next);
    setRefId("");  // reset ref when scope changes (different picker)
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={submitting ? undefined : onClose}
      style={{ pointerEvents: submitting ? "auto" : "auto" }}
    >
      <div
        className="mx-4 w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-interaxis-600">
              New canvas
            </div>
            <p className="mt-0.5 text-sm text-gray-600">
              Pick a scope — the canvas library groups everything by scope, so
              this can&apos;t be changed later without archiving and recreating.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {/* Scope picker — four buttons, one for each scope */}
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Scope
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(SCOPE_META) as CanvasScope[]).map((s) => {
                const c = canvasScopeColors[s];
                const M = SCOPE_META[s];
                const active = s === scope;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleScopeChange(s)}
                    className={cn(
                      "group flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all",
                      active
                        ? "shadow-sm"
                        : "border-gray-200 hover:border-gray-300",
                    )}
                    style={
                      active
                        ? {
                            background: c.tintBg,
                            borderColor: c.tintBorder,
                          }
                        : undefined
                    }
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded"
                      style={{ background: c.dot, color: "white" }}
                    >
                      <M.icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: active ? c.text : "#1D1D1F" }}
                      >
                        {c.label}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-600">
                        {M.helper}
                      </div>
                    </div>
                    {active && (
                      <Check
                        className="h-4 w-4 flex-shrink-0"
                        style={{ color: c.dot }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scope-specific ref picker */}
          {meta.refType && (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                {meta.refFieldLabel}
              </label>
              {refOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-[12px] text-amber-800">
                  You don&apos;t have any{" "}
                  {meta.refFieldLabel?.toLowerCase()}s yet. Create one first
                  before making a{" "}
                  {canvasScopeColors[scope].label.toLowerCase()} whiteboard.
                </div>
              ) : (
                <select
                  value={refId}
                  onChange={(e) => setRefId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-interaxis-600 focus:outline-none focus:ring-1 focus:ring-interaxis-600"
                >
                  <option value="" disabled>
                    Select a {meta.refFieldLabel?.toLowerCase()}…
                  </option>
                  {refOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder={
                scope === "universal"
                  ? "e.g. Retention × onboarding synthesis"
                  : "Short, descriptive name"
              }
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:border-interaxis-600 focus:outline-none focus:ring-1 focus:ring-interaxis-600"
            />
          </div>

          {/* Description (optional) */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Description <span className="text-gray-400">— optional</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="What is this whiteboard for?"
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:border-interaxis-600 focus:outline-none focus:ring-1 focus:ring-interaxis-600"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 -mx-5 -mb-5 bg-gray-50/50">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "btn-gradient-outline px-4 py-1.5 text-[13px] font-semibold",
                !canSubmit && "cursor-not-allowed opacity-50",
              )}
            >
              {submitting ? "Creating…" : "Create canvas"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
