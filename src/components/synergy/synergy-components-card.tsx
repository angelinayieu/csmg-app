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

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Compass,
  Globe,
  Lightbulb,
  Loader2,
  Lock,
  Network,
  Package,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  BrainstormComponent,
  ComponentKind,
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
  core_idea: {
    label: "Core ideas",
    icon: Lightbulb,
    tone: "border-blue-200 bg-blue-50/40",
  },
  upstream: {
    label: "Upstream (needs)",
    icon: ArrowUp,
    tone: "border-amber-200 bg-amber-50/40",
  },
  downstream: {
    label: "Downstream (produces)",
    icon: ArrowDown,
    tone: "border-emerald-200 bg-emerald-50/40",
  },
  polished_product: {
    label: "Polished products",
    icon: Package,
    tone: "border-purple-200 bg-purple-50/40",
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
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
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
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
          <Package className="h-3 w-3 text-blue-600" />
          Components
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
            {components.length} total
          </span>
        </div>
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

      <p className="mt-2 text-[11px] text-gray-500">
        These are the units Phase 4&apos;s matcher will rank against other
        users&apos; components. Visibility default is{" "}
        <span className="font-mono text-gray-700">matchable_only</span> — only
        shown to candidates whose components complement yours.
      </p>

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
                  <li
                    key={c.id}
                    className={`rounded-lg border ${meta.tone} p-3`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-gray-900">
                            {c.label_public}
                          </div>
                          {c.subkind && (
                            <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
                              {c.subkind}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] leading-snug text-gray-700">
                          {c.description_public}
                        </p>
                        {c.description_private && (
                          <details className="mt-2 text-[11px] text-gray-500">
                            <summary className="cursor-pointer select-none font-mono text-[9px] uppercase tracking-wider text-gray-500 hover:text-gray-900">
                              private context
                            </summary>
                            <p className="mt-1 rounded-md bg-white/60 p-2 leading-snug">
                              {c.description_private}
                            </p>
                          </details>
                        )}
                      </div>
                      <VisibilityPopover component={c} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
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
