// POST /api/pipeline/cross-space-linker
//
// Phase 2E · PR 4 — runs AFTER all per-axis generators for a given
// pipeline run have settled. Looks at every `space_entity_added`
// event emitted during this run, groups entities by normalized
// name across axes, and emits one `cross_space_link` event per
// group that spans 2+ axes. Then emits `space_merge_begin` +
// `space_merge_complete` so the rail can play the convergence
// animation and the main canvas knows merge is done.
//
// v1 scope: lexical matching only. Normalized-name Levenshtein
// ≤0.15 (matches the Pass 1 spec in DESIGN-merge-resolver-dedup.md).
// Pass 2 (embedding cosine with user-confirm band) is deferred;
// marked as a TODO in the design doc. Lexical alone catches most
// obvious duplicates ("customer retention" ≈ "customer retention
// rate") without any API cost.
//
// What this endpoint DOES (v2, Phase 2H companion):
//   - Persists cross-space leverage entities into the `entities`
//     table so the main canvas paints and downstream stages
//     (strategy-refresh, analog retrieval, learning-measure) have
//     real rows to reason about. Each multi-axis group becomes ONE
//     canonical row tagged as cross-axis leverage, with
//     is_leverage_point = true and importance ranked by axis count.
//     A normalized-name dedup against decompose's already-inserted
//     entities means the two paths don't double-write.
//   - Emits entity_added events for each persisted row so the
//     ghost painter paints them on the main canvas.
//
// What this endpoint still DOESN'T do:
//   - Does not write solo (single-axis) entities. Those stay
//     transient; only the cross-axis leverage set is worth the
//     row. If decompose generates the same concept, its version
//     wins (this endpoint dedups against existing rows).
//   - Does not compute graph-centrality leverage. Leverage score
//     here is simply `|axes|` (how many lenses saw this entity).
//     Centrality-weighted leverage comes with the entity-promotion
//     step.
//   - Does not insert edges. Cross-axis edge promotion is a future
//     pass — today we just persist the node-level leverage set.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  emitBatchEvents,
  emitStructuralEvent,
} from "@/lib/events/structural-event-bus";
import { readAxesUsedFromProvenance } from "@/lib/pipeline/axes-used-resolver";
import type {
  CrossSpaceLinkEvent,
  ProbabilitySpaceAxis,
  SpaceEntityAddedEvent,
  StructuralEvent,
} from "@/types/pipeline-events";

export const maxDuration = 30;
export const runtime = "nodejs";

interface LinkerRequest {
  runId: string;
}

/**
 * Normalize a name for lexical matching. Lowercase + trim + collapse
 * whitespace + strip punctuation. Matches the Pass 1 dedup logic in
 * DESIGN-merge-resolver-dedup.md. Keeps multi-word phrases intact —
 * "customer retention" and "Customer Retention!" collapse to the
 * same key; "user churn" and "customer retention" do not (Pass 2
 * embedding cosine would catch them when it lands).
 */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Levenshtein-normalized similarity for two already-normalized
 * strings. Returns 1.0 for identical, 0.0 for completely different.
 * Cheap single-row DP — fine for pairwise comparison on ≤100
 * candidates.
 */
function levenshteinSim(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const m = a.length;
  const n = b.length;
  // eslint-disable-next-line prefer-const
  let prev: number[] = new Array(n + 1);
  let curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  const distance = prev[n];
  const maxLen = Math.max(m, n);
  return 1 - distance / maxLen;
}

interface AxisEntityRow {
  spaceKey: string;
  axis: ProbabilitySpaceAxis;
  entityId: string;
  name: string;
  normalized: string;
}

interface LinkGroup {
  /** Canonical representative id — the first occurrence by sequence. */
  canonicalId: string;
  /** Canonical display name — first occurrence's name. */
  canonicalName: string;
  /** All entityIds in this group across axes. */
  members: AxisEntityRow[];
  /** Unique axes this group spans. 2+ means cross-space leverage. */
  axes: Set<ProbabilitySpaceAxis>;
}

