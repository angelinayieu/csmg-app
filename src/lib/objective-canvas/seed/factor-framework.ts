// ── Factor framework ─────────────────────────────────────────────────
//
// The default factor set the Evaluator judges a course of action against
// (EVALUATOR_PLAN §2). CLIENT-SAFE (pure data) so the Coverage tab can render
// labels without a server import.
//
// The whole point (§9.2): each factor carries a DEPTH BAR — what "strong"
// actually requires — so "addressed" can't be coverage theater. The assessor
// scores against the bar; addressed-but-shallow = `weak`, never `strong`.

export type FactorGroup = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";

export interface FactorDef {
  key: string;
  group: FactorGroup;
  label: string;
  /** What "strong" REQUIRES — the bar the assessor scores against. */
  depthBar: string;
  /** True when this factor is usually illegible to an LLM (WTP, timing, fit) →
   *  on low grounding the assessor emits a `probe` (a question), not a verdict. */
  illegible?: boolean;
}

export const FACTOR_GROUPS: Record<FactorGroup, string> = {
  A: "Desirability — do people want it?",
  B: "Viability — does it make sense to do?",
  C: "Feasibility — can you actually do it?",
  D: "Defensibility — will it last?",
  E: "Distribution — how does it reach people?",
  F: "Timing — why now?",
  G: "Risk — what kills it?",
  H: "Leverage & dynamics — systems view",
  I: "Evidence & grounding — meta",
};

/** The default framework. The Evaluator weights + EXTENDS this per decision;
 *  it never just enumerates. Bars are deliberately concrete. */
export const DEFAULT_FACTORS: FactorDef[] = [
  { key: "pain", group: "A", label: "Pain intensity & real demand", depthBar: "Names a specific painful job + evidence of pull (painkiller, not vitamin) — not 'people would like this'.", illegible: true },
  { key: "icp", group: "A", label: "Who exactly + how many", depthBar: "A specific beachhead ICP + a defensible market-size logic — not 'everyone'." },
  { key: "wtp", group: "B", label: "Willingness to pay / value capture", depthBar: "A concrete model of who pays, how much, and why it's worth it to them — not 'we'll monetize later'.", illegible: true },
  { key: "economics", group: "B", label: "Unit economics", depthBar: "A LTV/CAC or cost-vs-value sketch that could plausibly work — not unexamined." },
  { key: "strategic_fit", group: "B", label: "Strategic fit / opportunity cost", depthBar: "Why THIS move over the alternatives + what it compounds with." },
  { key: "tech", group: "C", label: "Technical feasibility", depthBar: "The hard part is named + a credible path — not 'just build it'." },
  { key: "founder_fit", group: "C", label: "Founder–market fit / unfair edge", depthBar: "A specific edge THIS team has here — not a generic team.", illegible: true },
  { key: "differentiation", group: "D", label: "Differentiation vs real alternatives", depthBar: "Named incumbents + their SPECIFIC failure + how this diverges (feeds: value-engine)." },
  { key: "moat", group: "D", label: "Moat / why-not-copied", depthBar: "A durable lock-in (graph, data, network, switching cost) — not 'we'll be better'." },
  { key: "distribution", group: "E", label: "Distribution / GTM wedge", depthBar: "A specific channel + wedge/atomic-network + an acquisition hypothesis — NOT 'we'll do marketing'. (Usually the real bottleneck.)", illegible: true },
  { key: "timing", group: "F", label: "Why now", depthBar: "A real enabling shift that makes this possible/urgent now — not 'the market is big'.", illegible: true },
  { key: "failure_modes", group: "G", label: "Failure modes / what-must-be-true", depthBar: "The 2–3 assumptions that, if false, kill it — named." },
  { key: "reversibility", group: "G", label: "Reversibility (one-way vs two-way door)", depthBar: "Whether the key bets are cheap to reverse — drives the go/refine call." },
  { key: "second_order", group: "G", label: "Second-order / unintended effects", depthBar: "A downstream consequence you wouldn't predict from the first move." },
  { key: "leverage", group: "H", label: "Highest-leverage point", depthBar: "Where to act for max effect + why (feeds: crucible leverage)." },
  { key: "dynamics", group: "H", label: "Variable interactions / loops", depthBar: "The feedback loop or interaction that compounds or kills (feeds: simulation)." },
  { key: "grounding", group: "I", label: "Evidence vs assumption", depthBar: "Which claims are evidence-backed vs assumed + the key unknown to validate next." },
];

/** Decision archetypes — the Evaluator pattern-matches the move to one, which
 *  sets which factor GROUPS dominate. This is the part to TRUST (§9.3): an LLM
 *  is good at archetype recognition. Used as a hint in the weighting prompt. */
export const DECISION_ARCHETYPES: { key: string; cue: string; decisive: FactorGroup[] }[] = [
  { key: "consumer_app", cue: "consumer / social / network-effect product", decisive: ["A", "E", "F", "D"] },
  { key: "b2b_saas", cue: "B2B / workflow / sells to teams", decisive: ["A", "B", "E", "C"] },
  { key: "deep_tech", cue: "hard technical / research / novel capability", decisive: ["C", "F", "D", "B"] },
  { key: "marketplace", cue: "two-sided / supply+demand", decisive: ["E", "A", "H", "D"] },
  { key: "internal_tool", cue: "internal / process / ops improvement", decisive: ["C", "H", "B", "G"] },
  { key: "feature", cue: "a feature within an existing product", decisive: ["A", "H", "C", "G"] },
];

export function renderFrameworkForPrompt(): string {
  const byGroup = new Map<FactorGroup, FactorDef[]>();
  for (const f of DEFAULT_FACTORS) (byGroup.get(f.group) ?? byGroup.set(f.group, []).get(f.group)!).push(f);
  const lines: string[] = [];
  for (const g of Object.keys(FACTOR_GROUPS) as FactorGroup[]) {
    lines.push(`${g} · ${FACTOR_GROUPS[g]}`);
    for (const f of byGroup.get(g) ?? []) {
      lines.push(`   - [${f.key}] ${f.label}${f.illegible ? " (illegible — probe if low grounding)" : ""} — STRONG requires: ${f.depthBar}`);
    }
  }
  return lines.join("\n");
}
