// Preview harness for ProposalRow (the sub-objective picker card) — verifies
// the white + drop-shadow redesign across every disposition state and the
// expand (More/Less → "Why this fits") affordance, without the authed intake
// flow. Public route. SAFE TO DELETE.

"use client";

import { ProposalRow } from "@/components/objective/sub-objective-picker-card";
import type {
  SubObjectiveProposal,
  SubObjectiveDisposition,
} from "@/lib/objective-canvas/sub-objective-state";

function p(
  over: Partial<SubObjectiveProposal> & { id: string; title: string },
): SubObjectiveProposal {
  return {
    summary:
      "Surfaces the most relevant items for the user's current goal so the feed stops feeling like noise.",
    rationale:
      "Directly attacks the core pain (signal lost in volume) and is cheap to prototype against the existing ranking pipeline, so it earns a high confidence and an early slot.",
    confidence: 0.82,
    recommended: false,
    lens_coverage: [1, 2],
    ...over,
  };
}

const noop = () => {};

const CARDS: Array<{
  label: string;
  proposal: SubObjectiveProposal;
  disposition: SubObjectiveDisposition;
  isElected: boolean;
}> = [
  {
    label: "Default + recommended (Top badge)",
    disposition: null,
    isElected: false,
    proposal: p({
      id: "1",
      title: "Contextual Relevance Filtering",
      recommended: true,
      confidence: 0.88,
      lens_coverage: [1, 2, 3],
    }),
  },
  {
    label: "Elected (emerald glow)",
    disposition: "elected",
    isElected: true,
    proposal: p({
      id: "2",
      title: "Goal-Based Content Prioritization",
      confidence: 0.91,
    }),
  },
  {
    label: "Deferred (amber glow + chip)",
    disposition: "deferred",
    isElected: false,
    proposal: p({
      id: "3",
      title: "Anonymity Options",
      confidence: 0.64,
      summary:
        "Lets users post anonymously, lowering the social pressure that suppresses honest sharing.",
    }),
  },
  {
    label: "Rejected (dimmed)",
    disposition: "rejected",
    isElected: false,
    proposal: p({
      id: "4",
      title: "Content Moderation Algorithms",
      confidence: 0.41,
    }),
  },
  {
    label: "Long summary (clamps to 2 lines until expanded)",
    disposition: null,
    isElected: false,
    proposal: p({
      id: "5",
      title: "Dynamic Context Awareness Module",
      confidence: 0.76,
      summary:
        "Continuously reads the user's recent activity, dwell time, and explicit goal selection to build a lightweight intent model, then re-weights the ranking signals in real time so the same feed reshapes itself as the user's focus shifts across a session — without requiring any manual mode toggle.",
    }),
  },
];

export default function ProposalCardPreview() {
  return (
    <div
      style={{
        maxWidth: 620,
        margin: "0 auto",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#F7F8FA",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 16,
          color: "rgba(15,23,42,0.5)",
        }}
      >
        ProposalRow harness — white cards, accent-glow states, More/Less expand
      </h1>
      <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
        {CARDS.map((c) => (
          <div key={c.proposal.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(15,23,42,0.35)" }}>
              {c.label}
            </span>
            <ProposalRow
              proposal={c.proposal}
              disposition={c.disposition}
              isElected={c.isElected}
              onSetDisposition={noop}
              disabled={false}
              lens={[]}
            />
          </div>
        ))}
      </ul>
    </div>
  );
}
