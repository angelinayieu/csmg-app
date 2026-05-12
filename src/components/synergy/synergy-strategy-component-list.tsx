// ── Strategy doc — upstream / downstream component list ──
//
// Renders the brainstorm_components rows split into "Upstream (needs)"
// and "Downstream (produces)" sections inside the strategy doc. The doc
// doesn't duplicate component data — it references the same rows the
// matching marketplace uses, so visibility edits stay single-sourced.

"use client";

import { ArrowDown, ArrowUp, Lock, Globe, Network } from "lucide-react";
import type { BrainstormComponent } from "@/lib/synergy/types";

interface Props {
  kind: "upstream" | "downstream";
  components: BrainstormComponent[];
}

const KIND_META: Record<
  Props["kind"],
  { label: string; sub: string; icon: React.ComponentType<{ className?: string }>; accent: string }
> = {
  upstream: {
    label: "Upstream",
    sub: "what this needs",
    icon: ArrowUp,
    accent: "border-amber-200 bg-amber-50/30",
  },
  downstream: {
    label: "Downstream",
    sub: "what this produces",
    icon: ArrowDown,
    accent: "border-emerald-200 bg-emerald-50/30",
  },
};

export function SynergyStrategyComponentList({ kind, components }: Props) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const filtered = components.filter((c) => c.kind === kind);

  if (filtered.length === 0) {
    return (
      <section>
        <SectionHeader Icon={Icon} label={meta.label} sub={meta.sub} count={0} />
        <p className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-[11px] text-gray-500">
          No {kind} components extracted yet. Run "Extract components" on the
          processing page first.
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        Icon={Icon}
        label={meta.label}
        sub={meta.sub}
        count={filtered.length}
      />
      <ul className="space-y-2">
        {filtered.map((c) => (
          <li
            key={c.id}
            className={`group rounded-lg border ${meta.accent} p-3 transition`}
          >
            <div className="flex items-start gap-2">
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
}

function SectionHeader({
  Icon,
  label,
  sub,
  count,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <Icon className="h-4 w-4 self-center text-blue-600" />
      <h3 className="font-semibold text-gray-900">{label}</h3>
      <span className="text-[12px] text-gray-500">— {sub}</span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-gray-500">
        {count} {count === 1 ? "item" : "items"}
      </span>
    </div>
  );
}

function VisibilityChip({
  visibility,
}: {
  visibility: BrainstormComponent["visibility"];
}) {
  const meta = {
    private: { icon: Lock, label: "private", className: "bg-gray-100 text-gray-700" },
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
