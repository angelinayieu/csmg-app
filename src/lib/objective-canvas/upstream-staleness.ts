// ── Upstream staleness check ───────────────────────────────────────
//
// Companion to the lazy upstream-read in /api/brainstorm/item/expand.
// Upstream-read makes downstream depth ALL UPSTREAM-AWARE on next
// regenerate; this module tells the UI when "next regenerate" is
// overdue — i.e., when upstream has mutated since the downstream's
// cached expanded_detail was generated.
//
// A downstream item is STALE when ANY upstream item has a more
// recent timestamp on any of these signals:
//
//   1. expanded_detail.generated_at   (upstream re-expanded)
//   2. max(expansion_tree[].generated_at)  (new expansion node spawned)
//   3. sub_objective_decisions.created_at where metadata.entity_id =
//      upstream.id  (disposition change — election / rejection / etc.)
//
// (1) and (2) are read straight from each upstream entity's row;
// (3) requires one decision_log query scoped to the upstream id set.
// All three are tolerant of missing data (cold-start safety).
//
// Used by /api/brainstorm/item/expand on cache-hit responses to
// emit `upstream_staleness: { is_stale, last_upstream_change_at,
// changes }` alongside the cached detail. The drawer renders a
// "Refresh from upstream" affordance when is_stale=true.

export interface UpstreamChange {
  /** Upstream entity name (for the banner: "X just elected new
   *  variations" reads better than a uuid). */
  source_name: string;
  /** Which signal triggered the staleness: 'expand' (re-expanded),
   *  'spawn' (new expansion node), 'disposition' (election change). */
  kind: "expand" | "spawn" | "disposition";
  /** When the change happened (ISO). */
  changed_at: string;
}

export interface UpstreamStaleness {
  /** True when any upstream change post-dates the downstream's
   *  expanded_detail.generated_at. */
  is_stale: boolean;
  /** Latest upstream change timestamp, or null when nothing newer. */
  last_upstream_change_at: string | null;
  /** Top 3 most-recent changes — drives the banner text
   *  ("Pain X re-expanded · Pain Y elected new variation"). */
  changes: UpstreamChange[];
}

/** No-staleness sentinel — returned by callers when there's no
 *  upstream to check (root entities, items without edges, errors). */
export const NO_STALENESS: UpstreamStaleness = {
  is_stale: false,
  last_upstream_change_at: null,
  changes: [],
};

export interface ComputeStalenessArgs {
  /** Already-authed supabase client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** Downstream entity id (the one we're checking). */
  downstreamEntityId: string;
  /** Downstream sub-objective id — narrows the edges + entities
   *  queries to the room. */
  parentSubObjectiveId: string;
  /** When the downstream's expanded_detail was last (re)generated.
   *  Staleness compares upstream changes against this. */
  downstreamGeneratedAt: string;
}

/** Compute whether upstream items have mutated since the downstream
 *  was last expanded. One edges query → one entities query → one
 *  decision_log query. All three soft-fail to "no staleness" on
 *  missing data. */
