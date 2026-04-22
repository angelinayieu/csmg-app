// ── Hand-written axis exemplar seeds ──
//
// `axis-prompts.ts` has a slot for few-shot exemplars per axis but
// nothing populates it. Empty → the LLM gets no reference for what
// "good" output looks like per axis, and we see generic, shallow
// decompositions (the "0 entities" kind).
//
// This file is the seed layer. Hand-written 1-2 exemplars per axis,
// showing the depth + specificity + mechanism-naming bar we want.
// The retriever (axis-exemplar-retrieval.ts) prefers DB-sourced
// exemplars when available (surfaces from historical high-quality
// runs), but falls back to these seeds — which is the common case
// until we've accumulated enough real data.
//
// Each exemplar is deliberately short (≤600 chars of output excerpt)
// so injecting 2 doesn't blow the Pass 1 context budget. The goal is
// to SHOW the shape and specificity, not to train the model in-prompt.

import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { AxisExemplar } from "./axis-prompts";

const SEEDS: Record<ProbabilitySpaceAxis, AxisExemplar[]> = {
  financial: [
    {
      inputGist: "B2B SaaS considering a pricing change from usage-based to seat-based",
      outputExcerpt:
        `Core entities:
• F1 "Gross-margin compression risk" (critical): Switching to seats exposes us to multi-seat discounts we can't offset with usage-based upside — specifically, the top-10 accounts consume 4x the compute but would plateau at team-plan pricing.
• F2 "Net revenue retention cliff" (fundamental): Current NRR is 118%, driven by usage expansion. Seat pricing caps expansion at net new hires (~20%/yr), collapsing the compounding effect that funds our CAC.
• F3 "CAC payback shift" (critical): Seats simplify the sales conversation — estimated 2-month shorter payback — but removes the "usage-heavy new logo" profile that today delivers our fastest-paying cohort.
Mechanism-naming edges: F2 → F1 (via "expansion revenue redirects to margin absorption when new seats have lower incremental value than incremental usage did").`,
    },
  ],
  timeline: [
    {
      inputGist: "Team considering a 3-month rebuild of legacy infrastructure",
      outputExcerpt:
        `Core entities:
• T1 "Migration freeze window" (critical): The rebuild requires a 6-week feature-development freeze. Competitor cycles in our segment average 4 weeks — we'd ship 1.5 cycles behind during the freeze.
• T2 "Cold-start knowledge decay" (important): After 3 months away from feature work, senior engineers lose 15-20% of context velocity when returning — compounds with any attrition during the freeze.
• T3 "Irreversible commitment at week 6" (fundamental): Rollback cost doubles after the data-model migration step (week 6). Before then, we can abandon; after, we're committed even if ROI no longer pencils out.
Edges: T3 → T1 (fork point — the decision to continue past week 6 locks in the freeze window's full cost).`,
    },
  ],
  actors: [
    {
      inputGist: "Product team planning to deprecate a feature used by 8% of DAUs",
      outputExcerpt:
        `Core entities:
• A1 "Power-user subset in the 8%" (critical): The 8% isn't a random sample — 60% of them are 2+ year customers who contributed ~20% of our early growth stories. Their revealed-preference signal: they chose us partly FOR this feature.
• A2 "Support-team churn indicator" (important): CS reps say these users file 3x the tickets per user. Deprecation shifts those tickets from "feature X is broken" to "I'm leaving," which is a different response playbook.
• A3 "Board-level narrative risk" (moderate): Deprecating a differentiator is a story competitors will weaponize. The 8% becomes a public defection signal disproportionate to the number.
Edges: A1 → A3 (via "loud churners amplify the deprecation story in public community channels").`,
    },
  ],
  causal_scenarios: [
    {
      inputGist: "Company weighing a fundraise now vs. waiting 6 months for better metrics",
      outputExcerpt:
        `Scenarios with mechanisms:
• CS1 "Raise now, metrics disappoint in DD" (reinforcing-negative): Current metrics are OK but the growth trajectory over Q3 flattened. If DD surfaces the flattening, we get marked down 30-40% — the same number we'd get in 6 months. Fork point: whether Q4 pipeline confirms reacceleration (visible by mid-October).
• CS2 "Wait 6 months, macro worsens" (balancing-inverted): Waiting trades execution risk for market risk. If rates cut Q4-Q1, our waiting bet pays off; if they hold, multiples compress further.
• CS3 "Raise partial bridge" (hedge): A $3M bridge from existing investors extends runway to Q2 without resetting valuation — preserves optionality on the full round. Fork point: whether existing investors commit without new-lead pricing, which depends on Q4 board read.
Edges: CS1 and CS3 share the "Q4 pipeline confirmation" fork point — this is the single highest-value observation to resolve.`,
    },
  ],
  evidence: [
    {
      inputGist: "Startup claiming their AI model outperforms GPT-4 on legal document review",
      outputExcerpt:
        `Claims inventory:
• E1 "Outperforms GPT-4" (assumption, load-bearing): Claim rests on internal benchmark of 500 contracts vs GPT-4 at default settings. Not head-to-head with fine-tuned GPT-4 or RAG-augmented setups. Falsification: run the claim's benchmark against a fine-tuned GPT-4 baseline — 1-week test.
• E2 "Legal reviewers prefer our output" (anecdotal → assertion): Based on 12 user interviews with 4 firms. Selection bias risk: interviewees were warm intros. Falsifiable via blind study with 20+ reviewers from non-intro firms.
• E3 "Clients see 40% time reduction" (assumption, unsupported): Number cited in deck but derived from 2 customer interviews. Reference class: published legal-AI studies show 15-25% reduction. Our claim is 60-160% above the reference class — demands either better evidence or honest downward revision.
Flagged: E3 is the most quoted number externally and has the weakest grounding — this is a credibility blast radius if a skeptical reviewer digs in.`,
    },
  ],
  assumptions: [
    {
      inputGist: "Consumer app betting on TikTok virality for user acquisition",
      outputExcerpt:
        `Hidden axioms this plan rests on:
• AS1 "TikTok continues to reward our content category" (load-bearing): The algorithm's category weights are opaque and have shifted 3 times in 18 months for adjacent verticals. If-false: CAC rises 4-8x, plan breaks. Cheap test: weekly category-reach audit starting now to detect trend before it collapses.
• AS2 "Virality is a repeatable acquisition channel" (contested): Aggregate data from consumer startups suggests TikTok-driven spikes rarely compound — most products drop to <20% of peak within 8 weeks. If-false: we need a second channel ready by month 3.
• AS3 "Our creative cycle can keep up with the algorithm's churn" (load-bearing, rarely named): Creating TikTok-native content at the cadence we'd need requires either in-house creators or contractor retainer. We've assumed we can do it with our marketing manager — plan has zero budget line for creative operations. If-false: we ship fewer pieces, algorithm stops surfacing us, CAC spikes.
Ranking by if-false damage: AS3 > AS1 > AS2.`,
    },
  ],
  risk: [
    {
      inputGist: "Team launching a payments feature in a regulated market",
      outputExcerpt:
        `Failure modes, categorized:
• R1 "Regulatory ambiguity → freeze order" (regulatory, high severity, semi-reversible): State AG could argue our MSB-exempt claim is wrong for our transaction shape. Early signal: any inquiry from state regulators — has cost weeks of legal time industry-wide. Mitigation: pre-emptive consultation letter ($8k, 3 weeks).
• R2 "Chargeback fraud ring targets new platforms" (adversarial, medium severity, cascading): New payment platforms see 3-5x the industry-average fraud rate in first 6 months because ring ops probe for weak 3DS setups. Signal: clustered chargebacks from same BIN within 48 hours. Mitigation: baseline 3DS v2 from day 1, even if it costs conversion.
• R3 "Integration partner SLA gap" (execution, low severity, slow to surface): Our payments vendor has 99.5% SLA, which at our volume means ~3 hours/month of outages. Doesn't impact us today; becomes critical at 10x volume — silent tail risk.
Correlation warning: R1 and R3 can compound. If we hit a freeze order, we're relying more heavily on a vendor whose SLA becomes inadequate at our scale.`,
    },
  ],
  cultural: [
    {
      inputGist: "Enterprise software team trying to introduce async-first working norms",
      outputExcerpt:
        `Cultural mechanisms at play:
• C1 "Meeting-attendance as status signal" (norm, load-bearing): In this company, being in the executive review meeting is a legibility proxy — not being there means you don't matter. Async trip-reports don't substitute because they're not witnessed live. Breaking this norm requires a senior cover move (e.g., VP visibly opts-out).
• C2 "Written criticism as taboo" (norm): The org's Slack culture treats written criticism as "calling someone out." Async decision-making depends on written disagreement being normal. Conflict: async-first requires a cultural shift we haven't funded.
• C3 "Narrative of 'move fast' as identity" (frame): The company's origin story is built on 'we move fast, we're in the room together.' Async-first can feel like a betrayal of that identity even when it's operationally correct. Legitimizer: reframe as 'we move fast enough that we can't be in the same room.'
Edges: C1 + C2 compound — the same people who would flag async as "slow" also treat written disagreement as confrontational, so the feedback loop against async is structurally reinforced.`,
    },
  ],
};

/** Expose the seed set. `axis-exemplar-retrieval.ts` wraps this with
 *  DB-sourced exemplars when available. */
export function getAxisExemplarSeeds(
  axis: ProbabilitySpaceAxis,
): AxisExemplar[] {
  return SEEDS[axis] ?? [];
}
