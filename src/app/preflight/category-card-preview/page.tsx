// Temporary visual preview for the redesigned CategoryCard. Mocks the
// chain triplet so the upper portion of the card renders without
// touching the lineup API (the lineup will sit in its loading state,
// which is part of what we want to verify too).
//
// SAFE TO DELETE — only exists to take a screenshot of the redesign.

"use client";

import {
  CategoryCard,
  MechanismLineup,
  type LineupVariation,
} from "@/components/objective/category-card";
import { ChainCard } from "@/components/objective/cards/chain-card";
import { PortfolioStrip } from "@/components/objective/cards/portfolio-strip";
import { SubObjectiveRoomHeader } from "@/components/objective/sub-objective-room-header";
import { AnnotatedSubObjectiveCard } from "@/components/objective/annotated-sub-objective-card";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";
import type { PainCardItem } from "@/components/objective/cards/pain-card";
import type { FeatureCardItem } from "@/components/objective/cards/feature-card";
import type { OutcomeCardItem } from "@/components/objective/cards/outcome-card";
import type { ObjectiveAnnotation } from "@/components/objective/annotated-objective-card";

const PAIN_ID = "pain-1";
const FEATURE_ID = "feature-1";
const OUTCOME_ID = "outcome-1";

const chain: ChainTriple = {
  id: "chain-1",
  painId: PAIN_ID,
  painName: "Excessive Passive Browsing",
  featureId: FEATURE_ID,
  featureName: "Intentional Browsing Prompter",
  outcomeId: OUTCOME_ID,
  outcomeName: "Reduced Passive Browsing Time",
  painFeatureEdge: {
    id: "e1",
    source_entity_id: PAIN_ID,
    target_entity_id: FEATURE_ID,
    strength: 0.85,
  } as unknown as ChainTriple["painFeatureEdge"],
  featureOutcomeEdge: {
    id: "e2",
    source_entity_id: FEATURE_ID,
    target_entity_id: OUTCOME_ID,
    strength: 0.8,
  } as unknown as ChainTriple["featureOutcomeEdge"],
  composite: 0.8,
  mechanism: "intentional web searching",
  categoryTriple: {
    painSlug: "distraction-overload",
    featureSlug: "attention-tracking",
    resultSlug: "efficiency-gain",
  },
};

const pain: PainCardItem = {
  id: PAIN_ID,
  name: "Excessive Passive Browsing",
  negative_outcome: "Reduced productivity and missed opportunities for financial gain",
  root_causes: [
    "Lack of goal-oriented searching",
    "Undefined user objectives",
    "Engagement with irrelevant content",
  ],
  influence_rank: 4,
};

const feature: FeatureCardItem = {
  id: FEATURE_ID,
  name: "Intentional Browsing Prompter",
  positive_outcome: "Average browsing time decreases by 30%",
  first_principles: [
    "Intentional web searching",
    "Proxy indicators / chains of cause and effect",
    "Tension with passive",
  ],
};

const outcome: OutcomeCardItem = {
  id: OUTCOME_ID,
  name: "Reduced Passive Browsing Time",
  measured_by: "Average browsing time decreases by 30%",
  indicators: ["Average browsing time decreases by 30%"],
};

// ── Sub-objective header demo annotations ──
const subTitle = "Goal-Driven Knowledge Pathways";
const subDescription =
  "A feature that maps out personalized learning pathways based on the user's goals, enhancing the alignment of digital activities with career advancement.";
