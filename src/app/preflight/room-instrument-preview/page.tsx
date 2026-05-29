// Preview harness for the room's always-on instrument legend + the
// breadcrumb placement chip. Mock data only — renders the real
// RoomInstrumentLegend + SubObjectiveRoomHeader without an
// authenticated room so we can debug layout/visual issues.
// Public route. SAFE TO DELETE.

"use client";

import { RoomInstrumentLegend } from "@/components/objective/sub-objective-room-view";
import type { RoomLane } from "@/components/objective/sub-objective-room-view";
import { SubObjectiveRoomHeader } from "@/components/objective/sub-objective-room-header";
import { appleVibe } from "@/lib/apple-vibe-tokens";

function item(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    entity_type: "x",
    causal_chain: null,
  };
}

const LANES: RoomLane[] = [
  {
    slug: "pain",
    label: "Problems",
    color: appleVibe.stage.pain,
    items: [item("p1", "Goal Alignment"), item("p2", "Information Overload"), item("p3", "Relevance"), item("p4", "Motivation")],
  },
  {
    slug: "features",
    label: "Mechanisms",
    color: appleVibe.stage.features,
    items: [item("m1", "Personalized Recs"), item("m2", "Goal Tracking"), item("m3", "Privacy Controls"), item("m4", "Feedback Loops")],
  },
  {
    slug: "outcomes",
    label: "Results",
    color: appleVibe.stage.outcomes,
    items: [item("r1", "Career Advancement"), item("r2", "Skill Acquisition"), item("r3", "Engagement"), item("r4", "Data Insights")],
  },
  {
    slug: "objective",
    label: "Objective",
    color: appleVibe.stage.objective,
    items: [item("o1", "Goal-Driven Knowledge Pathways")],
  },
];

export default function RoomInstrumentPreview() {
  return (
    <div
      className="min-h-screen pb-24"
      style={{
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <SubObjectiveRoomHeader
        spaceId="preview"
        title="Goal-Driven Knowledge Pathways"
        titleAnnotations={[]}
        topNegativeOutcome="Users fail to align digital activities with career advancement goals, missing long-term opportunities."
        placement={{ label: "L3 · Goal Conversion", archetype: "process" }}
      />

      <div className="mx-auto mt-10 w-full max-w-[1400px] px-8">
        <RoomInstrumentLegend lanes={LANES} />

        <div
          className="mt-4 rounded-2xl p-6 text-[12px]"
          style={{ color: appleVibe.text.tertiary }}
        >
          ↑ The instrument legend sits above every room view (Categories /
          Variables / Map). The breadcrumb chip above shows the room&apos;s
          altitude on the outer ObjectiveStack.
        </div>
      </div>
    </div>
  );
}
