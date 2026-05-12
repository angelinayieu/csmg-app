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

import {
  ArrowDown,
  ArrowUp,
  Compass,
  Lightbulb,
  Loader2,
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
                      <VisibilityBadge visibility={c.visibility} />
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

function VisibilityBadge({
  visibility,
}: {
  visibility: BrainstormComponent["visibility"];
}) {
  const meta = {
    private: { label: "private", className: "bg-gray-100 text-gray-700" },
    matchable_only: {
      label: "matchable",
      className: "bg-blue-100 text-blue-700",
    },
    public: { label: "public", className: "bg-emerald-100 text-emerald-700" },
  }[visibility];
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