const subFullText = `${subTitle} ${subDescription}`;
function offsetOf(needle: string): { start: number; end: number } {
  const start = subFullText.indexOf(needle);
  return { start, end: start + needle.length };
}
function mkAnnotation(
  phrase: string,
  reading: string,
  layer_tag: ObjectiveAnnotation["layer_tag"],
  weight: number,
): ObjectiveAnnotation {
  const { start, end } = offsetOf(phrase);
  return {
    phrase,
    start_offset: start,
    end_offset: end,
    scope: "phrase",
    reading,
    weight,
    dimensions: [],
    inference_chain: [],
    not_reading: null,
    crystal: null,
    confidence: null,
    analogies: [],
    mechanism: null,
    frame: null,
    stakes: null,
    fragility: null,
    tensions: [],
    linked_sub_objective_id: null,
    layer_tag,
  };
}
// Title-range annotations (offsets fall within subTitle) — these
// render as inline underlines on the h1 itself.
const titleAnnotations: ObjectiveAnnotation[] = [
  mkAnnotation(
    "Goal-Driven",
    "The pathway is anchored to an explicit goal, not open-ended exploration",
    "objective",
    0.9,
  ),
  mkAnnotation(
    "Knowledge Pathways",
    "Knowledge is sequenced as a route, not a pile",
    "features",
    0.8,
  ),
];
// Description-range annotations (offsets relative to subDescription).
function descOffsetOf(needle: string): { start: number; end: number } {
  const start = subDescription.indexOf(needle);
  return { start, end: start + needle.length };
}
function mkDescAnnotation(
  phrase: string,
  reading: string,
  layer_tag: ObjectiveAnnotation["layer_tag"],
  weight: number,
): ObjectiveAnnotation {
  const { start, end } = descOffsetOf(phrase);
  return {
    phrase,
    start_offset: start,
    end_offset: end,
    scope: "phrase",
    reading,
    weight,
    dimensions: [],
    inference_chain: [],
    not_reading: null,
    crystal: null,
    confidence: null,
    analogies: [],
    mechanism: null,
    frame: null,
    stakes: null,
    fragility: null,
    tensions: [],
    linked_sub_objective_id: null,
    layer_tag,
  };
}
const descriptionAnnotations: ObjectiveAnnotation[] = [
  mkDescAnnotation(
    "maps out",
    "Models the user's intended trajectory as an explicit graph",
    "features",
    0.85,
  ),
  mkDescAnnotation(
    "personalized learning pathways",
    "Pathways branch from the user's current state, not a generic curriculum",
    "features",
    0.95,
  ),
  mkDescAnnotation(
    "enhancing the alignment of digital activities",
    "Closes the gap between what the user does online and what they're working toward",
    "outcomes",
    0.8,
  ),
  mkDescAnnotation(
    "with career advancement",
    "Career advancement is the load-bearing north star",
    "outcomes",
    0.9,
  ),
];

// ── Portfolio strip demo data ──
// Mirrors the screenshot: 3 archetype bets, a "Relevance Assessment"
// problem dimension that has items but no chain touches it (the gap),
// and an unused "Community Engagement" mechanism + "Network Expansion"
// result (count 0 — shown faint in the coverage matrix).
const PALETTE_PAIN = "#DC2626";
const PALETTE_MECH = "#2563EB";
const PALETTE_RESULT = "#16A34A";

const portfolioCategories = {
  friction: [
    { slug: "goal-alignment", label: "Goal Alignment", color: PALETTE_PAIN },
    { slug: "information-overload", label: "Information Overload", color: PALETTE_PAIN },
    { slug: "relevance-assessment", label: "Relevance Assessment", color: PALETTE_PAIN },
    { slug: "motivation-barriers", label: "Motivation Barriers", color: PALETTE_PAIN },
    { slug: "privacy-concerns", label: "Privacy Concerns", color: PALETTE_PAIN },
  ],
  mechanism: [
    { slug: "personalized-recs", label: "Personalized Recommendations", color: PALETTE_MECH },
    { slug: "goal-tracking", label: "Goal Tracking Tools", color: PALETTE_MECH },
    { slug: "community-engagement", label: "Community Engagement", color: PALETTE_MECH },
    { slug: "data-privacy", label: "Data Privacy Controls", color: PALETTE_MECH },
    { slug: "feedback-loops", label: "Feedback Loops", color: PALETTE_MECH },
  ],
  result: [
    { slug: "career-advancement", label: "Career Advancement", color: PALETTE_RESULT },
    { slug: "skill-acquisition", label: "Skill Acquisition", color: PALETTE_RESULT },
    { slug: "network-expansion", label: "Network Expansion", color: PALETTE_RESULT },
    { slug: "increased-engagement", label: "Increased Engagement", color: PALETTE_RESULT },
    { slug: "data-driven-insights", label: "Data-Driven Insights", color: PALETTE_RESULT },
  ],
};

