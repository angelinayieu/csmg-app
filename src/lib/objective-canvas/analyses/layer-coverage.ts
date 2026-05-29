// ── Analysis: layer coverage (Tier 1) ─────────────────────────────
//
// Phase 11.A.10 — surfaces gaps in the user's coverage of the
// ObjectiveStack. The user generated the stack at the
// clarifying→picking transition; the workbench reports which layers
// have rooms touching them and which don't.
//
// Three finding shapes (by severity):
//
//   uncovered (severity: high)
//     A layer with ZERO rooms touching it. The user has generated
//     rooms but none operate at this layer — the problem's
//     foundational substrate or measurement framework is missing.
//
//   light_coverage (severity: medium)
//     A layer with only 1 room. Single-point coverage means the
//     layer's variables only get one mechanism's worth of attention.
//     For high-leverage layers (L1 substrate, L_top outcome) this is
//     often a real strategic gap.
//
//   over_concentration (severity: info)
//     A layer with >50% of all rooms. Tells the user "you're working
//     hard on this layer — is that the right altitude, or is the
//     bottleneck somewhere else?" Common when users instinct-pick
//     mechanism-layer (L3-L4) sub-objectives and ignore substrate.
//
// Tier 1: no LLM. Pure room → layer_ordinals counting via the
// improvement_goals.layer_ordinals column (Phase 11.A.1 migration).
//
// Requires: state.layers populated AND room→layer assignments via
// improvement_goals.layer_ordinals. When either is absent, returns
// [] cleanly — pre-11.A spaces just don't see these findings.

import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "layer_coverage";

/** When a single layer has more than this fraction of total rooms,
 *  flag over-concentration. Tuned so 3 rooms / 5 total (60%) trips
 *  but 2/5 (40%) doesn't. */
const CONCENTRATION_THRESHOLD = 0.5;

