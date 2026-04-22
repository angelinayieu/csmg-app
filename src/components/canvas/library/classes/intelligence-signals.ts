// ── Intelligence signal asset class (Phase A1.4b) ──
//
// External-world signals picked up by the radar / weave layer. Live
// inside synthesis_data.intelligence_radar.signals — ephemeral per
// synthesis, but dropping one on the whiteboard captures a frozen
// reading that survives later radar updates.

import { Flag } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { IntelligenceSignal, SignalStatus } from "@/types/intelligence";
import type { IntelligenceSignalsResponse } from "@/app/api/spaces/[id]/intelligence-signals/route";

type Severity = IntelligenceSignal["severity"];

const SEVERITY_ACCENT: Record<Severity, string> = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#64748b",
};

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const STATUS_ORDER: Record<SignalStatus, number> = {
  escalated: 5,
  active: 4,
  investigating: 3,
  dismissed: 2,
  resolved: 1,
};

function normalizeStatus(s: SignalStatus | undefined): SignalStatus {
  return s ?? "active";
}

export const intelligenceSignalAssetClass: AssetClassDefinition<IntelligenceSignal> = {
  class: "intelligence-signal",
  label: "Signals",
  pluralLabel: "intelligence signals",
  icon: Flag,
  accent: "#dc2626",
  group: "reasoning",
  groupOrder: 4,
  shapeType: "signal-flag",

  fetchForSpace: async (spaceId): Promise<IntelligenceSignal[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/intelligence-signals`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as IntelligenceSignalsResponse;
    const signals = json.signals ?? [];
    // Highest urgency (severity * status) first — escalated+high on top.
    return [...signals].sort((a, b) => {
      const sa =
        SEVERITY_ORDER[a.severity] * 10 +
        STATUS_ORDER[normalizeStatus(a.status)];
      const sb =
        SEVERITY_ORDER[b.severity] * 10 +
        STATUS_ORDER[normalizeStatus(b.status)];
      return sb - sa;
    });
  },

  toLibraryRow: (s, ctx): LibraryRow => {
    const accent = SEVERITY_ACCENT[s.severity];
    return {
      key: `intelligence-signal:${s.id}`,
      class: "intelligence-signal",
      id: s.id,
      title: s.entity_name || s.description,
      subtitle: s.description,
      stat: s.severity.toUpperCase().slice(0, 3),
      accent,
      isPlaced: ctx.isPlaced,
      href:
        ctx.spaceId && s.related_internal_entities[0]
          ? `/app/space/${ctx.spaceId}/entity/${s.related_internal_entities[0]}/lab`
          : null,
    };
  },

  toDragPayload: (s, ctx): LibraryAssetPayload => ({
    class: "intelligence-signal",
    id: s.id,
    spaceId: ctx.spaceId,
    preview: {
      title: s.entity_name || s.description,
      subtitle: s.description,
      accent: SEVERITY_ACCENT[s.severity],
    },
    extras: {
      signal_type: s.type,
      category: s.category,
      description: s.description,
      severity: s.severity,
      status: normalizeStatus(s.status),
      entity_name: s.entity_name,
      related_internal_entities: s.related_internal_entities,
      detected_at: s.detected_at,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const severity = (ext.severity as Severity | undefined) ?? "medium";
    const status = (ext.status as SignalStatus | undefined) ?? "active";
    const relatedIds = Array.isArray(ext.related_internal_entities)
      ? (ext.related_internal_entities as string[])
      : [];
    return {
      type: "signal-flag",
      props: {
        signalId: payload.id,
        spaceId: payload.spaceId,
        signalType:
          (ext.signal_type as string | undefined) ?? "new_entity",
        category:
          (ext.category as string | undefined) ?? "signal",
        description:
          (ext.description as string | undefined) ??
          payload.preview.title,
        severity,
        status,
        entityName:
          (ext.entity_name as string | undefined) ?? "",
        relatedInternalIds: relatedIds,
        detectedAt:
          (ext.detected_at as string | undefined) ??
          new Date().toISOString(),
      },
      w: 260,
      h: 128,
    };
  },

  filters: [
    {
      key: "severity",
      label: "Severity",
      extract: (s) => s.severity,
      presets: ["high", "medium", "low"],
    },
    {
      key: "status",
      label: "Status",
      extract: (s) => normalizeStatus(s.status),
      presets: ["active", "escalated", "investigating", "dismissed", "resolved"],
    },
    {
      key: "type",
      label: "Type",
      extract: (s) => s.type,
      presets: [
        "new_entity",
        "authority_change",
        "new_bridge",
        "entity_removed",
        "confidence_shift",
        "new_source",
      ],
    },
  ],

  shapeIdForItem: (id: string) => `signal-${id}`,
};