const portfolioPainItems = [
  { id: "p1", subCategorySlug: "goal-alignment" },
  { id: "p2", subCategorySlug: "information-overload" },
  { id: "p3", subCategorySlug: "relevance-assessment" },
  { id: "p4", subCategorySlug: "motivation-barriers" },
  { id: "p5", subCategorySlug: "privacy-concerns" },
];
const portfolioFeatureItems = [
  { id: "f1", subCategorySlug: "personalized-recs" },
  { id: "f2", subCategorySlug: "goal-tracking" },
  { id: "f3", subCategorySlug: "data-privacy" },
  { id: "f4", subCategorySlug: "feedback-loops" },
];
const portfolioOutcomeItems = [
  { id: "o1", subCategorySlug: "career-advancement" },
  { id: "o2", subCategorySlug: "career-advancement" },
  { id: "o3", subCategorySlug: "skill-acquisition" },
  { id: "o4", subCategorySlug: "increased-engagement" },
  { id: "o5", subCategorySlug: "data-driven-insights" },
];

function mkChain(
  id: string,
  painSlug: string,
  featureSlug: string,
  resultSlug: string,
): ChainTriple {
  return {
    id,
    painId: `${id}-p`,
    painName: painSlug,
    featureId: `${id}-f`,
    featureName: featureSlug,
    outcomeId: `${id}-o`,
    outcomeName: resultSlug,
    painFeatureEdge: {
      id: `${id}-pf`,
      source_entity_id: `${id}-p`,
      target_entity_id: `${id}-f`,
    } as unknown as ChainTriple["painFeatureEdge"],
    featureOutcomeEdge: {
      id: `${id}-fo`,
      source_entity_id: `${id}-f`,
      target_entity_id: `${id}-o`,
    } as unknown as ChainTriple["featureOutcomeEdge"],
    composite: 0.8,
    mechanism: null,
    categoryTriple: { painSlug, featureSlug, resultSlug },
  };
}

const portfolioChains: ChainTriple[] = [
  mkChain("c1", "information-overload", "personalized-recs", "skill-acquisition"),
  mkChain("c2", "goal-alignment", "goal-tracking", "career-advancement"),
  mkChain("c3", "motivation-barriers", "feedback-loops", "increased-engagement"),
  mkChain("c4", "privacy-concerns", "data-privacy", "data-driven-insights"),
];

