"use client";

// ── §6 Chains ─────────────────────────────────────────────────────
//
// Linked chains through this mechanism. Each row: pain → outcome
// label, % strength, approval state. Phase 1 is read-only; clicking
// a chain takes the user back to the room map where they can
// interact with it.

import { SectionHeader } from "./section-header";

interface ChainRef {
  id: string;
  label: string;
  pct: number;
  approved: boolean;
}

interface Props {
  chains: ChainRef[];
}

export function ChainsSection({ chains }: Props) {
  if (chains.length === 0) {
    return (
      <div>
        <SectionHeader
          number="6"
          title="Chains"
          subtitle="Where this mechanism sits in the room's causal graph."
        />
        <div
          className="rounded-lg border border-dashed px-4 py-6 text-center"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: "rgba(15,23,42,0.5)" }}
          >
            This mechanism isn't in any chain yet. Chains form when
            edges connect a pain → this mechanism → an outcome.
          </p>
        </div>
      </div>
    );
  }

  const approved = chains.filter((c) => c.approved).length;
  return (
    <div>
      <SectionHeader
        number="6"
        title="Chains"
        subtitle={`${chains.length} chain${chains.length === 1 ? "" : "s"} · ${approved} approved`}
      />
      <ul className="space-y-2">
        {chains.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-4 rounded-lg border p-3"
            style={{
              borderColor: c.approved
                ? "rgba(34,197,94,0.25)"
                : "rgba(15,23,42,0.08)",
              background: c.approved ? "rgba(34,197,94,0.02)" : "#ffffff",
            }}
          >
            <div className="flex flex-1 items-center gap-3">
              {c.approved && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                  style={{
                    background: "rgba(34,197,94,0.15)",
                    color: "rgba(21,128,61,0.95)",
                  }}
                >
                  Approved
                </span>
              )}
              <span
                className="text-[13px] font-light leading-tight"
                style={{ color: "rgba(15,23,42,0.78)" }}
              >
                {c.label}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div
                className="h-1.5 w-20 overflow-hidden rounded-full"
                style={{ background: "rgba(15,23,42,0.08)" }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${c.pct}%`,
                    background:
                      c.pct >= 70
                        ? "rgba(34,197,94,0.7)"
                        : c.pct >= 40
                          ? "rgba(217,119,6,0.7)"
                          : "rgba(15,23,42,0.3)",
                  }}
                />
              </div>
              <span
                className="w-10 text-right text-[12px] font-semibold tabular-nums"
                style={{
                  color:
                    c.pct >= 70
                      ? "rgba(21,128,61,0.95)"
                      : c.pct >= 40
                        ? "rgba(180,83,9,0.92)"
                        : "rgba(15,23,42,0.55)",
                }}
              >
                {c.pct}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
