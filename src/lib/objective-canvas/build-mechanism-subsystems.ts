// ── build-mechanism-subsystems ────────────────────────────────────
//
// Pure transform: the room's lanes + edges + room_categories (data the
// room view already holds) → props for <MechanismSubsystemView>. This is
// the COUPLING layer the causal-flow Map drops — mechanism↔mechanism
// composes_with / interferes_with — grouped into subsystems by sub_category.
//
// composes_with / interferes_with are SYMMETRIC (verified in the generator:
// "Pairs are SYMMETRIC for composes_with"), so they map to undirected
// CouplingEdges, not dependency arrows.

import type { RoomLane } from "@/components/objective/sub-objective-room-view";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";
import type {
  SubsystemSpec,
  MechanismSpec,
  CouplingEdge,
} from "@/components/objective/mechanism-subsystem-view";

interface EdgeLike {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  conditions?: string | null;
}

// Mechanism-family hues (mirrors generate-categories' mechanism palette) so
// subsystems read as variations of one "mechanism" identity, not a new
// palette.
const SUBSYSTEM_PALETTE = ["#2563EB", "#7C3AED", "#0E7490", "#4338CA", "#1D4ED8", "#0D9488"];
const UNCATEGORIZED = "__uncat";

function pickString(
  cc: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const v = cc?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function buildMechanismSubsystems(input: {
  lanes: RoomLane[];
  edges: EdgeLike[];
  roomCategories: RoomCategories;
}): {
  subsystems: SubsystemSpec[];
  mechanisms: MechanismSpec[];
  composes: CouplingEdge[];
  conflicts: CouplingEdge[];
} {
  const features = input.lanes.find((l) => l.slug === "features")?.items ?? [];
  const featureIds = new Set(features.map((f) => f.id));

  const labelForSub = (slug: string): string =>
    slug === UNCATEGORIZED
      ? "Other mechanisms"
      : input.roomCategories.mechanism?.find((c) => c.slug === slug)?.label ??
        "Other mechanisms";

  const mechanisms: MechanismSpec[] = features.map((f) => {
    const cc = f.causal_chain as Record<string, unknown> | null;
    return {
      id: f.id,
      name: f.name,
      subtitle:
        pickString(cc, "positive_outcome") ??
        (f.description ? f.description.slice(0, 64) : null),
      subsystem: pickString(cc, "sub_category") ?? UNCATEGORIZED,
    };
  });

  // Distinct subsystems in first-appearance order → stable colors.
  const order: string[] = [];
  for (const m of mechanisms) if (!order.includes(m.subsystem)) order.push(m.subsystem);
  const subsystems: SubsystemSpec[] = order.map((slug, i) => ({
    id: slug,
    label: labelForSub(slug),
    color: SUBSYSTEM_PALETTE[i % SUBSYSTEM_PALETTE.length],
  }));

  const couplingsOf = (rel: string): CouplingEdge[] =>
    input.edges
      .filter(
        (e) =>
          e.relationship_type === rel &&
          featureIds.has(e.source_entity_id) &&
          featureIds.has(e.target_entity_id),
      )
      .map((e) => ({
        a: e.source_entity_id,
        b: e.target_entity_id,
        rationale: typeof e.conditions === "string" ? e.conditions : null,
      }));

  return {
    subsystems,
    mechanisms,
    composes: couplingsOf("composes_with"),
    conflicts: couplingsOf("interferes_with"),
  };
}
