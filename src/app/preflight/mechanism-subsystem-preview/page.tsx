// Preview harness for MechanismSubsystemView — the "how the levers interlock"
// view that consumes the composes_with / interferes_with edges the causal-flow
// Map drops. composes_with is SYMMETRIC (shares a principle), so it's an
// undirected link, NOT a dependency arrow. Subsystems group by sub_category.
// Mock data mirrors the real feedback-system room. Public route. SAFE TO DELETE.

"use client";

import {
  MechanismSubsystemView,
  type SubsystemSpec,
  type MechanismSpec,
  type CouplingEdge,
} from "@/components/objective/mechanism-subsystem-view";

const SUBSYSTEMS: SubsystemSpec[] = [
  { id: "trust", label: "Trust & Data", color: "#6366F1" },
  { id: "engage", label: "Engagement Loop", color: "#0D9488" },
];

const MECHANISMS: MechanismSpec[] = [
  { id: "trust_proto", name: "Trust-Based Data Sharing", subtitle: "Users willingly share data", subsystem: "trust" },
  { id: "metrics", name: "Clear Metrics Dashboard", subtitle: "Make the numbers legible", subsystem: "trust" },
  { id: "benefit", name: "Immediate Benefit Interface", subtitle: "Show payoff up front", subsystem: "engage" },
  { id: "goal", name: "Goal-Aligned Feedback System", subtitle: "Tie feedback to goals", subsystem: "engage" },
  { id: "progress", name: "Progress Dashboard", subtitle: "Make momentum visible", subsystem: "engage" },
];

// composes_with — symmetric, order doesn't matter.
const COMPOSES: CouplingEdge[] = [
  { a: "trust_proto", b: "metrics", rationale: "both rest on a verifiable data record" },
  { a: "metrics", b: "goal" },
  { a: "metrics", b: "progress" },
  { a: "benefit", b: "goal" },
];

const CONFLICTS: CouplingEdge[] = [
  { a: "benefit", b: "trust_proto", rationale: "pushing immediate benefit strains the privacy guarantees trust depends on" },
];

export default function MechanismSubsystemPreview() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        MechanismSubsystemView — interlock harness
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.6)", marginBottom: 20 }}>
        The coupling layer the causal-flow Map drops: <strong>composes_with</strong> (symmetric —
        shares a principle) and <strong>interferes_with</strong> (conflict), with mechanisms grouped
        into subsystems by sub_category. Hover a lever to isolate its subsystem.
      </p>

      <MechanismSubsystemView
        subsystems={SUBSYSTEMS}
        mechanisms={MECHANISMS}
        composes={COMPOSES}
        conflicts={CONFLICTS}
      />
    </div>
  );
}
