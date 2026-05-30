"use client";

// ── §1 Overview ───────────────────────────────────────────────────
//
// Definition (the plain-language explainer the LLM generates during
// /expand) + a callout band for cross-room analysis signals when they
// exist. This is what the user reads FIRST when landing on a mechanism
// — should establish what the mechanism is in one screen.

import { SectionHeader } from "./section-header";

interface OverviewEntity {
  id: string;
  name: string;
  causal_chain: Record<string, unknown>;
  expanded_detail: Record<string, unknown>;
}

interface CrossRoomFinding {
  id: string;
  kind: string;
  title: string;
  summary: string;
  disposition?: "open" | "acknowledged" | "dismissed";
}

interface Props {
  entity: OverviewEntity;
}

export function OverviewSection({ entity }: Props) {
  const ed = entity.expanded_detail as {
    definition?: string;
    cross_room_findings?: CrossRoomFinding[];
  };
  const cc = entity.causal_chain as {
    positive_outcome?: string;
    first_principles?: string[];
  };

  const definition = typeof ed.definition === "string" ? ed.definition : "";
  const findings = Array.isArray(ed.cross_room_findings)
    ? ed.cross_room_findings
    : [];
  const openFindings = findings.filter((f) => f.disposition !== "dismissed");

  return (
    <div>
      <SectionHeader
        number="1"
        title="Overview"
        subtitle="What this mechanism is, and why it might work."
      />

      {definition ? (
        <p
          className="text-[15px] font-light leading-relaxed"
          style={{ color: "rgba(15,23,42,0.78)" }}
        >
          {definition}
        </p>
      ) : (
        <EmptyState message="No definition generated yet. Open this mechanism in the room drawer to generate it." />
      )}

      {/* Causal grounding strip: positive outcome + first principles */}
      {(cc.positive_outcome ||
        (Array.isArray(cc.first_principles) && cc.first_principles.length > 0)) && (
        <div
          className="mt-6 rounded-xl border p-4"
          style={{
            borderColor: "rgba(15,23,42,0.08)",
            background: "rgba(15,23,42,0.02)",
          }}
        >
          {cc.positive_outcome && (
            <div className="mb-3">
              <div
                className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "rgba(15,23,42,0.45)" }}
              >
                Positive outcome
              </div>
              <div
                className="text-[13.5px] font-light leading-relaxed"
                style={{ color: "rgba(15,23,42,0.78)" }}
              >
                {cc.positive_outcome}
              </div>
            </div>
          )}
          {Array.isArray(cc.first_principles) && cc.first_principles.length > 0 && (
            <div>
              <div
                className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "rgba(15,23,42,0.45)" }}
              >
                First principles
              </div>
              <ul className="space-y-1">
                {cc.first_principles.slice(0, 6).map((p, i) => (
                  <li
                    key={i}
                    className="text-[13px] font-light leading-relaxed"
                    style={{ color: "rgba(15,23,42,0.72)" }}
                  >
                    · {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Cross-room analysis signals — only renders when there's something */}
      {openFindings.length > 0 && (
        <div
          className="mt-6 rounded-xl border-l-4 p-4"
          style={{
            borderLeftColor: "rgba(217,119,6,0.65)",
            background: "rgba(217,119,6,0.04)",
            borderTop: "1px solid rgba(15,23,42,0.06)",
            borderRight: "1px solid rgba(15,23,42,0.06)",
            borderBottom: "1px solid rgba(15,23,42,0.06)",
          }}
        >
          <div
            className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "rgba(180,83,9,0.85)" }}
          >
            Analysis signals
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px]"
              style={{
                background: "rgba(217,119,6,0.15)",
                color: "rgba(146,64,14,0.92)",
              }}
            >
              {openFindings.length}
            </span>
          </div>
          <ul className="space-y-2">
            {openFindings.slice(0, 5).map((f) => (
              <li key={f.id}>
                <div
                  className="text-[12.5px] font-semibold"
                  style={{ color: "rgba(15,23,42,0.85)" }}
                >
                  {f.title}
                </div>
                <div
                  className="text-[12px] font-light leading-relaxed"
                  style={{ color: "rgba(15,23,42,0.68)" }}
                >
                  {f.summary}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] font-light italic"
      style={{
        borderColor: "rgba(15,23,42,0.12)",
        color: "rgba(15,23,42,0.5)",
      }}
    >
      {message}
    </div>
  );
}