export async function computeUpstreamStaleness(
  args: ComputeStalenessArgs,
): Promise<UpstreamStaleness> {
  const { db, downstreamEntityId, parentSubObjectiveId, downstreamGeneratedAt } =
    args;

  try {
    // ── 1. Find upstream entity ids via correlation edges ──
    // Same query the upstream-read uses. We dedupe + bail when there's
    // nothing upstream (root cards, isolated entities).
    const { data: incomingEdges } = await db
      .from("edges")
      .select("source_entity_id")
      .eq("parent_sub_objective_id", parentSubObjectiveId)
      .eq("target_entity_id", downstreamEntityId);
    const sourceIds = Array.isArray(incomingEdges)
      ? Array.from(
          new Set(
            (incomingEdges as Array<{ source_entity_id: string }>).map(
              (e) => e.source_entity_id,
            ),
          ),
        )
      : [];
    if (sourceIds.length === 0) return NO_STALENESS;

    // ── 2. Hydrate upstream entities — pull just the fields we need
    //    for the staleness comparison (no causal_chain etc.). ──
    const { data: upstreamRows } = await db
      .from("entities")
      .select("id, name, expanded_detail")
      .in("id", sourceIds);
    if (!Array.isArray(upstreamRows) || upstreamRows.length === 0) {
      return NO_STALENESS;
    }

    const downstreamGenAtMs = new Date(downstreamGeneratedAt).getTime();
    if (!Number.isFinite(downstreamGenAtMs)) return NO_STALENESS;

    const changes: UpstreamChange[] = [];

    // ── 3. Check (a) expand timestamp + (b) latest expansion node
    //    on every upstream entity. ──
    for (const row of upstreamRows as Array<{
      id: string;
      name: string;
      expanded_detail: {
        generated_at?: string;
        expansion_tree?: Array<{ generated_at?: string }>;
      } | null;
    }>) {
      const ed = row.expanded_detail ?? null;
      if (!ed) continue;
      // (a) Upstream's expand timestamp.
      if (typeof ed.generated_at === "string") {
        const upstreamGen = new Date(ed.generated_at).getTime();
        if (Number.isFinite(upstreamGen) && upstreamGen > downstreamGenAtMs) {
          changes.push({
            source_name: row.name,
            kind: "expand",
            changed_at: ed.generated_at,
          });
        }
      }
      // (b) Latest expansion-tree node on upstream.
      if (Array.isArray(ed.expansion_tree)) {
        let latestSpawn = 0;
        let latestSpawnIso: string | null = null;
        for (const n of ed.expansion_tree) {
          if (typeof n?.generated_at !== "string") continue;
          const t = new Date(n.generated_at).getTime();
          if (Number.isFinite(t) && t > latestSpawn) {
            latestSpawn = t;
            latestSpawnIso = n.generated_at;
          }
        }
        if (latestSpawn > downstreamGenAtMs && latestSpawnIso) {
          changes.push({
            source_name: row.name,
            kind: "spawn",
            changed_at: latestSpawnIso,
          });
        }
      }
    }

    // ── 4. Check (c) disposition changes via decision_log. One query
    //    scoped to upstream entity ids. metadata->>entity_id is a
    //    string field we populate from the variation/disposition
    //    route (see Polish-3 wire-up). ──
    const { data: decisionRows } = await db
      .from("sub_objective_decisions")
      .select("metadata, created_at")
      .in("action", ["elect", "reject", "defer", "clear"])
      .eq("metadata->>entity_type", "variation")
      .in(
        "metadata->>entity_id",
        sourceIds,
      )
      .gt("created_at", downstreamGeneratedAt)
      .order("created_at", { ascending: false })
      .limit(20);
    if (Array.isArray(decisionRows)) {
      // Map upstream id → name for friendly banner text.
      const nameById = new Map<string, string>();
      for (const row of upstreamRows as Array<{ id: string; name: string }>) {
        nameById.set(row.id, row.name);
      }
      for (const r of decisionRows as Array<{
        metadata: Record<string, unknown>;
        created_at: string;
      }>) {
        const md = r.metadata ?? {};
        const eid = typeof md.entity_id === "string" ? md.entity_id : null;
        if (!eid) continue;
        const name = nameById.get(eid);
        if (!name) continue;
        changes.push({
          source_name: name,
          kind: "disposition",
          changed_at: r.created_at,
        });
      }
    }

    if (changes.length === 0) return NO_STALENESS;

    // Sort latest-first + dedupe by (source_name + kind) since a
    // single source may have multiple disposition events.
    changes.sort(
      (a, b) =>
        new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime(),
    );
    const seen = new Set<string>();
    const deduped: UpstreamChange[] = [];
    for (const c of changes) {
      const key = `${c.source_name}::${c.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }

    return {
      is_stale: true,
      last_upstream_change_at: deduped[0].changed_at,
      changes: deduped.slice(0, 3),
    };
  } catch (err) {
    // Soft-fail — staleness is a UX nicety, NOT a correctness gate.
    // If anything in this pipe throws, return "not stale" so the
    // drawer renders normally.
    console.warn(
      "[upstream-staleness] computation failed (returning not-stale):",
      err instanceof Error ? err.message : String(err),
    );
    return NO_STALENESS;
  }
}
