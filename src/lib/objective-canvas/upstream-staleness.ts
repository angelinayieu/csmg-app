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
   *  variations" reads better than a uuid). For local-staleness
   *  rows, this is the LOCAL item's name. */
  source_name: string;
  /** Which signal triggered the staleness:
   *    'expand'           — upstream item re-expanded
   *    'spawn'            — upstream item added an expansion node
   *    'disposition'      — upstream election changed (elect/reject/...)
   *    'local_variations' — variations on THIS item were re-expanded
   *                         since this artifact was generated
   *                         (used by composition / brief staleness)
   *    'local_composition' — composed_design on THIS item was
   *                          regenerated since this brief was made
   *                          (only used by brief staleness) */
  kind:
    | "expand"
    | "spawn"
    | "disposition"
    | "local_variations"
    | "local_composition";
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

// ── Composition staleness ──────────────────────────────────────────
//
// A composed_design is stale when:
//   (LOCAL)     the item's expanded_detail.generated_at is newer
//               than composed_design.generated_at — i.e., the
//               variations the composition synthesizes were
//               re-expanded after the composition was generated.
//   (UPSTREAM)  any of the three upstream signals fires against
//               composed_design.generated_at (same logic as
//               computeUpstreamStaleness, just with a different
//               reference timestamp).
//
// Returns the same UpstreamStaleness shape so the drawer can reuse
// the existing banner component (only the kindVerb mapping needs to
// know about the new local_* kinds).

export interface CompositionStalenessArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** The item the composition lives on. */
  downstreamEntityId: string;
  /** This item's name — used for local-change source_name. */
  downstreamEntityName: string;
  /** The item's sub-objective for the edges query. */
  parentSubObjectiveId: string;
  /** When the composed_design was generated. */
  compositionGeneratedAt: string;
  /** When the parent expanded_detail was last generated. Optional;
   *  when present and newer than compositionGeneratedAt, emits a
   *  LOCAL "variations_regenerated" change. */
  expandedDetailGeneratedAt?: string | null;
}

export async function computeCompositionStaleness(
  args: CompositionStalenessArgs,
): Promise<UpstreamStaleness> {
  try {
    const upstream = await computeUpstreamStaleness({
      db: args.db,
      downstreamEntityId: args.downstreamEntityId,
      parentSubObjectiveId: args.parentSubObjectiveId,
      downstreamGeneratedAt: args.compositionGeneratedAt,
    });

    // Add the LOCAL "variations re-expanded after composition" signal.
    const localChanges: UpstreamChange[] = [];
    if (args.expandedDetailGeneratedAt) {
      const compTs = new Date(args.compositionGeneratedAt).getTime();
      const expTs = new Date(args.expandedDetailGeneratedAt).getTime();
      if (
        Number.isFinite(compTs) &&
        Number.isFinite(expTs) &&
        expTs > compTs
      ) {
        localChanges.push({
          source_name: args.downstreamEntityName,
          kind: "local_variations",
          changed_at: args.expandedDetailGeneratedAt,
        });
      }
    }

    if (!upstream.is_stale && localChanges.length === 0) {
      return NO_STALENESS;
    }

    const merged: UpstreamChange[] = [...localChanges, ...upstream.changes];
    merged.sort(
      (a, b) =>
        new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime(),
    );
    return {
      is_stale: true,
      last_upstream_change_at: merged[0].changed_at,
      changes: merged.slice(0, 3),
    };
  } catch (err) {
    console.warn(
      "[composition-staleness] computation failed (returning not-stale):",
      err instanceof Error ? err.message : String(err),
    );
    return NO_STALENESS;
  }
}

// ── Brief staleness ───────────────────────────────────────────────
//
// A prototype brief is stale when:
//   (LOCAL)    the item's expanded_detail.generated_at is newer than
//              brief.generated_at — variations re-expanded since.
//   (LOCAL)    composed_design.generated_at is newer than
//              brief.generated_at — composition regenerated since
//              (the brief reads composed_design.conflicts_open and
//               that signal is now stale).
//   (UPSTREAM) any of the three upstream signals fires against
//              brief.generated_at.

export interface BriefStalenessArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  downstreamEntityId: string;
  downstreamEntityName: string;
  parentSubObjectiveId: string;
  briefGeneratedAt: string;
  expandedDetailGeneratedAt?: string | null;
  composedDesignGeneratedAt?: string | null;
}

export async function computeBriefStaleness(
  args: BriefStalenessArgs,
): Promise<UpstreamStaleness> {
  try {
    const upstream = await computeUpstreamStaleness({
      db: args.db,
      downstreamEntityId: args.downstreamEntityId,
      parentSubObjectiveId: args.parentSubObjectiveId,
      downstreamGeneratedAt: args.briefGeneratedAt,
    });

    const briefTs = new Date(args.briefGeneratedAt).getTime();
    if (!Number.isFinite(briefTs)) return upstream;

    const localChanges: UpstreamChange[] = [];
    if (args.expandedDetailGeneratedAt) {
      const expTs = new Date(args.expandedDetailGeneratedAt).getTime();
      if (Number.isFinite(expTs) && expTs > briefTs) {
        localChanges.push({
          source_name: args.downstreamEntityName,
          kind: "local_variations",
          changed_at: args.expandedDetailGeneratedAt,
        });
      }
    }
    if (args.composedDesignGeneratedAt) {
      const cdTs = new Date(args.composedDesignGeneratedAt).getTime();
      if (Number.isFinite(cdTs) && cdTs > briefTs) {
        localChanges.push({
          source_name: args.downstreamEntityName,
          kind: "local_composition",
          changed_at: args.composedDesignGeneratedAt,
        });
      }
    }

    if (!upstream.is_stale && localChanges.length === 0) {
      return NO_STALENESS;
    }

    const merged: UpstreamChange[] = [...localChanges, ...upstream.changes];
    merged.sort(
      (a, b) =>
        new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime(),
    );
    return {
      is_stale: true,
      last_upstream_change_at: merged[0].changed_at,
      changes: merged.slice(0, 3),
    };
  } catch (err) {
    console.warn(
      "[brief-staleness] computation failed (returning not-stale):",
      err instanceof Error ? err.message : String(err),
    );
    return NO_STALENESS;
  }
}
