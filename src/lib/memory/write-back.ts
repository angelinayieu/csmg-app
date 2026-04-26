/**
 * Post-run memory write-back.
 *
 * Called (fire-and-forget via `after()`) by the strategy-refresh terminal
 * stage after a pipeline run completes. Embeds and upserts the space's
 * most important artifacts into `memory_items` so future decompositions
 * and journal entries can retrieve them via semantic search.
 *
 * What gets indexed per space:
 *   - All entities (importance-weighted salience)
 *   - Synthesis summary note: master_bottleneck + top-3 leverage points
 *
 * Soft-fail throughout — a memory write failure must never surface to the
 * user or block the pipeline response.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertMemoryItemsBatch,
  buildEntityInput,
  type MemoryUpsertInput,
} from "./writer";
import type { SynthesisData } from "@/types/synthesis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface WriteSpaceMemoryResult {
  entitiesIndexed: number;
  synthesisSummaryIndexed: boolean;
  errors: string[];
}

/**
 * Index a space's entities + synthesis summary into memory_items.
 *
 * Safe to call multiple times — `upsertMemoryItemsBatch` skips rows
 * whose text is unchanged, so re-indexing after a no-op refresh is cheap.
 */
export async function writeSpaceMemory(
  db: AnyDb,
  spaceId: string,
  ownerId: string,
): Promise<WriteSpaceMemoryResult> {
  const result: WriteSpaceMemoryResult = {
    entitiesIndexed: 0,
    synthesisSummaryIndexed: false,
    errors: [],
  };

  // ── 1. Index entities ─────────────────────────────────────────────
  try {
    const { data: entities, error } = (await db
      .from("entities")
      .select("id, space_id, name, description, importance")
      .eq("space_id", spaceId)) as {
      data: Array<{
        id: string;
        space_id: string;
        name: string;
        description: string | null;
        importance: string | null;
      }> | null;
      error: unknown;
    };

    if (error) throw error;

    const inputs = (entities ?? []).map((e) => buildEntityInput(ownerId, e));
    const res = await upsertMemoryItemsBatch(db, inputs);
    result.entitiesIndexed = res.upserted;
  } catch (err) {
    result.errors.push(`entities: ${String(err)}`);
  }

  // ── 2. Index synthesis summary ────────────────────────────────────
  // Builds a dense text note from the synthesis_data JSON so "what did
  // the AI find important about this space" is retrievable semantically.
  try {
    const { data: spaceRow, error } = (await db
      .from("spaces")
      .select("id, name, synthesis_data")
      .eq("id", spaceId)
      .single()) as {
      data: { id: string; name: string; synthesis_data: SynthesisData | null } | null;
      error: unknown;
    };

    if (error) throw error;
    if (!spaceRow?.synthesis_data) {
      // Synthesis hasn't run yet — nothing to index.
      return result;
    }

    const sd = spaceRow.synthesis_data;
    const parts: string[] = [`Analysis of "${spaceRow.name}".`];

    // Master bottleneck
    if (sd.master_bottleneck?.summary) {
      parts.push(`Core bottleneck: ${sd.master_bottleneck.summary}`);
    }

    // Top 3 leverage points
    const leverages = (sd.leverage_points ?? []).slice(0, 3);
    if (leverages.length > 0) {
      parts.push(
        `Key leverage points: ${leverages.map((l) => l.summary ?? l.entity_id).join("; ")}`,
      );
    }

    // Top 2 risk points
    const risks = (sd.risk_points ?? []).slice(0, 2);
    if (risks.length > 0) {
      parts.push(
        `Key risks: ${risks.map((r) => r.summary ?? r.entity_id).join("; ")}`,
      );
    }

    // Most important feedback loop
    const topLoop = (sd.feedback_loops ?? [])[0];
    if (topLoop?.name) {
      parts.push(`Primary feedback loop: ${topLoop.name}`);
    }

    const summaryText = parts.join(" ");
    if (summaryText.length < 20) return result; // nothing useful to index

    const summaryInput: MemoryUpsertInput = {
      owner_id: ownerId,
      kind: "note",
      // Use the space UUID as ref_id so the unique constraint
      // (kind, ref_id, embedding_version) gives us one synthesis note
      // per space, naturally overwritten on each refresh.
      ref_id: spaceId,
      scope: "project",
      scope_ref_id: spaceId,
      text: summaryText,
      // Synthesis summaries are high-salience — they represent the most
      // important distilled insight from the entire analysis.
      salience: 0.88,
    };

    const res = await upsertMemoryItemsBatch(db, [summaryInput]);
    result.synthesisSummaryIndexed = res.upserted > 0 || res.skipped_unchanged > 0;
  } catch (err) {
    result.errors.push(`synthesis_summary: ${String(err)}`);
  }

  return result;
}
