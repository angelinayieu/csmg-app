// ── Strategy doc — upstream / downstream component list ──
//
// Renders the brainstorm_components rows split into "Upstream (needs)"
// and "Downstream (produces)" sections inside the strategy doc. The doc
// doesn't duplicate component data — it references the same rows the
// matching marketplace uses, so visibility edits stay single-sourced.
//
// Visual language unified with the rest of the strategy doc: neutral
// white cards (no amber/emerald wash), section header uses the same
// quieted SectionTitle treatment as Risks/Hypotheses, and the
// directionality is communicated entirely via the custom InflowGlyph /
// OutflowGlyph glyphs.

"use client";

import type { BrainstormComponent } from "@/lib/synergy/types";
import { InflowGlyph, OutflowGlyph } from "./synergy-glyphs";

interface Props {
  kind: "upstream" | "downstream";
  components: BrainstormComponent[];
}

const KIND_META: Record<
  Props["kind"],
  { label: string; sub: string; Glyph: React.ComponentType<{ className?: string }> }
> = {
  upstream: {
    label: "Upstream",
    sub: "what this needs",
    Glyph: InflowGlyph,
  },
  downstream: {
    label: "Downstream",
    sub: "what this produces",
    Glyph: OutflowGlyph,
  },
};

export function SynergyStrategyComponentList({ kind, components }: Props) {
  const meta = KIND_META[kind];
  const Glyph = meta.Glyph;
  const filtered = components.filter((c) => c.kind === kind);

  if (filtered.length === 0) {
    return (
      <section>
        <SectionHeader Glyph={Glyph} label={meta.label} sub={meta.sub} count={0} />
        <p className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-[11px] text-gray-500">
          No {kind} components extracted yet. Run &ldquo;Extract components&rdquo; on
          the processing page first.
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        Glyph={Glyph}
        label={meta.label}
        sub={meta.sub}
        count={filtered.length}
      />
      <ul className="space-y-2">
        {filtered.map((c) => (
          <li
            key={c.id}
            className="group rounded-lg border border-gray-200 bg-white p-3 transition hover:border-gray-300"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-[13px] font-semibold text-gray-900">
                    {c.label_public}
                  </div>
                  {c.subkind && (
                    <span className="rounded-full bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
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
  Glyph,
  label,
  sub,
  count,
}: {
  Glyph: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  count: number;
}) {
  // Quieted treatment to match the SectionTitle used by Risks /
  // Hypotheses in synergy-strategy.tsx: small neutral glyph, 15px
  // medium label, mono caps metadata on right.
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <Glyph className="h-3.5 w-3.5 text-gray-500" />
      <h3 className="font-display-tight text-[15px] font-medium text-gray-900">
        {label}
      </h3>
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
        {sub}
      </span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
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
  // Subtler than the original Lock/Network/Globe icon pills.
  // A 5px colored dot + lowercase label on a neutral bg —
  // visibility reads as metadata, not a primary control.
  const meta = {
    private: { label: "private", dot: "bg-gray-400" },
    matchable_only: { label: "matchable", dot: "bg-blue-500" },
    public: { label: "public", dot: "bg-emerald-500" },
  }[visibility];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
