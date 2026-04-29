"use client";

// ── Space-wide app-pair index (F4 / D14) ─────────────────────────────
//
// Loads `apps` rows for the space and exposes a map of pair-keys
// (canonical sorted "leftAppId|rightAppId") → metadata used by the
// app-pair-tether overlay. Each pair appears EXACTLY ONCE in the map
// (the canonical key dedupes the bidirectional `complementary_app_ids`
// links).
//
// Mirrors the useSpaceReactions / useSpaceSubjectScopes pattern. Single
// fetch per space, refreshKey to re-fetch after mutations.
//
// Why we don't read complementary_app_ids[] off the canvas shapes:
// AppCardShape props don't include it (would require schema migration
// of every existing app-card shape). Easier to fetch once + index in
// React state.

import { useEffect, useMemo, useState } from "react";

export type ApplicationType =
  | "game"
  | "measurement"
  | "intervention"
  | "analysis"
  | "educational"
  | "clinical"
  | "other";

/** Per-application accent colors. Keyed by application_type so each
 *  end of a tether can render in its app's domain hue (game = amber,
 *  measurement = blue, etc.). */
export const APPLICATION_TYPE_ACCENT: Record<ApplicationType, string> = {
  game: "#f59e0b",
  measurement: "#3b82f6",
  intervention: "#10b981",
  analysis: "#a855f7",
  educational: "#06b6d4",
  clinical: "#ef4444",
  other: "#64748b",
};

/** What we keep about each app for tether rendering. */
interface AppPairAppMeta {
  app_id: string;
  name: string;
  application_type: ApplicationType | null;
}

/** One pair entry in the index. Symmetric — both ends are interchangeable. */
export interface AppPairEntry {
  /** Canonical key — `min(id)|max(id)` so the same pair only appears once
   *  even though both apps point at each other in the DB. */
  pair_key: string;
  left: AppPairAppMeta;
  right: AppPairAppMeta;
  /** Accent colors for each end — drives the gradient + label color. */
  left_accent: string;
  right_accent: string;
  /** Short label rendered on the mid-pill. Defaults to "paired" but
   *  derives "game ↔ measurement" / etc. from the application_types
   *  when both ends are typed. */
  label: string;
}

export interface AppPairIndex {
  /** All pairs in this space, deduped to canonical keys. */
  pairs: AppPairEntry[];
  /** Lookup: app_id → canonical pair_keys this app participates in.
   *  An app that pairs with TWO others appears in two pair_keys. */
  pairsByAppId: Map<string, string[]>;
  loading: boolean;
}

interface AppRow {
  id: string;
  name: string;
  application_type: ApplicationType | null;
  complementary_app_ids: string[] | null;
}

const EMPTY_INDEX: AppPairIndex = {
  pairs: [],
  pairsByAppId: new Map(),
  loading: false,
};

function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function deriveLabel(
  leftType: ApplicationType | null,
  rightType: ApplicationType | null,
): string {
  if (leftType && rightType && leftType !== rightType) {
    return `${leftType} ↔ ${rightType}`;
  }
  return "paired";
}

export function useSpaceAppPairs(
  spaceId: string | null | undefined,
  refreshKey: number = 0,
): AppPairIndex {
  const [apps, setApps] = useState<AppRow[]>([]);
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
      .then((data: { apps?: AppRow[] }) => {
        setApps(Array.isArray(data?.apps) ? data.apps : []);
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

    // appId → meta lookup
    const metaById = new Map<string, AppPairAppMeta>();
    for (const a of apps) {
      metaById.set(a.id, {
        app_id: a.id,
        name: a.name,
        application_type: a.application_type,
      });
    }

    const seen = new Set<string>();
    const pairs: AppPairEntry[] = [];
    const pairsByAppId = new Map<string, string[]>();

    for (const a of apps) {
      const partners = Array.isArray(a.complementary_app_ids)
        ? a.complementary_app_ids
        : [];
      for (const partnerId of partners) {
        // Skip self-loops + dangling references
        if (partnerId === a.id) continue;
        const partner = metaById.get(partnerId);
        if (!partner) continue;
        const key = canonicalPairKey(a.id, partnerId);
        if (seen.has(key)) continue;
        seen.add(key);

        // Determine left/right by canonical order so the gradient
        // direction is stable across renders.
        const [leftId, rightId] = key.split("|") as [string, string];
        const left = metaById.get(leftId)!;
        const right = metaById.get(rightId)!;

        const leftAccent = left.application_type
          ? APPLICATION_TYPE_ACCENT[left.application_type]
          : APPLICATION_TYPE_ACCENT.other;
        const rightAccent = right.application_type
          ? APPLICATION_TYPE_ACCENT[right.application_type]
          : APPLICATION_TYPE_ACCENT.other;

        pairs.push({
          pair_key: key,
          left,
          right,
          left_accent: leftAccent,
          right_accent: rightAccent,
          label: deriveLabel(left.application_type, right.application_type),
        });

        for (const sideId of [leftId, rightId]) {
          const existing = pairsByAppId.get(sideId);
          if (existing) {
            existing.push(key);
          } else {
            pairsByAppId.set(sideId, [key]);
          }
        }
      }
    }

    return { pairs, pairsByAppId, loading };
  }, [apps, loading]);
}
