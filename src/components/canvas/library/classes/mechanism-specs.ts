// ── Mechanism spec asset class (v3 — Step 19) ──
//
// Sources v3 mechanism artifacts from `library_objects` (object_type
// === "mechanism", populated by the mechanism-spec route per Step
// 18). Renders each as a row in the LibraryPanel + drops onto the
// whiteboard as a `mechanism-spec-card` tldraw shape.
//
// Distinct from any future `mechanisms` asset class that would key
// to the legacy `mechanisms` table — those represent twin/strategy-
// flow mechanisms; THESE represent Claude-composed designed
// mechanism artifacts. Both can coexist in the registry; LibraryPanel
// dedupes by `key`.

import { Sparkles } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { LibraryObjectRow } from "@/lib/objective-canvas/library-objects";
import type { DesignArtifact } from "@/lib/objective-canvas/mechanism-design-artifact";
import type { MechanismDesignIntent } from "@/lib/objective-canvas/enrich-mechanism-spec";

// Accent color per design_intent.accent_intent — matches the
// premium artifact view + brief renderer.
const ACCENT_COLOR: Record<MechanismDesignIntent["accent_intent"], string> = {
  signal: "#0a84ff",
  warning: "#d97706",
  growth: "#16a34a",
  insight: "#7c3aed",
  neutral: "#0f172a",
};

const HERO_LABEL: Record<MechanismDesignIntent["hero_pattern"], string> = {
  metric: "Moves a metric",
  flow: "Transforms in a flow",
  cycle: "Feedback loop",
  before_after: "Changes a state",
  evidence: "Grounds in evidence",
  decision: "Branches by decision",
};

// Decoded content_snapshot the upserter stashed (see
// mechanism-spec/route.ts Step 18). Optional throughout — null when
// design_intent/artifact weren't composed.
interface MechanismContentSnapshot {
  spec_summary?: {
    mechanism_of_action?: string;
    chosen_method?: string;
    evidence_strength?: "established" | "plausible" | "speculative";
    use_case_mode?: string;
  };
  design_intent?: MechanismDesignIntent | null;
  design_artifact?: DesignArtifact | null;
  snapshot_at?: string;
}

interface MechanismLibraryRow extends LibraryObjectRow {
  _snapshot: MechanismContentSnapshot;
}

function readSnapshot(raw: unknown): MechanismContentSnapshot {
  if (!raw || typeof raw !== "object") return {};
  return raw as MechanismContentSnapshot;
}

export const mechanismSpecAssetClass: AssetClassDefinition<MechanismLibraryRow> = {
  class: "mechanism_spec",
  label: "Designed mechanisms",
  pluralLabel: "designed mechanisms",
  icon: Sparkles,
  accent: "#0a84ff",
  group: "design",
  groupOrder: 0,
  shapeType: "mechanism-spec-card",

  fetchForSpace: async (spaceId): Promise<MechanismLibraryRow[]> => {
    try {
      const res = await fetch(
        `/api/brainstorm/space/${encodeURIComponent(spaceId)}/library/objects?type=mechanism`,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { objects?: LibraryObjectRow[] };
      const objects = json.objects ?? [];
      return objects.map((row) => ({
        ...row,
        _snapshot: readSnapshot(row.content_snapshot),
      }));
    } catch {
      return [];
    }
  },

  toLibraryRow: (row, ctx): LibraryRow => {
    const di = row._snapshot.design_intent;
    const ev = row._snapshot.spec_summary?.evidence_strength;
    const accent = di ? ACCENT_COLOR[di.accent_intent] : "#0f172a";
    const subtitleParts: string[] = [];
    if (di) subtitleParts.push(HERO_LABEL[di.hero_pattern].toLowerCase());
    if (ev) subtitleParts.push(ev);
    return {
      key: `mechanism_spec:${row.id}`,
      class: "mechanism_spec",
      id: row.id,
      title: row.title,
      subtitle: subtitleParts.join(" · "),
      stat: row._snapshot.design_artifact?.sections?.length
        ? `${row._snapshot.design_artifact.sections.length} sec`
        : null,
      accent,
      isPlaced: ctx.isPlaced,
      href:
        row.source_entity_id && ctx.spaceId
          ? `/app/space/${ctx.spaceId}/sub-objective/${row.source_sub_objective_id ?? ""}?entity=${row.source_entity_id}`
          : null,
    };
  },

  toShapeProps: (payload: LibraryAssetPayload) => {
    const extras = (payload.extras ?? {}) as Record<string, unknown>;
    const snapshot = readSnapshot(extras.content_snapshot);
    const di = snapshot.design_intent;
    const artifact = snapshot.design_artifact;
    const evidence =
      snapshot.spec_summary?.evidence_strength ?? "plausible";
    const captionParts: string[] = [];
    if (di) captionParts.push(HERO_LABEL[di.hero_pattern]);
    if (di) captionParts.push(di.density);
    if (di) captionParts.push(di.motion_intent);
    const caption =
      captionParts.length > 0
        ? captionParts.join(" · ")
        : (snapshot.spec_summary?.chosen_method ?? "Designed mechanism");
    return {
      type: "mechanism-spec-card",
      w: 248,
      h: 132,
      props: {
        objectId: payload.id,
        sourceEntityId:
          typeof extras.source_entity_id === "string"
            ? extras.source_entity_id
            : null,
        sourceSubObjectiveId:
          typeof extras.source_sub_objective_id === "string"
            ? extras.source_sub_objective_id
            : null,
        title: payload.preview.title.slice(0, 200),
        caption: caption.slice(0, 240),
        accentIntent: di?.accent_intent ?? "neutral",
        heroPattern: di?.hero_pattern ?? "flow",
        evidenceStrength: evidence,
        sectionCount: artifact?.sections?.length ?? 0,
        designArtifactJson: artifact ? JSON.stringify(artifact) : "",
      },
    };
  },
};
