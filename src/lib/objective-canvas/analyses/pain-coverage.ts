// ── Analysis: pain coverage (Tier 1) ──────────────────────────────
//
// For each pain item across all rooms: count incoming/outgoing
// addressing edges to/from features. A pain with ZERO addressing
// edges is uncovered — the room ideated the problem but didn't
// design a counter. Each is a finding.
//
// We also detect pains addressed by features in OTHER rooms — a
// cross-room signal that the same pain is being solved in a
// neighbor room (often a redundancy or a missed coordination
// opportunity).
//
// Tier 1: no LLM. Edge counting.

import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "pain_coverage";

export const painCoverage: AnalysisModule = {
  key: KEY,
  label: "Pain coverage",
  description:
    "Pain items with no addressing feature edges, or addressed only by features in other rooms.",
  category: "gap",
  tier: 1,
  trigger: "auto_on_scan",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.items.length === 0) return [];

    const itemById = new Map(state.items.map((i) => [i.id, i]));
    // For each pain id: edges where it's an endpoint AND the other
    // endpoint is a feature.
    const featuresAddressing = new Map<
      string,
      Array<{ feature_id: string; feature_room_id: string; edge_id: string }>
    >();

    for (const e of state.edges) {
      const src = itemById.get(e.source_entity_id);
      const tgt = itemById.get(e.target_entity_id);
      if (!src || !tgt) continue;
      const pain = src.layer === "pain" ? src : tgt.layer === "pain" ? tgt : null;
      const feat =
        src.layer === "features" ? src : tgt.layer === "features" ? tgt : null;
      if (!pain || !feat) continue;
      const list = featuresAddressing.get(pain.id) ?? [];
      list.push({
        feature_id: feat.id,
        feature_room_id: feat.room_id,
        edge_id: e.id,
      });
      featuresAddressing.set(pain.id, list);
    }

    const findings: AnalysisFinding[] = [];
    const now = new Date().toISOString();

    for (const item of state.items) {
      if (item.layer !== "pain") continue;
      const addressing = featuresAddressing.get(item.id) ?? [];
      const roomTitle =
        state.rooms.find((r) => r.id === item.room_id)?.title ?? "?";

      if (addressing.length === 0) {
        // Fully uncovered pain.
        findings.push({
          id: `${KEY}__uncovered__${item.id}`,
          analysis_key: KEY,
          category: "gap",
          severity: "high",
          tier: 1,
          title: `"${item.name}" — no addressing feature`,
          summary: `Pain in ${roomTitle} has zero feature edges. Add or generate a counter mechanism.`,
          body: {
            kind: "uncovered",
            pain_id: item.id,
            pain_name: item.name,
            room_id: item.room_id,
            room_title: roomTitle,
          },
          references: {
            room_ids: [item.room_id],
            item_ids: [item.id],
          },
          disposition: "open",
          generated_at: now,
        });
      } else {
        // Pain has features addressing it — check if any are in
        // OTHER rooms. Cross-room addressing is a coordination
        // signal: the user might not realize Room B is solving
        // Room A's pain.
        const otherRoomAddressers = addressing.filter(
          (a) => a.feature_room_id !== item.room_id,
        );
        if (otherRoomAddressers.length > 0) {
          const otherRoomIds = Array.from(
            new Set(otherRoomAddressers.map((a) => a.feature_room_id)),
          );
          const otherRoomNames = otherRoomIds
            .map(
              (rid) => state.rooms.find((r) => r.id === rid)?.title ?? "?",
            )
            .slice(0, 3)
            .join(", ");
          findings.push({
            id: `${KEY}__cross_addressed__${item.id}`,
            analysis_key: KEY,
            category: "structure",
            severity: "medium",
            tier: 1,
            title: `"${item.name}" — addressed by other rooms`,
            summary: `Pain in ${roomTitle} is addressed by features in ${otherRoomNames}. Could be redundancy or a missed coordination cue.`,
            body: {
              kind: "cross_addressed",
              pain_id: item.id,
              pain_name: item.name,
              pain_room_id: item.room_id,
              addressing_room_ids: otherRoomIds,
              addresser_count: otherRoomAddressers.length,
            },
            references: {
              room_ids: [item.room_id, ...otherRoomIds],
              item_ids: [
                item.id,
                ...otherRoomAddressers.map((a) => a.feature_id),
              ],
            },
            disposition: "open",
            generated_at: now,
          });
        }
      }
    }

    return findings.sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });
  },
};