function axisFromSpaceKey(spaceKey: string): ProbabilitySpaceAxis | null {
  // spaceKey shape: `${runId}:${axis}`
  const parts = spaceKey.split(":");
  if (parts.length < 2) return null;
  const axis = parts[parts.length - 1] as ProbabilitySpaceAxis;
  return axis;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  void user; // RLS enforces ownership on reads + writes

  const { data: body, error: parseError } =
    await safeJsonParse<LinkerRequest>(request);
  if (parseError) return parseError;

  const { runId } = body;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load all space_entity_added events for this run ────────────
  //
  // Ordered by sequence so canonicalId picks the earliest occurrence
  // deterministically (matters for idempotency if linker is re-run).
  const { data: eventRows, error: eventsErr } = await db
    .from("pipeline_run_events")
    .select("sequence, event_type, payload")
    .eq("run_id", runId)
    .eq("event_type", "space_entity_added")
    .order("sequence", { ascending: true });

  if (eventsErr) {
    console.warn("[cross-space-linker] event read failed:", eventsErr);
    return NextResponse.json(
      { error: "failed to read events" },
      { status: 500 },
    );
  }

  const entities: AxisEntityRow[] = [];
  for (const row of (eventRows ?? []) as Array<{
    sequence: number;
    event_type: string;
    payload: unknown;
  }>) {
    if (row.event_type !== "space_entity_added") continue;
    const p = row.payload as Partial<SpaceEntityAddedEvent>;
    if (
      typeof p.spaceKey !== "string" ||
      typeof p.entityId !== "string" ||
      typeof p.name !== "string"
    )
      continue;
    const axis = axisFromSpaceKey(p.spaceKey);
    if (!axis) continue;
    entities.push({
      spaceKey: p.spaceKey,
      axis,
      entityId: p.entityId,
      name: p.name,
      normalized: normalizeName(p.name),
    });
  }

  // ── Build groups via union-find by name similarity ────────────
  //
  // Pass 1 from the design doc: two entities merge into the same
  // group when normalizeName matches exactly OR when Levenshtein-
  // similarity >= 0.85. 0.85 corresponds to ≤15% character
  // difference — catches typos + trivial morphology ("customer
  // retention" ≈ "customer retention rate") without collapsing
  // genuinely distinct entities.
  //
  // Implementation: naive O(n²) pairwise — fine for n ≤ ~200 total
  // entities across axes. Optimize with blocking if n grows.
  const LEX_SIM_THRESHOLD = 0.85;
  const groups: LinkGroup[] = [];

  for (const entity of entities) {
    let placed = false;
    for (const group of groups) {
      // Match against group's canonical normalized name.
      const canonicalNormalized = normalizeName(group.canonicalName);
      const sim = levenshteinSim(entity.normalized, canonicalNormalized);
      if (sim >= LEX_SIM_THRESHOLD) {
        group.members.push(entity);
        group.axes.add(entity.axis);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({
        canonicalId: entity.entityId,
        canonicalName: entity.name,
        members: [entity],
        axes: new Set([entity.axis]),
      });
    }
  }

  // ── Emit cross_space_link events for multi-axis groups ────────
  //
  // Single-axis groups (only one shell saw this entity) don't
  // emit — they're not leverage signals. Multi-axis groups are
  // the high-signal "this entity shows up across lenses" markers.
  const crossSpaceGroups = groups.filter((g) => g.axes.size >= 2);
  const linkEvents: StructuralEvent[] = crossSpaceGroups.map((g) => {
    const event: CrossSpaceLinkEvent = {
      type: "cross_space_link",
      entityId: g.canonicalId,
      name: g.canonicalName,
      axes: Array.from(g.axes),
    };
    return event;
  });

  if (linkEvents.length > 0) {
    await emitBatchEvents(db, runId, linkEvents);
  }

  // ── Persist cross-space leverage entities into the KG ──
  //
  // This is the bridge from the probability-space visual layer into
  // the real entities table. Until now the merge was cosmetic — shells
  // opened, filled, animated, then dissolved without leaving a row
  // the downstream pipeline could reason about. Now every multi-axis
  // leverage entity lands as a real row and the main canvas paints.
  //
  // Dedup: if decompose (running in parallel) has already inserted an
  // entity with a matching normalized name in this space, we skip —
  // decompose's version carries richer description/category metadata,
  // and silently double-writing would corrupt downstream counts.
  const { data: runRow } = await db
    .from("pipeline_runs")
    .select("space_id")
    .eq("id", runId)
    .single();
  const spaceId =
    (runRow as { space_id?: string } | null)?.space_id ?? null;

  // Pre-fetch existing entities once — used for both dedup (skip
  // inserting leverage rows that decompose already wrote) AND for the
  // axis_used backfill below. A single read saves a round-trip when
  // there are groups to persist; even when there aren't, the backfill
  // needs the same data.
  const existingByNormName = new Map<
    string,
    { id: string; provenance: Record<string, unknown> | null }
  >();
  if (spaceId) {
    const { data: existingRows } = await db
      .from("entities")
      .select("id, name, provenance")
      .eq("space_id", spaceId);
    const rows = (existingRows ?? []) as Array<{
      id: string;
      name: string;
      provenance: Record<string, unknown> | null;
    }>;
    for (const r of rows) {
      existingByNormName.set(normalizeName(r.name), {
        id: r.id,
        provenance: r.provenance,
      });
    }
  }

  let persistedCount = 0;
  if (spaceId && crossSpaceGroups.length > 0) {
    const existingNormalized = new Set<string>(existingByNormName.keys());

    const toInsert: Array<Record<string, unknown>> = [];
    const groupForRow: LinkGroup[] = [];
    for (const g of crossSpaceGroups) {
      const norm = normalizeName(g.canonicalName);
      if (existingNormalized.has(norm)) continue;
      existingNormalized.add(norm);

      // Importance from axis count — 3+ axes = fundamental leverage;
      // 2 axes = critical. Below 2 never reaches this loop (filtered
      // above).
      const importance =
        g.axes.size >= 3 ? "fundamental" : "critical";

      // Short entity_id from the canonical UUID prefix so decompose's
      // semantic codes (C1, X2) and ours don't collide.
      const shortCode = `CSL${g.canonicalId.slice(0, 6)}`;

      toInsert.push({
        space_id: spaceId,
        entity_id: shortCode,
        name: g.canonicalName,
        description: `Cross-axis leverage — appears in ${g.axes.size} lenses: ${Array.from(g.axes).join(", ")}.`,
        source_tag: "implicit",
        entity_type: "cross_axis_concept",
        entity_category: "abstract",
        importance,
        is_leverage_point: true,
        is_risk_point: false,
        is_master_bottleneck: false,
        knowledge_layer: "internal",
        authority_level: "moderate",
        provenance: {
          producer: "cross-space-linker",
          run_id: runId,
          // Canonical key is `axes_used` (matches the downstream
          // resolver naming). Legacy `axes` key is still accepted by
          // readEntityAxesUsed() for rows written before this change.
          axes_used: Array.from(g.axes),
          axis_count: g.axes.size,
        },
      });
      groupForRow.push(g);
    }

    if (toInsert.length > 0) {
      const { data: inserted, error: insertErr } = await db
        .from("entities")
        .insert(toInsert)
        .select("id, entity_id, name");
      if (insertErr) {
        console.warn(
          "[cross-space-linker] leverage entity insert soft-fail:",
          insertErr.message,
        );
      } else {
        const insertedRows = (inserted ?? []) as Array<{
          id: string;
          entity_id: string;
          name: string;
        }>;
        persistedCount = insertedRows.length;
        const entityEvents: StructuralEvent[] = insertedRows.map((r) => {
          const axisCount =
            groupForRow.find((g) => g.canonicalName === r.name)?.axes.size ?? 2;
          return {
            type: "entity_added",
            entityId: r.id,
            entityCode: r.entity_id,
            name: r.name,
            entityCategory: "abstract",
            importance: axisCount >= 3 ? "fundamental" : "critical",
            parentEntityId: null,
          };
        });
        await emitBatchEvents(db, runId, entityEvents);
      }
    }
  }

  // ── Backfill provenance.axes_used on existing entities ──────────
  //
  // Every group (single- AND multi-axis) is a cross-axis provenance
  // signal for the matching existing entity row. Prior to this step
  // only multi-axis leverage entities inserted BY this linker had
  // any axis attribution on the row; decompose entities (the bulk of
  // the KG) were untagged, forcing downstream consumers to re-query
  // pipeline_run_events via axes-used-resolver. Now every entity the
  // linker can reach by normalized name gets the axes it was spotted
  // in stored on provenance.axes_used, enabling row-level cross-axis
  // queries (e.g. "find entities appearing in ≥2 axes" via JSONB
  // containment) without event scans.
  //
  // Idempotent: the update union-merges with any existing axes_used,
  // so repeated linker runs never shrink provenance. Old-key rows
  // (provenance.axes) are migrated in place to the canonical key.
  //
  // Soft-fail: individual UPDATE errors are logged but don't abort
  // the linker's terminal events (merge_begin / merge_complete).
  let backfilledCount = 0;
  if (spaceId && groups.length > 0 && existingByNormName.size > 0) {
    const updates: Array<{
      id: string;
      provenance: Record<string, unknown>;
    }> = [];
    for (const g of groups) {
      const existing = existingByNormName.get(normalizeName(g.canonicalName));
      if (!existing) continue; // decompose hasn't inserted this one yet
      const prev = existing.provenance ?? {};
      const prevAxes = readAxesUsedFromProvenance(prev);
      const merged = new Set<ProbabilitySpaceAxis>(prevAxes);
      for (const a of g.axes) merged.add(a);
      // No-op skip: already captures this axis set.
      if (merged.size === prevAxes.length && prevAxes.every((a) => merged.has(a))) {
        continue;
      }
      // Drop the legacy `axes` key if present so we don't leave two
      // parallel arrays on the row. The reader already tolerates it
      // being absent.
      const { axes: _legacy, ...rest } = prev as Record<string, unknown> & {
        axes?: unknown;
      };
      void _legacy;
      updates.push({
        id: existing.id,
        provenance: {
          ...rest,
          axes_used: Array.from(merged).sort(),
          axis_count: merged.size,
        },
      });
    }
    if (updates.length > 0) {
      // Supabase has no native bulk-update; parallel updates keep
      // the hot path short. Cap concurrency to avoid hammering the
      // row-level lock path when there are many.
      const CONCURRENCY = 8;
      for (let i = 0; i < updates.length; i += CONCURRENCY) {
        const chunk = updates.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (u) => {
            const { error } = await db
              .from("entities")
              .update({ provenance: u.provenance })
              .eq("id", u.id);
            if (error) {
              console.warn(
                "[cross-space-linker] provenance backfill soft-fail:",
                error.message,
              );
            } else {
              backfilledCount += 1;
            }
          }),
        );
      }
    }
  }

  // ── Load all opened shells for this run ──
  //
  // The merge_begin event carries spaceKeys so the rail knows which
  // shells to animate. Read from probability_space_runs rather than
  // reconstructing from events so we don't miss shells that opened
  // but never emitted a space_entity_added (thin axes that failed
  // validation, for example).
  const { data: shellRows } = await db
    .from("probability_space_runs")
    .select("axis")
    .eq("run_id", runId);
  const allSpaceKeys = ((shellRows ?? []) as Array<{ axis: string }>).map(
    (r) => `${runId}:${r.axis}`,
  );

  // Merge begin — rail starts its convergence animation.
  await emitStructuralEvent(db, runId, {
    type: "space_merge_begin",
    spaceKeys: allSpaceKeys,
  });

  // ── Compute leverage counts + emit merge_complete ──
  const soloEntityCount = groups.filter((g) => g.axes.size === 1).length;
  const leverageEntityCount = crossSpaceGroups.length;

  await emitStructuralEvent(db, runId, {
    type: "space_merge_complete",
    soloEntityCount,
    leverageEntityCount,
  });

  // ── Mark each probability_space_run row as "merged" ──
  // (Generators that succeeded already did this; re-applying is a
  // no-op. Failed/thin generators keep their failed status.)
  await db
    .from("probability_space_runs")
    .update({
      entities_merged: leverageEntityCount,
    })
    .eq("run_id", runId)
    .neq("status", "failed");

  return NextResponse.json({
    runId,
    totalCandidateEntities: entities.length,
    distinctGroups: groups.length,
    crossSpaceGroups: crossSpaceGroups.length,
    soloEntityCount,
    leverageEntityCount,
    persistedLeverageEntities: persistedCount,
    backfilledProvenanceRows: backfilledCount,
  });
}