export const layerCoverage: AnalysisModule = {
  key: KEY,
  label: "Layer Coverage",
  description:
    "Which layers of your objective are addressed by rooms, and where the gaps live.",
  category: "gap",
  tier: 1,
  trigger: "auto_on_scan",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    const stack = state.layers;
    // Pre-Phase-11.A space or stack not yet generated — no analysis.
    if (!stack || stack.layers.length === 0) return [];
    if (state.rooms.length === 0) return [];

    // Build a layer_ordinals lookup per room. The loader now projects
    // improvement_goals.layer_ordinals onto RoomSnapshot, so rooms tagged
    // to one or more layers populate the map; untagged rooms are skipped
    // (and surface as the "not yet tagged" finding below).
    const ordinalsByRoom = new Map<string, number[]>();
    for (const r of state.rooms) {
      if (Array.isArray(r.layer_ordinals) && r.layer_ordinals.length > 0) {
        ordinalsByRoom.set(r.id, r.layer_ordinals);
      }
    }

    // If NO rooms have layer tags yet, surface a single "tagging
    // needed" finding rather than mass-flagging every layer as
    // uncovered (which would be noisy).
    if (ordinalsByRoom.size === 0) {
      return [
        {
          id: deterministicId(KEY, `${state.space_id}-untagged`),
          analysis_key: KEY,
          category: "gap",
          severity: "info",
          tier: 1,
          title: "Rooms not yet tagged to layers",
          summary: `${state.rooms.length} room${state.rooms.length === 1 ? "" : "s"} exist but none are tagged with layer_ordinals — run the proposer in tag-only mode to assign each room to the layers it touches.`,
          body: {
            stack_template: stack.domain_template,
            layer_count: stack.layers.length,
            room_count: state.rooms.length,
          },
          references: {
            room_ids: state.rooms.map((r) => r.id),
            item_ids: [],
          },
          disposition: "open",
          generated_at: new Date().toISOString(),
        },
      ];
    }

    // Per-layer room count.
    const roomCountByLayer = new Map<number, string[]>();
    for (const [roomId, ordinals] of ordinalsByRoom) {
      for (const ord of ordinals) {
        const list = roomCountByLayer.get(ord) ?? [];
        list.push(roomId);
        roomCountByLayer.set(ord, list);
      }
    }

    const findings: AnalysisFinding[] = [];
    const totalRooms = ordinalsByRoom.size;

    for (const layer of stack.layers) {
      const rooms = roomCountByLayer.get(layer.ordinal) ?? [];
      const count = rooms.length;

      if (count === 0) {
        // Uncovered — surfaces as the "propose a complementary sub-
        // objective for this layer" suggestion in the workbench.
        findings.push({
          id: deterministicId(
            KEY,
            `${state.space_id}-uncovered-L${layer.ordinal}`,
          ),
          analysis_key: KEY,
          category: "gap",
          severity: "high",
          tier: 1,
          title: `${layer.name} (${layer.id}) uncovered`,
          summary: `No room operates at ${layer.id} · ${layer.archetype}. ${
            layer.archetype === "substrate"
              ? "The problem's foundational inputs aren't being addressed — work elsewhere may be downstream of the actual bottleneck."
              : layer.archetype === "outcome" || layer.archetype === "output"
                ? "No measurement framework — without this layer, you can't tell if anything else is working."
                : `Variables at this altitude (${layer.variables.slice(0, 3).map((v) => v.name).join(", ")}${layer.variables.length > 3 ? ", …" : ""}) have no mechanism touching them.`
          }`,
          body: {
            layer_ordinal: layer.ordinal,
            layer_id: layer.id,
            layer_name: layer.name,
            layer_archetype: layer.archetype,
            variable_count: layer.variables.length,
            // Pre-fill the proposal template that "Propose
            // complementary sub-objective" buttons can use.
            suggested_subobjective_title: `Address ${layer.name}`,
            suggested_subobjective_description: `Cover the ${layer.id} · ${layer.archetype} layer of the objective — ${layer.description}`,
          },
          references: { room_ids: [], item_ids: [] },
          disposition: "open",
          generated_at: new Date().toISOString(),
        });
      } else if (count === 1 && totalRooms >= 3) {
        // Light coverage — only meaningful when there are enough other
        // rooms to make single-point coverage feel anemic. For 1-2
        // total rooms, single coverage is fine and we skip.
        findings.push({
          id: deterministicId(
            KEY,
            `${state.space_id}-light-L${layer.ordinal}`,
          ),
          analysis_key: KEY,
          category: "gap",
          severity: layer.archetype === "substrate" || layer.archetype === "outcome" ? "medium" : "low",
          tier: 1,
          title: `${layer.name} (${layer.id}) lightly covered`,
          summary: `Only 1 of ${totalRooms} rooms touches ${layer.id}. ${
            layer.archetype === "substrate"
              ? "Substrate layers benefit from multiple angles — a single mechanism rarely covers all the foundational inputs."
              : "Single-point coverage at this layer means one mechanism is the only attempt — worth diversifying if this layer drives outcomes."
          }`,
          body: {
            layer_ordinal: layer.ordinal,
            layer_id: layer.id,
            layer_name: layer.name,
            layer_archetype: layer.archetype,
            room_count: count,
            total_rooms: totalRooms,
          },
          references: { room_ids: rooms, item_ids: [] },
          disposition: "open",
          generated_at: new Date().toISOString(),
        });
      } else if (
        totalRooms >= 4 &&
        count / totalRooms > CONCENTRATION_THRESHOLD
      ) {
        // Over-concentration — only flag when we have enough rooms to
        // make the ratio meaningful (≥4) AND the layer carries >50%
        // of them. Helps the user notice "I keep working at L3 — is
        // that the right altitude?"
        const pct = Math.round((count / totalRooms) * 100);
        findings.push({
          id: deterministicId(
            KEY,
            `${state.space_id}-concentrated-L${layer.ordinal}`,
          ),
          analysis_key: KEY,
          category: "priority",
          severity: "info",
          tier: 1,
          title: `${layer.name} (${layer.id}) over-concentrated`,
          summary: `${count} of ${totalRooms} rooms (${pct}%) work at ${layer.id} · ${layer.archetype}. Is this the right altitude, or is the bottleneck somewhere else on the stack?`,
          body: {
            layer_ordinal: layer.ordinal,
            layer_id: layer.id,
            layer_name: layer.name,
            layer_archetype: layer.archetype,
            room_count: count,
            total_rooms: totalRooms,
            concentration_pct: pct,
          },
          references: { room_ids: rooms, item_ids: [] },
          disposition: "open",
          generated_at: new Date().toISOString(),
        });
      }
    }

    return findings;
  },
};

/** Deterministic id so the same finding gets the same id across
 *  rescans — lets disposition state (acknowledged / dismissed) survive
 *  re-runs of the analysis. Mirrors the pattern in other Tier 1
 *  analyses. */
function deterministicId(key: string, ref: string): string {
  return `${key}::${ref}`;
}
