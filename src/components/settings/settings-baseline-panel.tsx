"use client";

import { useState } from "react";
import {
  UserBaselineCard,
  type UserBaselineCardProps,
} from "@/components/user-baseline/user-baseline-card";

type Baseline = UserBaselineCardProps["baseline"];

/**
 * Wave C — Settings "Your baseline" panel.
 *
 * Thin client wrapper around UserBaselineCard that owns the local state
 * for optimistic baseline updates after clicking Regenerate. The parent
 * (SettingsPage) fetches the baseline once via SSR; after a regenerate
 * the new fields land in local state so the card refreshes without a
 * full page reload.
 */
export function SettingsBaselinePanel({
  initialBaseline,
}: {
  initialBaseline: Baseline;
}) {
  const [baseline, setBaseline] = useState<Baseline>(initialBaseline);

  async function handleRegenerate() {
    const res = await fetch("/api/user-baseline/regenerate", {
      method: "POST",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      digest?: {
        persona_tags?: string[];
        behavior_summary?: string;
        goal_preferences?: Record<string, unknown>;
        baseline_metrics?: Record<string, unknown>;
      };
      skipped_reason?: string;
    };
    if (body.digest) {
      setBaseline({
        persona_tags: body.digest.persona_tags ?? [],
        behavior_summary: body.digest.behavior_summary ?? null,
        goal_preferences: body.digest.goal_preferences ?? {},
        baseline_metrics: body.digest.baseline_metrics ?? {},
        behavior_summary_updated_at: new Date().toISOString(),
      });
    } else if (body.skipped_reason === "insufficient_events") {
      // Digest didn't run because too few events; bump the updated_at
      // so the UI reflects that we *tried* just now.
      setBaseline((prev) => ({
        ...prev,
        behavior_summary:
          "Not enough activity yet to infer a pattern. Keep using the product and this will fill in.",
        behavior_summary_updated_at: new Date().toISOString(),
      }));
    }
  }

  return (
    <UserBaselineCard
      baseline={baseline}
      variant="expanded"
      onRegenerate={handleRegenerate}
    />
  );
}
