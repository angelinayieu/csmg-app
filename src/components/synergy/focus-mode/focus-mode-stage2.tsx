// ── Focus Mode Stage 2 — "Here's what we extracted" ──
//
// Loads (or triggers extraction of) the brainstorm_components for the
// session and renders them grouped by kind. Components extracted while
// inside Focus Mode use the same /api/synergy/sessions/[id]/extract
// endpoint which is plan-aware (Phase 3.5 alignment work), so plan
// content drives the bucketing.
//
// The user can:
//   - Toggle each component's visibility (private / matchable / public)
//   - Edit the label inline
//   - Delete a component (excludes it from the doc + marketplace)
//
// Stage 3 ("Sharpen with 3 questions") is offered as a soft optional;
// "Looks good → publish" jumps straight to Stage 4.

"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Globe,
  Lightbulb,
  Loader2,
  Lock,
  Network,
  Package,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { extractComponents, listComponents } from "@/lib/synergy/client";
import type {
  BrainstormComponent,
  ComponentKind,
  ComponentVisibility,
} from "@/lib/synergy/types";

interface Props {
  sessionId: string;
  // Triggers an extract if true (e.g. when entering Stage 2 the first
  // time, the parent decides whether to auto-run).
  autoExtract: boolean;
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
    label: "Upstream — what this needs",
    icon: ArrowUp,
    tone: "border-amber-200 bg-amber-50/40",
  },
  downstream: {
    label: "Downstream — what this produces",
    icon: ArrowDown,
    tone: "border-emerald-200 bg-emerald-50/40",
  },
  polished_product: {
    label: "Polished products",
    icon: Package,
    tone: "border-purple-200 bg-purple-50/40",
  },
};

export function FocusModeStage2({ sessionId, autoExtract }: Props) {
  const [components, setComponents] = useState<BrainstormComponent[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // Initial load + optional auto-extract
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const existing = await listComponents(sessionId);
        if (cancelled) return;
        if (existing.length > 0) {
          setComponents(existing);
        } else if (autoExtract) {
          setComponents(null);
          await runExtract();
        } else {
          setComponents([]);
        }
      } catch (e) {
        toast.error("Couldn't load components", { description: (e as Error).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoExtract]);

  const runExtract = async () => {
    if (extracting) return;
    setExtracting(true);
    try {
      const fresh = await extractComponents(sessionId);
      setComponents(fresh);
      toast.success(`${fresh.length} components extracted`);
    } catch (e) {
      toast.error("Extraction failed", { description: (e as Error).message });
    } finally {
      setExtracting(false);
    }
  };

  if (loading || (components === null && !extracting)) {
    return (
      <div className="px-6 pb-32 pt-2">
        <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
          Here&apos;s what we extracted
        </h1>
        <div className="mt-8 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading components…
        </div>
      </div>
    );
  }

  if (extracting) {
    return <Crystallizing label="Extracting components…" />;
  }

  if (!components || components.length === 0) {
    return (
      <div className="px-6 pb-32 pt-2">
        <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
          Extract your components
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          Distill the kept threads into typed upstream needs, downstream
          outputs, polished products, and core ideas.
        </p>
        <button
          onClick={runExtract}
          disabled={extracting}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:scale-[1.02] disabled:opacity-60"
        >
          {extracting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Run extraction
        </button>
      </div>
    );
  }

  const orderedKinds: ComponentKind[] = [
    "core_idea",
    "upstream",
    "downstream",
    "polished_product",
  ];
  const grouped = new Map<ComponentKind, BrainstormComponent[]>();
  for (const c of components) {
    const list = grouped.get(c.kind) ?? [];
    list.push(c);
    grouped.set(c.kind, list);
  }

  return (
    <div className="px-6 pb-32 pt-2">
      <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
        Here&apos;s what we extracted
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
        {components.length} components ready. Mark any private to hide them
        from the matching marketplace.
      </p>
      <div className="mt-3">
        <button
          onClick={runExtract}
          disabled={extracting}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
        >
          {extracting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Re-extract from current focus
        </button>
      </div>

      <div className="mt-6 space-y-5">
        {orderedKinds.map((kind) => {
          const list = grouped.get(kind);
          if (!list || list.length === 0) return null;
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          return (
            <section key={kind}>
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-700">
                <Icon className="h-3.5 w-3.5 text-blue-600" />
                {meta.label}
                <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">
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
                          <div className="text-[13px] font-semibold text-gray-900">
                            {c.label_public}
                          </div>
                          {c.subkind && (
                            <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
                              {c.subkind}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                          {c.description_public}
                        </p>
                      </div>
                      <VisibilityChip visibility={c.visibility} />
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

function VisibilityChip({ visibility }: { visibility: ComponentVisibility }) {
  const meta = {
    private: {
      icon: Lock,
      label: "private",
      className: "bg-gray-100 text-gray-700",
    },
    matchable_only: {
      icon: Network,
      label: "matchable",
      className: "bg-blue-100 text-blue-700",
    },
    public: {
      icon: Globe,
      label: "public",
      className: "bg-emerald-100 text-emerald-700",
    },
  }[visibility];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function Crystallizing({ label }: { label: string }) {
  return (
    <div className="px-6 pb-32 pt-2">
      <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
        Distilling components
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
        Reading plan synthesis + kept threads. Typing upstream / downstream /
        products.
      </p>
      <div className="mt-6 flex items-center gap-2 text-sm text-gray-700">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        {label}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-3 overflow-hidden rounded bg-gray-100"
            style={{
              animation: `shimmer 1.8s ease-in-out infinite`,
              animationDelay: `${i * 0.15}s`,
              background:
                "linear-gradient(90deg, rgba(243,244,246,0.6) 0%, rgba(219,234,254,0.9) 50%, rgba(243,244,246,0.6) 100%)",
              backgroundSize: "200% 100%",
            }}
          />
        ))}
      </div>
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
