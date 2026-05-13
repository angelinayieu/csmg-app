// ── Synergy processing — Components card ──
//
// Renders the structured output of /api/synergy/sessions/[id]/extract:
//   - Core ideas (the central concept)
//   - Upstream (what the project NEEDS — data, skills, capital, etc.)
//   - Downstream (what the project PRODUCES — outputs, artifacts, services)
//   - Polished products (specific deliverables that could be built)
//
// Each component is the unit Phase 4's matcher will rank against other
// users' components. This card surfaces visibility ('matchable_only' is
// the default) so the user knows what's exposed.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Compass,
  Globe,
  Lightbulb,
  Loader2,
  Lock,
  Network,
  Package,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  BrainstormComponent,
  ComponentKind,
  ComponentVisibility,
} from "@/lib/synergy/types";

interface Props {
  components: BrainstormComponent[] | null;
  loading: boolean;
  hasNodes: boolean;
  onExtract: () => void;
}

const KIND_META: Record<
  ComponentKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  // Apple-style restraint: all four kinds share a uniform white card.
  // The kind is communicated by the section header icon color, not by
  // a tinted card background. Keeps the per-kind list visually quiet
  // — content reads through, not the chrome.
  core_idea: {
    label: "Core ideas",
    icon: Lightbulb,
    tone: "border-gray-200 bg-white",
  },
  upstream: {
    label: "Upstream (needs)",
    icon: ArrowUp,
    tone: "border-gray-200 bg-white",
  },
  downstream: {
    label: "Downstream (produces)",
    icon: ArrowDown,
    tone: "border-gray-200 bg-white",
  },
  polished_product: {
    label: "Polished products",
    icon: Package,
    tone: "border-gray-200 bg-white",
  },
};

export function SynergyComponentsCard({
  components,
  loading,
  hasNodes,
  onExtract,
}: Props) {
  // Initial state: never extracted yet.
  if (components === null) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <Compass className="mx-auto mb-3 h-6 w-6 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          Extract your components
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          Distill the board into typed components: upstream needs (data,
          skills, audience), downstream outputs (artifacts, insights), and
          polished products. These will be the units other users can match
          against.
        </p>
        <button
          onClick={onExtract}
          disabled={loading || !hasNodes}
          title={!hasNodes ? "Add some nodes first" : "Run extraction"}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Extract components
        </button>
      </div>
    );
  }

  // Group by kind for display, preserving DB order within each kind.
  const grouped = new Map<ComponentKind, BrainstormComponent[]>();
  for (const c of components) {
    const list = grouped.get(c.kind) ?? [];
    list.push(c);
    grouped.set(c.kind, list);
  }

  const orderedKinds: ComponentKind[] = [
    "core_idea",
    "upstream",
    "downstream",
    "polished_product",
  ];

  return (
    <ComponentsCardWithSelection
      components={components}
      grouped={grouped}
      orderedKinds={orderedKinds}
      onExtract={onExtract}
      loading={loading}
    />
  );
}

// ── ComponentsCardWithSelection ──
//
// Wraps the per-kind sections with multi-select state + a sticky
// bulk-action bar. Selection is in-page state only; clearing on
// re-extract because the row IDs change. Bulk operations fan out
// to the existing per-component PATCH/DELETE endpoints in parallel
// so we don't need a new bulk API surface.

