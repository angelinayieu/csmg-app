// ── POST /api/brainstorm/item/[entityId]/baseline ─────────────────
//
// Phase 11.6 — set or update a baseline value on one of the
// outcome's proxy indicators. The room generator already emits
// indicators[] (string array) on each outcome's causal_chain. This
// endpoint augments those with USER-grounded measurement data:
//
//   • baseline_value     — where the user starts today (e.g. "8/10",
//                          "45 minutes", "72 bpm"). String for
//                          flexibility — the UI/agent renders as-is.
//   • target_value       — where they want to land
//   • unit               — short string ("minutes/day", "score 1-10")
//   • measurement_method — how they'll measure (e.g. "daily journal",
//                          "Apple Health", "GAD-2 self-report")
//   • source             — "user" (entered by hand) or "llm"
//                          (auto-filled from the LLM expansion-tree
//                          calibration_baseline node — see
//                          expansion-catalog.ts line ~588)
//
// Storage: entities.causal_chain.indicator_baselines — a new key on
// the existing JSONB, indexed by indicator_name. Backward-compatible:
// nothing reads it that doesn't tolerate undefined. The scorer
// (Phase 11.6b' follow-up — not in this commit) will read it as
// ground truth context for projected-delta reasoning.
//
// Body: {
//   indicator_name: string,             ← required, must match a
//                                          string in causal_chain.indicators[]
//   baseline_value?: string,
//   target_value?: string,
//   unit?: string,
//   measurement_method?: string,
//   source?: "user" | "llm",            ← defaults to "user"
// }
//
// Idempotent — repeat calls overwrite the prior baseline for the
// same indicator_name. The decision log gets one row per call
// (audit trail of every baseline update).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ entityId: string }>;
}

interface Body {
  indicator_name?: string;
  baseline_value?: string;
  target_value?: string;
  unit?: string;
  measurement_method?: string;
  source?: "user" | "llm";
}

/** Shape persisted under causal_chain.indicator_baselines[name]. */
interface IndicatorBaselineRecord {
  baseline_value?: string;
  target_value?: string;
  unit?: string;
  measurement_method?: string;
  source: "user" | "llm";
  updated_at: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { entityId } = await ctx.params;
  if (!entityId) {
    return NextResponse.json(
      { error: "entityId required" },
      { status: 400 },
    );
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const indicatorName =
    typeof body?.indicator_name === "string"
      ? body.indicator_name.trim()
      : "";
  if (!indicatorName) {
    return NextResponse.json(
      { error: "indicator_name required" },
      { status: 400 },
    );
  }

  // Trim + cap user-entered strings defensively. The Lab page renders
  // these inline, so unbounded text would blow up the layout. Same
  // 240-char cap pattern as the rest of the canvas writes.
  const baseline_value =
    typeof body?.baseline_value === "string"
      ? body.baseline_value.trim().slice(0, 240)
      : undefined;
  const target_value =
    typeof body?.target_value === "string"
      ? body.target_value.trim().slice(0, 240)
      : undefined;
  const unit =
    typeof body?.unit === "string"
      ? body.unit.trim().slice(0, 80)
      : undefined;
  const measurement_method =
    typeof body?.measurement_method === "string"
      ? body.measurement_method.trim().slice(0, 240)
      : undefined;
  const source: "user" | "llm" = body?.source === "llm" ? "llm" : "user";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load entity + ownership + verify entity is an outcome ──
  // Baselines only make sense on outcomes (the things being measured).
  // Reject baseline POSTs to pain or feature entities loud — silently
  // accepting them would corrupt the indicator_baselines bag with
  // entries that no scorer ever reads.
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  if (entity.entity_type !== "outcome") {
    return NextResponse.json(
      {
        error:
          "baselines apply to outcome entities only (got entity_type=" +
          entity.entity_type +
          ")",
      },
      { status: 400 },
    );
  }

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Verify the indicator_name actually exists on this outcome ──
  // Prevents typos from silently creating orphan baseline records.
  // Indicators live as strings in causal_chain.indicators[]; we
  // tolerate either string array or array of {name} (forward compat).
  const causalChain =
    (entity.causal_chain as Record<string, unknown>) ?? {};
  const indicatorsRaw = causalChain.indicators;
  const indicatorNames: string[] = Array.isArray(indicatorsRaw)
    ? (indicatorsRaw as unknown[])
        .map((i) => {
          if (typeof i === "string") return i;
          if (
            typeof i === "object" &&
            i !== null &&
            typeof (i as { name?: unknown }).name === "string"
          )
            return (i as { name: string }).name;
          return null;
        })
        .filter((s): s is string => s !== null)
    : [];
  if (indicatorNames.length === 0) {
    return NextResponse.json(
      {
        error:
          "outcome has no indicators[] — cannot set a baseline on a non-existent proxy",
      },
      { status: 409 },
    );
  }
  // Case-insensitive match — LLM occasionally normalizes capitalization
  // between gen runs; we don't want users penalized for picking the
  // wrong case in the editor's dropdown.
  const matchIdx = indicatorNames.findIndex(
    (n) => n.toLowerCase() === indicatorName.toLowerCase(),
  );
  if (matchIdx < 0) {
    return NextResponse.json(
      {
        error: `indicator "${indicatorName}" not found on this outcome`,
        available_indicators: indicatorNames,
      },
      { status: 404 },
    );
  }
  // Use the canonical-cased name from the indicator list as the storage key.
  // This means "Sustained attention" and "sustained attention" both
  // resolve to whichever was generated, so future reads are stable.
  const canonicalIndicatorName = indicatorNames[matchIdx];

  // ── Build the next indicator_baselines map ──
  const existingBaselines =
    (causalChain.indicator_baselines as Record<
      string,
      IndicatorBaselineRecord
    > | null) ?? {};
  const now = new Date().toISOString();
  const nextRecord: IndicatorBaselineRecord = {
    source,
    updated_at: now,
    ...(baseline_value !== undefined && { baseline_value }),
    ...(target_value !== undefined && { target_value }),
    ...(unit !== undefined && { unit }),
    ...(measurement_method !== undefined && { measurement_method }),
  };
  const nextBaselines: Record<string, IndicatorBaselineRecord> = {
    ...existingBaselines,
    [canonicalIndicatorName]: nextRecord,
  };

  const nextCausalChain: Record<string, unknown> = {
    ...causalChain,
    indicator_baselines: nextBaselines,
  };

  const { error: updateErr } = await db
    .from("entities")
    .update({ causal_chain: nextCausalChain })
    .eq("id", entityId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  // ── Log baseline_set decision for the Lab Notebook timeline ──
  // The chat agent can later reference: "you set the GAD-2 baseline
  // to 8/10 on Tuesday — projected delta with this stack is -3.5
  // over 4 weeks, would you like to revisit?"
  void logDecision(db, {
    userId: auth.user.id,
    spaceId: entity.space_id,
    subObjectiveId:
      typeof entity.parent_sub_objective_id === "string"
        ? entity.parent_sub_objective_id
        : null,
    proposalId: entityId,
    action: "baseline_set",
    metadata: {
      entity_type: "outcome",
      entity_id: entityId,
      entity_name: entity.name,
      indicator_name: canonicalIndicatorName,
      baseline_value: baseline_value ?? null,
      target_value: target_value ?? null,
      baseline_unit: unit ?? null,
      measurement_method: measurement_method ?? null,
      baseline_source: source,
    },
  });

  return NextResponse.json({
    indicator_name: canonicalIndicatorName,
    record: nextRecord,
  });
}