// ── Mechanism lineup demo data — mirrors the screenshot ──
const lineupVariations: LineupVariation[] = [
  {
    id: "v1",
    name: "Contextual Relevance Filtering",
    description:
      "Filters content based on its relevance to the user's current context and goals, using past behavior and preferences to prioritize information.",
    effectiveness_score: 0.7,
    evaluation_method: "rubric",
    disposition: "elected",
    tradeoff:
      "Requires comprehensive user data collection, which may raise privacy concerns.",
    open_questions: [
      "How accurate is the context detection for diverse user goals?",
      "Does this filter adapt to changing user contexts effectively?",
      "What privacy measures are needed to ensure user trust?",
    ],
    indicator_scores: [
      {
        indicator_text: "User-reported goal clarity 4/5",
        outcome_id: "out-1",
        outcome_name: "Efficient Goal-Driven Learning Paths",
        score: 0.7,
        reason: "Strong rubric grade",
        confidence: 0.8,
      },
      {
        indicator_text: "80%+ completion of recommended paths",
        outcome_id: "out-1",
        outcome_name: "Efficient Goal-Driven Learning Paths",
        score: 0.6,
        reason: "Moderate",
        confidence: 0.7,
      },
      {
        indicator_text: "Reduction in time spent on irrelevant content",
        outcome_id: "out-1",
        outcome_name: "Efficient Goal-Driven Learning Paths",
        score: 0.8,
        reason: "Strong",
        confidence: 0.75,
      },
      {
        indicator_text: "User consent for data sharing",
        outcome_id: "out-2",
        outcome_name: "Increased Data Sharing for Personalized Insights",
        score: 0.4,
        reason: "Weak — privacy friction",
        confidence: 0.5,
      },
      {
        indicator_text: "Self-reported value from personalization",
        outcome_id: "out-2",
        outcome_name: "Increased Data Sharing for Personalized Insights",
        score: 0.6,
        reason: "Moderate",
        confidence: 0.6,
      },
      {
        indicator_text: "Increase in personalized content engagement",
        outcome_id: "out-2",
        outcome_name: "Increased Data Sharing for Personalized Insights",
        score: 0.7,
        reason: "Strong",
        confidence: 0.7,
      },
    ],
  },
  {
    id: "v2",
    name: "Goal-Based Content Prioritization",
    description:
      "Prioritizes content that aligns with explicitly stated user goals, ensuring that the most relevant information is highlighted.",
    effectiveness_score: 0.7,
    evaluation_method: "rubric",
    disposition: "elected",
  },
  {
    id: "v3",
    name: "Dynamic Context Awareness Module",
    description:
      "Utilizes real-time contextual data to adjust content delivery, ensuring content remains relevant as user contexts shift.",
    effectiveness_score: 0.7,
    evaluation_method: "rubric",
    disposition: "elected",
  },
  {
    id: "v4",
    name: "User Feedback-Driven Filtering",
    description:
      "Incorporates user feedback to continuously refine content filtering criteria, enhancing alignment with user expectations.",
    effectiveness_score: 0.66,
    evaluation_method: "rubric",
    disposition: null,
  },
];

