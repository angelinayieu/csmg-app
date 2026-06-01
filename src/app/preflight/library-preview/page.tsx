// Preview harness for LibraryPanel — verifies the populated render without
// the authed fetch (via initialObjects). Mirrors the 5 real backfilled
// objects + a couple of state variations. Public route. SAFE TO DELETE.

"use client";

import { LibraryPanel } from "@/components/objective/library-panel";
import type {
  DeferredProposalLite,
  LibraryObjectRow,
} from "@/lib/objective-canvas/library-objects";

function obj(p: Partial<LibraryObjectRow> & { id: string; title: string }): LibraryObjectRow {
  return {
    space_id: "sp",
    object_type: "feature",
    summary: null,
    source_entity_id: "ent",
    source_sub_objective_id: null,
    source_ref: "var",
    blueprint_layer_ordinal: null,
    rank_score: null,
    selection_status: "selected",
    included_in_spec: true,
    in_strategy_brief: false,
    on_whiteboard: false,
    board_shape_id: null,
    ...p,
  };
}

const MOCK: LibraryObjectRow[] = [
  obj({ id: "1", title: "Contextual Relevance Filtering", object_type: "feature" }),
  obj({ id: "2", title: "Goal-Based Content Prioritization", object_type: "feature", on_whiteboard: true }),
  obj({ id: "3", title: "Dynamic Context Awareness Module", object_type: "mechanism" }),
  obj({ id: "4", title: "Data-sharing incentive A/B test", object_type: "experiment", included_in_spec: false }),
  obj({ id: "5", title: "Users can't tell intentional research from passive scrolling", object_type: "insight", included_in_spec: false }),
];

const MOCK_DEFERRED: DeferredProposalLite[] = [
  {
    id: "d1",
    title: "Anonymity Options",
    summary:
      "A feature that allows users to post anonymously, reducing the pressure associated with content sharing.",
    rationale: null,
  },
  {
    id: "d2",
    title: "Content Moderation Algorithms",
    summary:
      "Automated systems that ensure content quality and relevance without imposing excessive restrictions.",
    rationale: null,
  },
];

export default function LibraryPreview() {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "rgba(15,23,42,0.5)" }}>
        LibraryPanel harness — saved objects, hover a row for Board / remove
      </h1>
      <LibraryPanel spaceId="preview" initialObjects={MOCK} initialDeferred={MOCK_DEFERRED} />
      <p style={{ fontSize: 11.5, color: "rgba(15,23,42,0.4)", marginTop: 16 }}>
        Real panel fetches GET /library/objects; here it&apos;s fed mock data.
      </p>
    </div>
  );
}
