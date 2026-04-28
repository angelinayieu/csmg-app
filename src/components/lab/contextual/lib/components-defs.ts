// ── Chamber component definitions ────────────────────────────────
//
// The 4 lab-formula primitives — Buffer (β), Decay (δ), Rehearsal (ρ),
// Attention (α). Drives the Composition panel + Reaction Network +
// the 4 subunit balls inside the 3D chamber.

import type { ComponentDef, ReactionDef } from "./types";

export const COMPONENTS: ComponentDef[] = [
  {
    id: "buffer",
    sym: "β",
    sub: "4",
    name: "Buffer",
    color: "#34c759",
    role: "capacity",
    desc: "4-slot limit on actively-focused items. Each slot holds a pointer to a long-term memory trace, not the content itself.",
    mechanism:
      "Theta-gamma neural coupling — ~4 gamma bursts nest within each theta cycle, defining slot count.",
  },
  {
    id: "decay",
    sym: "δ",
    sub: "",
    name: "Decay",
    color: "#ff9500",
    role: "transient",
    desc: "Unrehearsed traces fade exponentially: P(retained) = e^(-t/τ), with τ typically 15–30s for simple material.",
    mechanism:
      "Passive trace degradation plus proactive/retroactive interference from similar items.",
  },
  {
    id: "rehearsal",
    sym: "ρ",
    sub: "",
    name: "Rehearsal",
    color: "#007aff",
    role: "maintenance",
    desc: "Two mechanisms for counteracting decay: subvocal articulatory rehearsal (~3/sec) and attentional refreshing.",
    mechanism:
      "Cyclically re-activates traces to prevent decay, but consumes a slot and attention to do so.",
  },
  {
    id: "attention",
    sym: "α",
    sub: "",
    name: "Attention",
    color: "#ff375f",
    role: "executive",
    desc: "Central executive: directs focus, selects slot contents, filters irrelevant input, shifts between items.",
    mechanism:
      "Priority-driven allocation of limited executive bandwidth across slots and rehearsal.",
  },
];

export const REACTIONS: ReactionDef[] = [
  {
    id: "cap_window",
    inputs: ["buffer", "decay"],
    name: "Effective Capacity Window",
    desc: "Usable slot-seconds per cycle",
    type: "convergent",
    baseProb: 0.91,
  },
  {
    id: "sustained",
    inputs: ["buffer", "rehearsal"],
    name: "Sustained Capacity",
    desc: "Rehearsal costs one slot",
    type: "tradeoff",
    baseProb: 0.82,
  },
  {
    id: "allocation",
    inputs: ["buffer", "attention"],
    name: "Allocation Efficiency",
    desc: "Executive selects slot contents",
    type: "mechanism",
    baseProb: 0.78,
  },
  {
    id: "equilibrium",
    inputs: ["decay", "rehearsal"],
    name: "Maintenance Equilibrium",
    desc: "Refresh > decay required",
    type: "threshold",
    baseProb: 0.85,
  },
  {
    id: "mitigation",
    inputs: ["decay", "attention"],
    name: "Decay Mitigation",
    desc: "Priority items refreshed more",
    type: "modulation",
    baseProb: 0.72,
  },
  {
    id: "competition",
    inputs: ["rehearsal", "attention"],
    name: "Resource Competition",
    desc: "Both consume executive",
    type: "constraint",
    baseProb: 0.76,
  },
  {
    id: "throughput",
    inputs: ["buffer", "decay", "rehearsal"],
    name: "Cognitive Throughput",
    desc: "Combined dynamics",
    type: "convergent",
    baseProb: 0.94,
  },
  {
    id: "full_model",
    inputs: ["buffer", "decay", "rehearsal", "attention"],
    name: "Full Operating Model",
    desc: "Complete characterization",
    type: "synthesis",
    baseProb: 0.88,
  },
];

export function getComponent(id: string): ComponentDef | null {
  return COMPONENTS.find((c) => c.id === id) ?? null;
}