export default function Page() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        backgroundPosition: "0 0",
        padding: "48px 24px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ margin: "0 -24px 64px", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(15,23,42,0.06)" }}>
        <div
          style={{
            padding: "16px 32px 0",
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(15,23,42,0.45)",
            fontWeight: 500,
          }}
        >
          Sub-objective room header · Redesign preview
        </div>
        <div style={{ marginTop: 8 }}>
          <SubObjectiveRoomHeader
            spaceId="demo"
            title={subTitle}
            titleAnnotations={titleAnnotations}
            topNegativeOutcome="Users fail to align digital activities with career advancement goals, missing long-term opportunities."
          />
          <div
            className="mx-auto w-full max-w-[1400px] px-8"
          >
            <div style={{ marginTop: 20, maxWidth: 640, paddingBottom: 32 }}>
              <AnnotatedSubObjectiveCard
                objectiveText={subDescription}
                annotations={descriptionAnnotations}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div
          style={{
            marginBottom: 24,
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(15,23,42,0.45)",
            fontWeight: 500,
          }}
        >
          Category Card · Redesign preview
        </div>
        <CategoryCard
          chain={chain}
          pain={pain}
          feature={feature}
          outcome={outcome}
          categoryLabel="Distraction Overload × Attention Tracking × Efficiency Gain"
          approved={false}
          onApprove={() => {}}
          onOpenFeatureDetail={() => {}}
          onOpenPainDetail={() => {}}
          onOpenOutcomeDetail={() => {}}
        />
        <div style={{ height: 32 }} />
        <CategoryCard
          chain={{ ...chain, id: "chain-2" }}
          pain={pain}
          feature={feature}
          outcome={outcome}
          categoryLabel="Distraction Overload × Attention Tracking × Efficiency Gain"
          approved
          onApprove={() => {}}
          onOpenFeatureDetail={() => {}}
          onOpenPainDetail={() => {}}
          onOpenOutcomeDetail={() => {}}
        />

        <div style={{ height: 64 }} />
        <div
          style={{
            marginBottom: 24,
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(15,23,42,0.45)",
            fontWeight: 500,
          }}
        >
          Chain Card · Redesign preview
        </div>
        <div
          style={{
            background: "#ffffff",
            border: "1px solid rgba(15,23,42,0.06)",
            borderRadius: 24,
            padding: 20,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 32px -16px rgba(11,18,40,0.18)",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(15,23,42,0.45)",
            }}
          >
            Correlations
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 14,
              fontWeight: 600,
              color: "rgba(15,23,42,0.92)",
              letterSpacing: "-0.01em",
            }}
          >
            2 of 2 chains
          </div>
          <p
            style={{
              marginTop: 4,
              fontSize: 11.5,
              fontWeight: 300,
              lineHeight: 1.45,
              color: "rgba(15,23,42,0.62)",
            }}
          >
            Each chain is a complete problem → mechanism → result bet. Approve
            the ones you want promoted to the main canvas.
          </p>
          <ul
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              listStyle: "none",
              padding: 0,
            }}
          >
            <ChainCard
              chain={chain}
              laneLabels={{
                pain: "Problem",
                features: "Mechanism",
                outcomes: "Result",
              }}
              archetype={{
                pain: { label: "Distraction Overload", color: "#DC2626" },
                feature: { label: "Attention Tracking", color: "#475569" },
                result: { label: "Efficiency Gain", color: "#16A34A" },
              }}
              painRootCauses={pain.root_causes}
              featureFirstPrinciples={feature.first_principles}
              outcomeMeasuredBy={outcome.measured_by ?? null}
              alternatives={[]}
              approved={false}
              busy={false}
              onApprove={() => {}}
              onReject={() => {}}
              onHover={() => {}}
            />
            <ChainCard
              chain={{ ...chain, id: "chain-b" }}
              laneLabels={{
                pain: "Problem",
                features: "Mechanism",
                outcomes: "Result",
              }}
              archetype={{
                pain: { label: "Goal Alignment", color: "#DC2626" },
                feature: { label: "Goal Setting Tools", color: "#475569" },
                result: { label: "Productivity Boost", color: "#16A34A" },
              }}
              painRootCauses={[
                "Generic productivity advice",
                "No personal goal context",
              ]}
              featureFirstPrinciples={[
                "Make implicit goals explicit",
                "Tie activities to a north-star",
              ]}
              outcomeMeasuredBy="80% of activities align with user-set goals"
              alternatives={[]}
              approved
              busy={false}
              onApprove={() => {}}
              onReject={() => {}}
              onHover={() => {}}
            />
          </ul>
        </div>

        <div style={{ height: 64 }} />
        <div
          style={{
            marginBottom: 24,
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(15,23,42,0.45)",
            fontWeight: 500,
          }}
        >
          Portfolio Strip · Redesign preview
        </div>
        <PortfolioStrip
          categories={portfolioCategories}
          painItems={portfolioPainItems}
          featureItems={portfolioFeatureItems}
          outcomeItems={portfolioOutcomeItems}
          chains={portfolioChains}
          approvedEdgeIds={new Set<string>()}
          onGapsClick={() => {}}
        />

        <div style={{ height: 64 }} />
        <div
          style={{
            marginBottom: 24,
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(15,23,42,0.45)",
            fontWeight: 500,
          }}
        >
          Mechanism Lineup · Redesign preview
        </div>
        <div
          style={{
            background: "#ffffff",
            border: "1px solid rgba(15,23,42,0.06)",
            borderRadius: 24,
            padding: "20px 24px 24px",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 32px -16px rgba(11,18,40,0.18)",
          }}
        >
          <MechanismLineup
            variations={lineupVariations}
            featureId={FEATURE_ID}
            hasScores
            loading={false}
            scoringBusy={false}
            refiningBusy={false}
            actionError={null}
            onScore={() => {}}
            onRefine={() => {}}
            onElect={() => {}}
            onReject={() => {}}
            onOpenFeatureDetail={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
