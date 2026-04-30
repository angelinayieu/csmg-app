"use client";

// ── Lab downstream-apps hook (L3 / D14 follow-up) ─────────────────────
//
// Fetches apps for the current space, groups them by `application_type`
// (game | measurement | intervention | analysis | …), and exposes them
// to the Lab's "Lab feeds" panel so users see which downstream apps
// the active Lab run is informing.
//
// Mirrors useSpaceAppPairs but optimized for the per-Twin lab view:
//   - Groups by application_type instead of by complementary pair
//   - Surfaces dominant_entity_codes per app for "this app targets…"
//     and "this app measures via…" rendering
//   - No pair-key dedup (each app shows once even if it pairs with
//     multiple others)
//
// Until per-Twin scoping lands (when Subjects are real KG-backed
// rows, not archetypes), all apps in the space surface in the panel.
// Future: filter by `apps.serves_subject_id` or similar.

import { useEffect, useMemo, useState } from "react";
import type { CardSpec } from "@/types/card-spec";

export type ApplicationType =
  | "game"
  | "measurement"
  | "intervention"
  | "analysis"
  | "educational"
  | "clinical"
  | "other";

export interface DownstreamAppRow {
  id: string;
  name: string;
  description: string | null;
  application_type: ApplicationType | null;
  app_type: string;
  status: string;
  dominant_entity_codes: string[];
  /** Tagline pulled from `apps.config.tagline` if the cognitive
   *  template seeded one. Used as the card subtitle. */
  tagline: string | null;
  /** Rationale pulled from `apps.config.rationale` — shown in
   *  expanded card detail / hover. */
  rationale: string | null;
  /** Bidirectional pair links — used by the panel to render small
   *  "paired with [other-app-name]" notes inline. */
  complementary_app_ids: string[];
  /** Archetype-driven card spec — when present, the lab panel renders
   *  the full <CardSpecRenderer /> body instead of the legacy
   *  instrument-checklist / target-chip layout. */
  card_spec: CardSpec | null;
}

export interface LabDownstreamAppsIndex {
  /** All apps in space, ordered by application_type then by name. */
  all: DownstreamAppRow[];
  /** Grouped by application_type for section rendering. Empty arrays
   *  are dropped — only types with at least one app appear. */
  byType: Map<ApplicationType, DownstreamAppRow[]>;
  /** Convenience pre-computed groups for the most common Lab cases. */
  games: DownstreamAppRow[];
  measurements: DownstreamAppRow[];
  loading: boolean;
}

interface ApiAppRow {
  id: string;
  name: string;
  description: string | null;
  application_type: ApplicationType | null;
  app_type: string;
  status: string;
  dominant_entity_codes: string[] | null;
  config: Record<string, unknown> | null;
  complementary_app_ids: string[] | null;
}

const EMPTY_INDEX: LabDownstreamAppsIndex = {
  all: [],
  byType: new Map(),
  games: [],
  measurements: [],
  loading: false,
};

const TYPE_ORDER: ApplicationType[] = [
  "game",
  "measurement",
  "intervention",
  "analysis",
  "educational",
  "clinical",
  "other",
];

export function useLabDownstreamApps(
  spaceId: string | null | undefined,
  refreshKey: number = 0,
): LabDownstreamAppsIndex {
  const [apps, setApps] = useState<DownstreamAppRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setApps([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/apps?spaceId=${encodeURIComponent(spaceId)}`, {
      signal: ctrl.signal,
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) return { apps: [] };
        try {
          return await r.json();
        } catch {
          return { apps: [] };
        }
      })
      .then((data: { apps?: ApiAppRow[] }) => {
        const rows = Array.isArray(data?.apps) ? data.apps : [];
        const flat: DownstreamAppRow[] = rows.map((r) => {
          const config = (r.config ?? {}) as Record<string, unknown>;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            application_type: r.application_type,
            app_type: r.app_type,
            status: r.status,
            dominant_entity_codes: Array.isArray(r.dominant_entity_codes)
              ? r.dominant_entity_codes
              : [],
            tagline:
              typeof config.tagline === "string" ? config.tagline : null,
            rationale:
              typeof config.rationale === "string" ? config.rationale : null,
            complementary_app_ids: Array.isArray(r.complementary_app_ids)
              ? r.complementary_app_ids
              : [],
            card_spec:
              config.card_spec && typeof config.card_spec === "object"
                ? (config.card_spec as CardSpec)
                : null,
          };
        });
        setApps(flat);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setApps([]);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [spaceId, refreshKey]);

  return useMemo(() => {
    if (apps.length === 0) return { ...EMPTY_INDEX, loading };

    // Sort by application_type order, then by name for stability.
    const sorted = [...apps].sort((a, b) => {
      const aIdx = a.application_type
        ? TYPE_ORDER.indexOf(a.application_type)
        : 99;
      const bIdx = b.application_type
        ? TYPE_ORDER.indexOf(b.application_type)
        : 99;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.name.localeCompare(b.name);
    });

    const byType = new Map<ApplicationType, DownstreamAppRow[]>();
    for (const a of sorted) {
      if (!a.application_type) continue;
      const bucket = byType.get(a.application_type);
      if (bucket) {
        bucket.push(a);
      } else {
        byType.set(a.application_type, [a]);
      }
    }

    return {
      all: sorted,
      byType,
      games: byType.get("game") ?? [],
      measurements: byType.get("measurement") ?? [],
      loading,
    };
  }, [apps, loading]);
}

/** Humanize a `dominant_entity_codes` entry. Strips the standard
 *  template prefixes (`inst_`, `iv_`, `n_`) and underscore-cases the
 *  rest so "inst_digit_span" → "Digit Span". Used by the Lab panel
 *  for measurement instrument lists + game target lists. */
export function humanizeEntityCode(code: string): string {
  const stripped = code.replace(/^(inst_|iv_|n_)/i, "");
  return stripped
    .split("_")
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}
