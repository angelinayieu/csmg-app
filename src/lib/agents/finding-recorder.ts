/**
 * Wave D L3.2 — recordAgentFinding.
 *
 * Single entry point every agent write-back path calls after it produces
 * something the user might want to review. Keeps finding_kind values
 * consistent across subsystems (researcher, critic, predictor, the
 * prediction-surprise cron, future agents).
 *
 * Side effects:
 *   - Writes agent_findings row.
 *   - For kind='entity_discovered' with a valid ref_id, appends to
 *     agent_runs.entity_ids_discovered if agent_run_id is provided (the
 *     lineage column that sat unused pre-Wave D).
 *   - Trigger on agent_findings bumps profiles.events_since_last_digest
 *     so the Wave C digest cron learns from agent-driven signals too.
 *
 * Soft-fail: every error logs + returns null; the caller's primary
 * mutation is never blocked by a finding-recorder hiccup.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordAgentFindingInput } from "@/types/agent-finding";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export async function recordAgentFinding(
  db: AnyDb,
  input: RecordAgentFindingInput,
): Promise<string | null> {
  if (!input.user_id || !input.finding_kind || !input.summary) {
    console.warn("[finding-recorder] missing required fields:", input);
    return null;
  }

  const severity =
    input.severity ?? inferSeverity(input.finding_kind);

  try {
    const { data, error } = await db
      .from("agent_findings")
      .insert({
        user_id: input.user_id,
        agent_id: input.agent_id ?? null,
        agent_run_id: input.agent_run_id ?? null,
        space_id: input.space_id ?? null,
        finding_kind: input.finding_kind,
        ref_kind: input.ref_kind ?? null,
        ref_id: input.ref_id ?? null,
        summary: input.summary.slice(0, 2000),
        rationale: input.rationale?.slice(0, 5000) ?? null,
        confidence: clamp01(input.confidence ?? 0.7),
        severity,
        payload: input.payload ?? {},
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[finding-recorder] insert failed:", error);
      return null;
    }

    // Tier-6 lineage: append discovered entity to agent_runs row so the
    // lab / dashboard can trace "what did this run produce?"
    if (
      input.agent_run_id &&
      input.finding_kind === "entity_discovered" &&
      input.ref_id
    ) {
      try {
        await db.rpc("array_append_entity_discovered", {
          p_agent_run_id: input.agent_run_id,
          p_entity_id: input.ref_id,
        });
      } catch {
        // RPC may not exist; fall back to read-modify-write.
        const { data: runRow } = await db
          .from("agent_runs")
          .select("entity_ids_discovered")
          .eq("id", input.agent_run_id)
          .maybeSingle();
        const current = ((runRow?.entity_ids_discovered as string[]) ?? []).filter(
          (v) => typeof v === "string",
        );
        if (!current.includes(input.ref_id)) {
          await db
            .from("agent_runs")
            .update({
              entity_ids_discovered: [...current, input.ref_id],
            })
            .eq("id", input.agent_run_id);
        }
      }
    }

    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[finding-recorder] threw:", err);
    return null;
  }
}

function inferSeverity(
  kind: RecordAgentFindingInput["finding_kind"],
): "info" | "notable" | "urgent" {
  switch (kind) {
    case "prediction_surprise":
    case "risk_flagged":
      return "urgent";
    case "contradiction_found":
    case "objective_proposed":
      return "notable";
    default:
      return "info";
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
