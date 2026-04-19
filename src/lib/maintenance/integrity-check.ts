/**
 * Cross-substrate integrity check — Sprint 5.
 *
 * Walks the universal-canvas substrate and reports dangling references
 * that FK constraints can't catch because the DB uses polymorphic
 * (scope_ref_type, scope_ref_id) pairs.
 *
 * Specifically:
 *   1. canvases.scope_ref_id → exists in the implied table
 *      (spaces / improvement_goals / apps depending on scope_ref_type)
 *   2. memory_items.ref_id → exists in the implied table for that kind
 *      (entity / canvas / bridge / objective / app — but note rows use
 *       a hashed uuid, so they're exempt here)
 *   3. note_entity_spans with entity_id that no longer exists
 *   4. concept_proposals with entity_id or target_canvas_id pointing
 *      at deleted rows
 *
 * The report is per-owner — a scheduled job would iterate all users and
 * aggregate, but for Sprint 5 we expose it as a single-user POST. The
 * report is advisory; it does NOT auto-fix. Auto-remediation is a
 * follow-up once the issue patterns are understood.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface IntegrityIssue {
  table: string;
  id: string;
  problem: string;
  detail?: Record<string, unknown>;
}

export interface IntegrityReport {
  owner_id: string;
  scanned_at: string;
  total_issues: number;
  by_table: Record<string, number>;
  issues: IntegrityIssue[];
}

export async function runIntegrityCheck(
  db: AnyDb,
  ownerId: string,
): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];

  // ── 1. canvases.scope_ref_id dangling ──
  const { data: canvases } = (await db
    .from("canvases")
    .select("id, scope, scope_ref_type, scope_ref_id")
    .eq("owner_id", ownerId)
    .eq("archived", false)
    .not("scope_ref_id", "is", null)) as {
    data: Array<{
      id: string;
      scope: string;
      scope_ref_type: string | null;
      scope_ref_id: string | null;
    }> | null;
  };

  const spaceRefIds: string[] = [];
  const goalRefIds: string[] = [];
  const appRefIds: string[] = [];
  for (const c of canvases ?? []) {
    if (!c.scope_ref_id) continue;
    if (c.scope_ref_type === "space") spaceRefIds.push(c.scope_ref_id);
    if (c.scope_ref_type === "improvement_goal") goalRefIds.push(c.scope_ref_id);
    if (c.scope_ref_type === "app") appRefIds.push(c.scope_ref_id);
  }

  const [knownSpaces, knownGoals, knownApps] = await Promise.all([
    fetchIds(db, "spaces", spaceRefIds),
    fetchIds(db, "improvement_goals", goalRefIds),
    fetchIds(db, "apps", appRefIds),
  ]);

  for (const c of canvases ?? []) {
    if (!c.scope_ref_id) continue;
    const known =
      c.scope_ref_type === "space"
        ? knownSpaces
        : c.scope_ref_type === "improvement_goal"
        ? knownGoals
        : c.scope_ref_type === "app"
        ? knownApps
        : new Set<string>();
    if (!known.has(c.scope_ref_id)) {
      issues.push({
        table: "canvases",
        id: c.id,
        problem: `scope_ref_id references missing ${c.scope_ref_type} (${c.scope_ref_id})`,
        detail: {
          scope: c.scope,
          scope_ref_type: c.scope_ref_type,
          scope_ref_id: c.scope_ref_id,
        },
      });
    }
  }

  // ── 2. memory_items.ref_id dangling (entities / bridges / objectives / apps / canvases) ──
  // Skip 'note' kind because its ref_id is a hashed uuid with no source table.
  const { data: memRows } = (await db
    .from("memory_items")
    .select("id, kind, ref_id")
    .eq("owner_id", ownerId)
    .in("kind", ["entity", "canvas", "bridge", "objective", "app"])) as {
    data: Array<{ id: string; kind: string; ref_id: string }> | null;
  };

  const memByKind = new Map<string, Array<{ id: string; ref_id: string }>>();
  for (const m of memRows ?? []) {
    const arr = memByKind.get(m.kind) ?? [];
    arr.push({ id: m.id, ref_id: m.ref_id });
    memByKind.set(m.kind, arr);
  }
  const kindToTable: Record<string, string> = {
    entity: "entities",
    canvas: "canvases",
    bridge: "bridges",
    objective: "improvement_goals",
    app: "apps",
  };
  for (const [kind, rows] of memByKind.entries()) {
    const table = kindToTable[kind];
    if (!table) continue;
    const ids = rows.map((r) => r.ref_id);
    const known = await fetchIds(db, table, ids);
    for (const r of rows) {
      if (!known.has(r.ref_id)) {
        issues.push({
          table: "memory_items",
          id: r.id,
          problem: `kind=${kind} ref_id points at missing ${table} row`,
          detail: { kind, ref_id: r.ref_id },
        });
      }
    }
  }

  // ── 3. note_entity_spans with dead entity_id ──
  const { data: spans } = (await db
    .from("note_entity_spans")
    .select("id, entity_id, status")
    .eq("owner_id", ownerId)
    .eq("status", "accepted")
    .not("entity_id", "is", null)) as {
    data: Array<{ id: string; entity_id: string | null; status: string }> | null;
  };
  const spanEntityIds = (spans ?? [])
    .map((s) => s.entity_id)
    .filter((x): x is string => !!x);
  const knownSpanEntities = await fetchIds(db, "entities", spanEntityIds);
  for (const s of spans ?? []) {
    if (s.entity_id && !knownSpanEntities.has(s.entity_id)) {
      issues.push({
        table: "note_entity_spans",
        id: s.id,
        problem: "entity_id points at missing entity row",
        detail: { entity_id: s.entity_id },
      });
    }
  }

  // ── 4. concept_proposals with dead entity_id or target_canvas_id ──
  const { data: proposals } = (await db
    .from("concept_proposals")
    .select("id, entity_id, target_canvas_id, status")
    .eq("owner_id", ownerId)
    .eq("status", "pending")) as {
    data: Array<{
      id: string;
      entity_id: string | null;
      target_canvas_id: string | null;
      status: string;
    }> | null;
  };
  const proposalEntityIds = (proposals ?? [])
    .map((p) => p.entity_id)
    .filter((x): x is string => !!x);
  const proposalCanvasIds = (proposals ?? [])
    .map((p) => p.target_canvas_id)
    .filter((x): x is string => !!x);
  const knownProposalEntities = await fetchIds(db, "entities", proposalEntityIds);
  const knownProposalCanvases = await fetchIds(db, "canvases", proposalCanvasIds);
  for (const p of proposals ?? []) {
    if (p.entity_id && !knownProposalEntities.has(p.entity_id)) {
      issues.push({
        table: "concept_proposals",
        id: p.id,
        problem: "entity_id points at missing entity row",
        detail: { entity_id: p.entity_id },
      });
    }
    if (p.target_canvas_id && !knownProposalCanvases.has(p.target_canvas_id)) {
      issues.push({
        table: "concept_proposals",
        id: p.id,
        problem: "target_canvas_id points at missing canvas row",
        detail: { target_canvas_id: p.target_canvas_id },
      });
    }
  }

  // ── Aggregate ──
  const byTable: Record<string, number> = {};
  for (const issue of issues) {
    byTable[issue.table] = (byTable[issue.table] ?? 0) + 1;
  }

  return {
    owner_id: ownerId,
    scanned_at: new Date().toISOString(),
    total_issues: issues.length,
    by_table: byTable,
    issues,
  };
}

async function fetchIds(
  db: AnyDb,
  table: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const unique = Array.from(new Set(ids));
  const { data } = (await db
    .from(table)
    .select("id")
    .in("id", unique)) as { data: Array<{ id: string }> | null };
  return new Set((data ?? []).map((r) => r.id));
}
