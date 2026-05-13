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
  Lightbulb,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { extractComponents, listComponents } from "@/lib/synergy/client";
import type {
  BrainstormComponent,
  ComponentKind,
} from "@/lib/synergy/types";
// Use the polished ExpandableComponentRow from the same surface
// the processing page renders. Unifies the visual language across
// surfaces — match-availability badge, regenerate button, anonymous
// avatar peek, and "Open room" CTA all behave identically here.
import { ExpandableComponentRow } from "@/components/synergy/synergy-components-card";

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
  // Apple-style restraint: uniform white card across all four kinds.
  // Kind distinction lives in the section header icon + label only,
  // not in the card chrome. Mirrors the unified treatment in
  // synergy-components-card.tsx so the Focus Mode pane and the
  // processing-page render look identical row-by-row.
  core_idea: {
    label: "Core ideas",
    icon: Lightbulb,
    tone: "border-gray-200 bg-white",
  },
  upstream: {
    label: "Upstream — what this needs",
    icon: ArrowUp,
    tone: "border-gray-200 bg-white",
  },
  downstream: {
    label: "Downstream — what this produces",
    icon: ArrowDown,
    tone: "border-gray-200 bg-white",
  },
  polished_product: {
    label: "Polished products",
    icon: Package,
    tone: "border-gray-200 bg-white",
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
        <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
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
        <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
          Extract your components
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          Type the kept threads into upstream needs, downstream outputs,
          products, and core ideas.
        </p>
        <button
          onClick={runExtract}
          disabled={extracting}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:scale-[1.02] disabled:opacity-60"
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
      <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
        Here&apos;s what we extracted
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
        {components.length} components ready. Expand any card to regenerate,
        set visibility, or open its room.
      </p>
      <div className="mt-4">
        <button
          onClick={runExtract}
          disabled={extracting}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-60"
        >
          {extracting ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
          )}
          Re-extract
        </button>
      </div>

      <div className="mt-7 space-y-7">
        {orderedKinds.map((kind) => {
          const list = grouped.get(kind);
          if (!list || list.length === 0) return null;
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          return (
            <section key={kind}>
              <div className="mb-3 flex items-baseline gap-2.5">
                <Icon className="h-3.5 w-3.5 self-center text-gray-600" />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-700">
                  {meta.label}
                </span>
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
                  {list.length}
                </span>
              </div>
              <ul className="space-y-2">
                {list.map((c) => (
                  <ExpandableComponentRow
                    key={c.id}
                    component={c}
                    toneClass={meta.tone}
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

function Crystallizing({ label }: { label: string }) {
  return (
    <div className="px-6 pb-32 pt-2">
      <h1 className="font-display-tight text-[28px] font-semibold leading-[1.1] text-gray-900">
        Distilling components
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
        Reading the plan. Typing each component.
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