function ComponentsCardWithSelection({
  components,
  grouped,
  orderedKinds,
  onExtract,
  loading,
}: {
  components: BrainstormComponent[];
  grouped: Map<ComponentKind, BrainstormComponent[]>;
  orderedKinds: ComponentKind[];
  onExtract: () => void;
  loading: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  // Drop selections that no longer exist after a re-extract or
  // delete. Cheap stable check.
  const allIds = useMemo(() => new Set(components.map((c) => c.id)), [components]);
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allIds]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(components.map((c) => c.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const runBulkVisibility = async (visibility: ComponentVisibility) => {
    if (busy || selectedIds.size === 0) return;
    setBusy("visibility");
    const ids = Array.from(selectedIds);
    let ok = 0;
    let failed = 0;
    try {
      const { updateComponent } = await import("@/lib/synergy/client");
      const { toast } = await import("@/lib/hooks/use-toast");
      const results = await Promise.allSettled(
        ids.map((id) => updateComponent(id, { visibility })),
      );
      for (const r of results) {
        if (r.status === "fulfilled") ok++;
        else failed++;
      }
      if (failed === 0) {
        toast.success(
          `${ok} component${ok === 1 ? "" : "s"} → ${VISIBILITY_LABEL[visibility]}`,
        );
      } else {
        toast.error(`${ok} updated, ${failed} failed`);
      }
      // Note: parent will re-fetch / re-render on its own update path
      // (most parents reload components after a successful action).
      // For surfaces that don't, the local visibility chip would stay
      // out of date until refresh — acceptable for v1.
    } finally {
      setBusy(null);
    }
  };

  const runBulkDelete = async () => {
    if (busy || selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedIds.size} component${selectedIds.size === 1 ? "" : "s"}? This also removes any related match suggestions.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    const ids = Array.from(selectedIds);
    let ok = 0;
    let failed = 0;
    try {
      const { deleteComponent } = await import("@/lib/synergy/client");
      const { toast } = await import("@/lib/hooks/use-toast");
      const results = await Promise.allSettled(
        ids.map((id) => deleteComponent(id)),
      );
      for (const r of results) {
        if (r.status === "fulfilled") ok++;
        else failed++;
      }
      clearSelection();
      if (failed === 0) {
        toast.success(`Deleted ${ok}`);
      } else {
        toast.error(`${ok} deleted, ${failed} failed`);
      }
    } finally {
      setBusy(null);
    }
  };

  const allSelected = selectedIds.size === components.length && components.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
          <Package className="h-3 w-3 text-blue-600" />
          Components
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
            {components.length} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={allSelected ? clearSelection : selectAll}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
          <button
            onClick={onExtract}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
            title="Re-extract from current board"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Re-extract
          </button>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-gray-500">
        These are the units Phase 4&apos;s matcher will rank against other
        users&apos; components. Visibility default is{" "}
        <span className="font-mono text-gray-700">matchable_only</span> — only
        shown to candidates whose components complement yours.
      </p>

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          busy={busy}
          onSetVisibility={runBulkVisibility}
          onDelete={runBulkDelete}
          onClear={clearSelection}
        />
      )}

      <div className="mt-5 space-y-5">
        {orderedKinds.map((kind) => {
          const list = grouped.get(kind);
          if (!list || list.length === 0) return null;
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          return (
            <section key={kind}>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-900">
                <Icon className="h-3.5 w-3.5 text-blue-600" />
                {meta.label}
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
                  {list.length}
                </span>
              </div>
              <ul className="space-y-2">
                {list.map((c) => (
                  <SelectableRow
                    key={c.id}
                    component={c}
                    toneClass={meta.tone}
                    selected={selectedIds.has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const VISIBILITY_LABEL: Record<ComponentVisibility, string> = {
  private: "private",
  matchable_only: "matchable",
  public: "public",
};

// Sticky bulk action bar — only renders when selection is non-empty.
function BulkActionBar({
  count,
  busy,
  onSetVisibility,
  onDelete,
  onClear,
}: {
  count: number;
  busy: string | null;
  onSetVisibility: (v: ComponentVisibility) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 p-2.5"
      role="region"
      aria-label="Bulk actions"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-blue-700">
        {count} selected
      </span>
      <div className="ml-1 inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white p-0.5">
        <BulkBtn
          label="Mark matchable"
          icon={Network}
          tone="blue"
          busy={busy === "visibility"}
          onClick={() => onSetVisibility("matchable_only")}
        />
        <BulkBtn
          label="Make public"
          icon={Globe}
          tone="emerald"
          busy={busy === "visibility"}
          onClick={() => onSetVisibility("public")}
        />
        <BulkBtn
          label="Make private"
          icon={Lock}
          tone="gray"
          busy={busy === "visibility"}
          onClick={() => onSetVisibility("private")}
        />
      </div>
      <button
        onClick={onDelete}
        disabled={!!busy}
        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:border-rose-400 disabled:opacity-60"
      >
        {busy === "delete" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Trash2 className="h-3 w-3" />
        )}
        Delete
      </button>
      <button
        onClick={onClear}
        disabled={!!busy}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-600 transition hover:border-gray-400 disabled:opacity-60"
      >
        <X className="h-3 w-3" />
        Clear
      </button>
    </div>
  );
}

function BulkBtn({
  label,
  icon: Icon,
  tone,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "blue" | "emerald" | "gray";
  busy: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    blue: "text-blue-700 hover:bg-blue-50",
    emerald: "text-emerald-700 hover:bg-emerald-50",
    gray: "text-gray-700 hover:bg-gray-100",
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${toneClass}`}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}

// SelectableRow wraps the existing ExpandableComponentRow with a
// checkbox column on the left. Inline checkbox click doesn't bubble
// to the row's expand-toggle — separate hit target.
function SelectableRow({
  component,
  toneClass,
  selected,
  onToggle,
}: {
  component: BrainstormComponent;
  toneClass: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="group flex items-start gap-2">
      <label
        className="mt-3 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-gray-300 bg-white transition hover:border-blue-400"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
          aria-label={`Select ${component.label_public}`}
        />
      </label>
      <div className="min-w-0 flex-1">
        <ExpandableComponentRow component={component} toneClass={toneClass} />
      </div>
    </li>
  );
}

// ── Inline edit for label_public + description_public ──
//
// Click the label or description → switches to an inline textarea
// with autosize. Cmd+Enter (or click-out) saves via the existing
// PATCH /api/synergy/components/[id] endpoint; ESC cancels. Both
// fields preserve their typography so the read/edit transition
// feels seamless. description_private gets its own disclosure
// because it's not user-facing — read-only for v1 (Phase 4d+2 can
// make it editable too).

function ComponentInlineEdit({
  component,
}: {
  component: BrainstormComponent;
}) {
  const [label, setLabel] = useState(component.label_public);
  const [description, setDescription] = useState(component.description_public);
  const [editing, setEditing] = useState<null | "label" | "description">(null);
  const [busy, setBusy] = useState(false);

  // Reset local state if the row gets re-extracted server-side
  useEffect(() => {
    setLabel(component.label_public);
    setDescription(component.description_public);
  }, [component.label_public, component.description_public]);

  const save = async (field: "label" | "description", value: string) => {
    const trimmed = value.trim();
    const prev =
      field === "label" ? component.label_public : component.description_public;
    if (trimmed === prev) {
      setEditing(null);
      return;
    }
    if (trimmed.length === 0) {
      // Empty rollback — neither field is allowed to be blank.
      if (field === "label") setLabel(prev);
      else setDescription(prev);
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      const { updateComponent } = await import("@/lib/synergy/client");
      const { toast } = await import("@/lib/hooks/use-toast");
      const updated = await updateComponent(component.id, {
        [field === "label" ? "label_public" : "description_public"]: trimmed,
      });
      // Server returns the canonical row — adopt it
      setLabel(updated.label_public);
      setDescription(updated.description_public);
      toast.success(`Updated ${field}`);
    } catch (err) {
      // Roll back
      if (field === "label") setLabel(prev);
      else setDescription(prev);
      const { toast } = await import("@/lib/hooks/use-toast");
      toast.error("Save failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
      setEditing(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {editing === "label" ? (
          <InlineTextarea
            initialValue={label}
            rows={1}
            multiline={false}
            placeholder="Component label"
            className="text-sm font-semibold text-gray-900"
            onSave={(v) => save("label", v)}
            onCancel={() => {
              setLabel(component.label_public);
              setEditing(null);
            }}
          />
        ) : (
          <div
            onClick={() => !busy && setEditing("label")}
            title="Click to edit"
            className="cursor-text rounded text-sm font-semibold text-gray-900 transition hover:bg-white/60"
          >
            {label}
          </div>
        )}
        {component.subkind && (
          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
            {component.subkind}
          </span>
        )}
      </div>
      {editing === "description" ? (
        <InlineTextarea
          initialValue={description}
          rows={2}
          multiline={true}
          placeholder="Self-contained public description"
          className="mt-1 text-[12px] leading-snug text-gray-700"
          onSave={(v) => save("description", v)}
          onCancel={() => {
            setDescription(component.description_public);
            setEditing(null);
          }}
        />
      ) : (
        <p
          onClick={() => !busy && setEditing("description")}
          title="Click to edit"
          className="mt-1 cursor-text rounded text-[12px] leading-snug text-gray-700 transition hover:bg-white/60"
        >
          {description}
        </p>
      )}
      {component.description_private && (
        <details className="mt-2 text-[11px] text-gray-500">
          <summary className="cursor-pointer select-none font-mono text-[9px] uppercase tracking-wider text-gray-500 hover:text-gray-900">
            private context
          </summary>
          <p className="mt-1 rounded-md bg-white/60 p-2 leading-snug">
            {component.description_private}
          </p>
        </details>
      )}
    </>
  );
}

// Compact inline-edit textarea — autoresizes, Cmd+Enter saves, ESC cancels,
// blur commits. Shared by both the label (1-line) and description (multi-line)
// modes via the `multiline` flag.
function InlineTextarea({
  initialValue,
  rows,
  multiline,
  placeholder,
  className,
  onSave,
  onCancel,
}: {
  initialValue: string;
  rows: number;
  multiline: boolean;
  placeholder: string;
  className: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onSave(value);
        } else if (!multiline && e.key === "Enter") {
          e.preventDefault();
          onSave(value);
        }
      }}
      onBlur={() => {
        if (value.trim() !== initialValue.trim()) onSave(value);
        else onCancel();
      }}
      className={[
        "w-full resize-none rounded-md border border-blue-300 bg-white px-2 py-1 outline-none ring-2 ring-blue-100",
        className,
      ].join(" ")}
    />
  );
}

// ── Visibility popover (Phase 4d+1) ──
//
// Click the chip → small dropdown reveals the three visibility
// options with descriptions. Selecting a new value PATCHes the row
// and shows a toast. Optimistic local update; rollback on error.
//
// Exported so focus-mode-stage2 and other surfaces can drop in the
// same interactive chip without duplicating the popover logic.

export function VisibilityPopover({
  component,
}: {
  component: BrainstormComponent;
}) {
  // We dynamic-import the toast + client to avoid pulling the whole
  // synergy/client bundle into pages that never edit a component.
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<BrainstormComponent["visibility"]>(
    component.visibility,
  );
  const [busy, setBusy] = useState(false);
  const meta = VISIBILITY_META[current];
  const Icon = meta.icon;

  const setVisibility = async (
    next: BrainstormComponent["visibility"],
  ) => {
    if (busy || next === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const prev = current;
    setCurrent(next); // optimistic
    try {
      const { updateComponent } = await import("@/lib/synergy/client");
      const { toast } = await import("@/lib/hooks/use-toast");
      await updateComponent(component.id, { visibility: next });
      toast.success(`Visibility → ${VISIBILITY_META[next].label}`, {
        description:
          next === "private"
            ? "Removed from match suggestions. Existing matches remain."
            : next === "public"
              ? "Visible in any future global feed."
              : "Surfaces only to users with complementary needs.",
      });
    } catch (err) {
      setCurrent(prev);
      const { toast } = await import("@/lib/hooks/use-toast");
      toast.error("Visibility update failed", {
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={busy}
        title="Change visibility"
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition hover:scale-105 ${meta.className} disabled:opacity-60`}
      >
        <Icon className="h-2.5 w-2.5" />
        {meta.label}
        {busy && (
          <span className="ml-0.5 inline-block h-1 w-1 animate-pulse rounded-full bg-current" />
        )}
      </button>
      {open && (
        <>
          {/* Click-out scrim */}
          <div
            className="fixed inset-0 z-30"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur-xl">
            <div className="border-b border-gray-100 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
              Visibility
            </div>
            <ul>
              {(
                ["matchable_only", "private", "public"] as const
              ).map((opt) => {
                const m = VISIBILITY_META[opt];
                const OIcon = m.icon;
                const active = opt === current;
                return (
                  <li key={opt}>
                    <button
                      onClick={() => setVisibility(opt)}
                      disabled={busy}
                      className={[
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition",
                        active ? "bg-blue-50/60" : "hover:bg-gray-50",
                      ].join(" ")}
                    >
                      <OIcon
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? "text-blue-700" : "text-gray-500"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`flex items-center gap-1 text-[12px] font-semibold ${active ? "text-blue-900" : "text-gray-900"}`}
                        >
                          {m.label}
                          {active && (
                            <span className="font-mono text-[8px] uppercase tracking-wider text-blue-700">
                              · current
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10.5px] leading-snug text-gray-600">
                          {m.help}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-gray-100 bg-gray-50/50 px-3 py-1.5 font-mono text-[9px] leading-snug text-gray-500">
              Going private removes the component from match suggestions.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const VISIBILITY_META: Record<
  BrainstormComponent["visibility"],
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
    help: string;
  }
> = {
  private: {
    label: "private",
    className: "bg-gray-100 text-gray-700",
    icon: Lock,
    help: "Stays on your board only. Never enters the matching pool.",
  },
  matchable_only: {
    label: "matchable",
    className: "bg-blue-100 text-blue-700",
    icon: Network,
    help: "Surfaces to users with complementary components. Anonymous until accept.",
  },
  public: {
    label: "public",
    className: "bg-emerald-100 text-emerald-700",
    icon: Globe,
    help: "Visible in any future global feed (Phase 5+).",
  },
};

// ── ExpandableComponentRow ──
//
// The new "door to a room" card design. Collapsed state shows the
// label, a kind tag, the match-availability status, and a chevron.
// Expanded state reveals the description, private context, an
// anonymous avatar peek of matched collaborators, and three actions:
// regenerate (re-run this component only), open room (deep-link to
// /discover with this component focused), and the visibility toggle.

export function ExpandableComponentRow({
  component,
  toneClass,
}: {
  component: BrainstormComponent;
  toneClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(component);
  const [regenerating, setRegenerating] = useState(false);
  const matchCount = c.match_count ?? 0;
  const roomReady = matchCount > 0;

  const onRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const { regenerateComponent } = await import("@/lib/synergy/client");
      const { toast } = await import("@/lib/hooks/use-toast");
      const { component: updated, match_count } = await regenerateComponent(
        component.id,
      );
      setC({ ...updated, match_count });
      toast.success(
        match_count > 0
          ? `Regenerated · ${match_count} collaborator${match_count === 1 ? "" : "s"} found`
          : "Regenerated · indexing for matches",
      );
    } catch (err) {
      const { toast } = await import("@/lib/hooks/use-toast");
      toast.error("Regenerate failed", { description: (err as Error).message });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div
      className={[
        "group rounded-xl border transition",
        toneClass,
        // Subtle lift on hover only when collapsed — the expanded
        // state already has its own visual weight.
        !open && "hover:shadow-sm",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* ── Collapsed header (always visible) ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left transition"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-[13px] font-semibold text-gray-900">
              {c.label_public}
            </div>
            {c.subkind && (
              <span className="rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-gray-600">
                {c.subkind}
              </span>
            )}
            <MatchAvailabilityBadge
              matchCount={matchCount}
              visibility={c.visibility}
            />
          </div>
        </div>
        <RoomReadyPeek
          componentId={c.id}
          matchCount={matchCount}
          visible={!open && roomReady}
        />
        <ChevronIcon open={open} />
      </button>

      {/* ── Expanded body ── */}
      {open && (
        <div className="border-t border-white/40 bg-white/60 px-3 py-3 backdrop-blur-sm">
          <p className="text-[12.5px] leading-relaxed text-gray-700">
            {c.description_public}
          </p>

          {c.description_private && (
            <details className="mt-3 text-[11.5px] text-gray-600">
              <summary className="cursor-pointer select-none font-mono text-[9px] uppercase tracking-wider text-gray-500 hover:text-gray-900">
                ▸ private context (owner only)
              </summary>
              <p className="mt-1.5 rounded-md bg-white/80 p-2.5 leading-relaxed">
                {c.description_private}
              </p>
            </details>
          )}

          {roomReady && (
            <div className="mt-3 rounded-lg bg-white/80 p-2.5 ring-1 ring-blue-100">
              <div className="flex items-center gap-2">
                <AvatarPeekRow seedBase={c.id} count={Math.min(matchCount, 4)} />
                <span className="text-[11px] text-gray-700">
                  <strong className="font-semibold text-gray-900">
                    {matchCount}
                  </strong>{" "}
                  potential collaborator{matchCount === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-gray-500">
                Anonymous until you accept a connection request.
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {roomReady && (
              <a
                href={`/app/synergy/discover?focus=${c.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
              >
                <Sparkles className="h-3 w-3" />
                Open room around this
              </a>
            )}
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              title="Re-extract just this component (others stay put)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
            >
              {regenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Regenerate
            </button>
            <div className="ml-auto">
              <VisibilityPopover component={c} />
            </div>
          </div>

          <div className="mt-3 border-t border-gray-100 pt-2">
            <ComponentInlineEdit component={c} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Match-availability badge ──
//
// Three states the user needs to distinguish at a glance:
//   - room-ready: N collaborators standing by (matchable visibility + N>0)
//   - indexing: matchable but no matches yet (we're searching)
//   - private: explicitly excluded from matching

function MatchAvailabilityBadge({
  matchCount,
  visibility,
}: {
  matchCount: number;
  visibility: BrainstormComponent["visibility"];
}) {
  if (visibility === "private") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
        <Lock className="h-3 w-3" />
        private
      </span>
    );
  }
  if (matchCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
        <Sparkles className="h-3 w-3" />
        room-ready · {matchCount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-700">
      <Loader2 className="h-3 w-3" />
      indexing
    </span>
  );
}

// ── Inline avatar peek used in the collapsed-card right side ──
//
// Shows up to 3 abstract avatars (deterministic gradient from
// component_id + index) when there are matches. Acts as the visual
// signal "real people are over there." Real photos only reveal post
// accept (Phase 4c+).

function RoomReadyPeek({
  componentId,
  matchCount,
  visible,
}: {
  componentId: string;
  matchCount: number;
  visible: boolean;
}) {
  if (!visible) return null;
  const show = Math.min(matchCount, 3);
  return (
    <div className="flex shrink-0 -space-x-2">
      {Array.from({ length: show }).map((_, i) => (
        <AbstractAvatar key={i} seed={`${componentId}:${i}`} size={20} ringWhite />
      ))}
      {matchCount > show && (
        <span className="ml-2 inline-flex items-center font-mono text-[9px] uppercase tracking-wider text-gray-500">
          +{matchCount - show}
        </span>
      )}
    </div>
  );
}

function AvatarPeekRow({
  seedBase,
  count,
}: {
  seedBase: string;
  count: number;
}) {
  return (
    <div className="flex -space-x-2">
      {Array.from({ length: count }).map((_, i) => (
        <AbstractAvatar key={i} seed={`${seedBase}:${i}`} size={28} ringWhite />
      ))}
    </div>
  );
}

// Lightweight wrapper so we don't import the style-builder at the top
// of every file. Kept inline here because the components card is the
// only consumer for v1.
function AbstractAvatar({
  seed,
  size,
  ringWhite,
}: {
  seed: string;
  size: number;
  ringWhite?: boolean;
}) {
  // Inline computation — avoids importing the helper file just for
  // a tiny gradient. Mirrors abstractAvatarFor() exactly.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = h >>> 0;
  const hue = h % 360;
  const offset = 30 + ((h >>> 8) % 90);
  const hue2 = (hue + offset) % 360;
  const initials = (() => {
    const A = "ABCDEFGHJKLMNPQRSTVWXYZ";
    return `${A[(h >>> 4) % A.length]}${A[(h >>> 12) % A.length]}`;
  })();
  return (
    <span
      className={[
        "inline-flex items-center justify-center font-semibold tracking-tight text-white",
        ringWhite && "ring-2 ring-white",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, hsl(${hue}, 65%, 60%) 0%, hsl(${hue2}, 70%, 55%) 100%)`,
        fontSize: size * 0.4,
        letterSpacing: "-0.5px",
      }}
      aria-hidden
      title="Anonymous collaborator"
    >
      {initials}
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-gray-400 transition-transform"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}
