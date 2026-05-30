"use client";

// ── §5 Planning ───────────────────────────────────────────────────
//
// Three columns: Assumes / Depends on / Risks. Each is a simple list
// from expanded_detail.planning. Empty rails get a faint hint.

import { SectionHeader } from "./section-header";

interface PlanningEntity {
  id: string;
  expanded_detail: Record<string, unknown>;
}

interface Props {
  entity: PlanningEntity;
}

export function PlanningSection({ entity }: Props) {
  const ed = entity.expanded_detail as {
    planning?: {
      assumes?: string[];
      depends_on?: string[];
      risks?: string[];
    };
  };
  const planning = ed.planning ?? {};
  const assumes = Array.isArray(planning.assumes) ? planning.assumes : [];
  const depends = Array.isArray(planning.depends_on) ? planning.depends_on : [];
  const risks = Array.isArray(planning.risks) ? planning.risks : [];

  const totalItems = assumes.length + depends.length + risks.length;
  if (totalItems === 0) {
    return (
      <div>
        <SectionHeader
          number="5"
          title="Planning"
          subtitle="What this mechanism assumes, depends on, and might fail at."
        />
        <div
          className="rounded-lg border border-dashed px-4 py-6 text-center"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: "rgba(15,23,42,0.5)" }}
          >
            No planning notes yet. These are generated alongside the
            definition during item expansion.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        number="5"
        title="Planning"
        subtitle={`${assumes.length} assumes · ${depends.length} depends · ${risks.length} risks`}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Pillar
          label="Assumes"
          accentColor="rgba(59,130,246,0.65)"
          items={assumes}
          emptyText="No assumptions listed."
        />
        <Pillar
          label="Depends on"
          accentColor="rgba(168,85,247,0.65)"
          items={depends}
          emptyText="No dependencies listed."
        />
        <Pillar
          label="Risks"
          accentColor="rgba(220,38,38,0.65)"
          items={risks}
          emptyText="No risks listed."
        />
      </div>
    </div>
  );
}

function Pillar({
  label,
  accentColor,
  items,
  emptyText,
}: {
  label: string;
  accentColor: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <div
      className="rounded-xl border-l-4 bg-white p-4"
      style={{
        borderLeftColor: accentColor,
        borderTop: "1px solid rgba(15,23,42,0.06)",
        borderRight: "1px solid rgba(15,23,42,0.06)",
        borderBottom: "1px solid rgba(15,23,42,0.06)",
      }}
    >
      <div
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "rgba(15,23,42,0.55)" }}
      >
        {label}
        <span className="ml-1.5" style={{ color: "rgba(15,23,42,0.35)" }}>
          · {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p
          className="text-[12px] font-light italic"
          style={{ color: "rgba(15,23,42,0.4)" }}
        >
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((s, i) => (
            <li
              key={i}
              className="text-[12.5px] font-light leading-relaxed"
              style={{ color: "rgba(15,23,42,0.72)" }}
            >
              · {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
