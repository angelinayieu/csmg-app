/**
 * Synergy match refresh — Inngest cron
 *
 * Fires every 6 hours. Scans for matchable brainstorm_components
 * whose match suggestions are getting stale (no component_matches
 * row computed in the last 7 days, OR no row at all yet) and runs
 * the matcher pipeline against the cross-user pool.
 *
 * Why a cron, not just on-demand: a user publishes their components
 * once, but the rest of the community keeps adding new ones. Without
 * a refresh, the original user's discover feed stays frozen at
 * publish-time. The cron keeps the pool warm.
 *
 * Coexists with the synchronous /api/synergy/sessions/[id]/components/match
 * endpoint — that's still how users trigger an immediate refresh of
 * their own components. This cron handles ambient freshness.
 *
 * Cron expression: every 6 hours at minute 17 (offset to spread load
 * away from the top-of-hour cluster).
 */

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MAX_MATCHES_PER_COMPONENT,
  matchOneComponent,
  type MatchSourceComponent,
} from "@/lib/synergy/matcher";

// How many components to refresh per tick. Caps the LLM spend per
// run; the next tick picks up the rest. With ~30 candidates per
// component re-rank + batches of 8, this is ~4 LLM calls per
// component — 60 components × 4 = ~240 LLM calls per tick. At
// gpt-4o pricing, well under $1 per tick.
const REFRESH_BATCH = 60;

// "Stale" = last computed_at older than this. Components with no
// match rows at all also qualify (their max(computed_at) is null).
const STALE_AFTER_DAYS = 7;

interface CandidateRow {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
  most_recent_match_at: string | null;
}

interface SessionLite {
  id: string;
  objective_statement: string | null;
}

export const synergyMatchRefresh = inngest.createFunction(
  {
    id: "synergy-match-refresh",
    name: "Synergy · refresh stale matches",
    retries: 1,
    triggers: [{ cron: "17 */6 * * *" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    // Step 1 — gather stale candidates. Pure read. We use a SQL
    // join-and-aggregate to find each matchable component's most
    // recent match computed_at; null sorts oldest by COALESCE.
    const candidates: CandidateRow[] = await step.run(
      "gather-stale-candidates",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = createServiceClient() as any;
        // We do this in two queries because Supabase JS doesn't expose
        // window-function aggregates cleanly. First: pull matchable
        // components with embeddings; second: find their most recent
        // match_computed_at. Filter + sort in JS.
        const { data: components, error: cErr } = await db
          .from("brainstorm_components")
          .select(
            "id, owner_id, session_id, kind, subkind, label_public, description_public",
          )
          .neq("visibility", "private")
          .not("embedding", "is", null);
        if (cErr) throw new Error(cErr.message);

        const ids = (components ?? []).map((c: { id: string }) => c.id);
        if (ids.length === 0) return [];

        const { data: matches } = await db
          .from("component_matches")
          .select("component_a, component_b, computed_at")
          .or(
            `component_a.in.(${ids.join(",")}),component_b.in.(${ids.join(",")})`,
          )
          .order("computed_at", { ascending: false })
          .limit(MAX_MATCHES_PER_COMPONENT * ids.length);

        const lastByComponent = new Map<string, string>();
        for (const m of (matches ?? []) as Array<{
          component_a: string;
          component_b: string;
          computed_at: string;
        }>) {
          if (!lastByComponent.has(m.component_a))
            lastByComponent.set(m.component_a, m.computed_at);
          if (!lastByComponent.has(m.component_b))
            lastByComponent.set(m.component_b, m.computed_at);
        }

        const cutoff =
          Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
        const stale: CandidateRow[] = [];
        for (const c of (components ?? []) as Array<{
          id: string;
          owner_id: string;
          session_id: string;
          kind: string;
          subkind: string | null;
          label_public: string;
          description_public: string;
        }>) {
          const last = lastByComponent.get(c.id) ?? null;
          if (last === null || new Date(last).getTime() < cutoff) {
            stale.push({ ...c, most_recent_match_at: last });
          }
        }
        // Oldest-first: null > then ascending date string. Cap.
        stale.sort((a, b) => {
          if (a.most_recent_match_at === null && b.most_recent_match_at !== null)
            return -1;
          if (b.most_recent_match_at === null && a.most_recent_match_at !== null)
            return 1;
          return (a.most_recent_match_at ?? "").localeCompare(
            b.most_recent_match_at ?? "",
          );
        });
        return stale.slice(0, REFRESH_BATCH);
      },
    );

    if (!candidates || candidates.length === 0) {
      return { refreshed: 0, reason: "no_stale_candidates" };
    }

    // Step 2 — hydrate objective_statement for each candidate's
    // session so the matcher prompt can use it.
    const sessionByOwner: Record<string, SessionLite> = await step.run(
      "hydrate-objectives",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = createServiceClient() as any;
        const sessionIds = Array.from(
          new Set(candidates.map((c) => c.session_id)),
        );
        const { data: sessions } = await db
          .from("brainstorm_sessions")
          .select("id, objective_statement")
          .in("id", sessionIds);
        const map: Record<string, SessionLite> = {};
        for (const s of (sessions ?? []) as SessionLite[]) {
          map[s.id] = s;
        }
        return map;
      },
    );

    // Step 3 — run the matcher on each candidate. Each is its own
    // sub-step so Inngest can retry individually + show progress in
    // the dashboard. Sequential rather than parallel to keep LLM
    // spend predictable.
    let totalPersisted = 0;
    let totalConsidered = 0;
    const failures: string[] = [];

    for (const c of candidates as CandidateRow[]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result: {
          candidates_considered: number;
          matches_persisted: number;
        } = await step.run(`match-${c.id}`, async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db = createServiceClient() as any;
          const source: MatchSourceComponent = {
            id: c.id,
            owner_id: c.owner_id,
            session_id: c.session_id,
            kind: c.kind,
            subkind: c.subkind,
            label_public: c.label_public,
            description_public: c.description_public,
            objective_statement:
              sessionByOwner[c.session_id]?.objective_statement ?? null,
          };
          return await matchOneComponent(db, source);
        });
        totalPersisted += result.matches_persisted;
        totalConsidered += result.candidates_considered;
      } catch (err) {
        failures.push(`${c.id}: ${(err as Error).message}`);
      }
    }

    return {
      refreshed: candidates.length,
      considered: totalConsidered,
      persisted: totalPersisted,
      failures: failures.length > 0 ? failures.slice(0, 10) : undefined,
    };
  },
);
