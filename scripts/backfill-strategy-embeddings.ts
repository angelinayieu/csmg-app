/**
 * One-shot backfill: embed every published, matchable synergy_strategy
 * that doesn't yet have an embedding column populated. Optionally also
 * fires the parallel-path matcher for each via Inngest.
 *
 * Usage:
 *   npx tsx scripts/backfill-strategy-embeddings.ts             # embed only
 *   npx tsx scripts/backfill-strategy-embeddings.ts --match     # embed + queue matcher
 *   npx tsx scripts/backfill-strategy-embeddings.ts --limit=20  # only do N
 *
 * The --match flag fires the same Inngest event the strategy-generate
 * route fires ("synergy/strategy.generated"). This lets us amortize
 * the matcher's LLM cost over Inngest's step-checkpointed retries
 * instead of paying it inline here. For a fresh deploy with a large
 * backlog, run with --match the morning after deploy so Inngest spreads
 * the load.
 *
 * Safe to re-run: embedStrategy short-circuits on already-embedded
 * rows (because the matcher cron path tolerates idempotency). For
 * forced re-embed, manually set last_embedded_at = null in the DB.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { embedStrategy } from "@/lib/synergy/strategy-embed";
import { inngest } from "@/inngest/client";

interface StrategyRow {
  id: string;
  session_id: string;
  statement: string | null;
  embedding: number[] | null;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldMatch = args.includes("--match");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg
    ? Math.max(1, parseInt(limitArg.split("=")[1], 10))
    : null;

  console.log("[backfill] mode:", shouldMatch ? "embed + match" : "embed only");
  if (limit) console.log("[backfill] limit:", limit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // Find all published + matchable strategies that have no embedding.
  let query = db
    .from("synergy_strategies")
    .select("id, session_id, statement, embedding")
    .eq("matchable", true)
    .eq("status", "published")
    .is("embedding", null);
  if (limit) query = query.limit(limit);

  const { data: rows, error } = await query;
  if (error) {
    console.error("[backfill] query failed:", error);
    process.exit(1);
  }
  const targets = (rows ?? []) as StrategyRow[];
  console.log(`[backfill] ${targets.length} strategies to embed`);

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of targets) {
    try {
      const result = await embedStrategy(db, row.id);
      if (result.embedded) {
        embedded += 1;
        process.stdout.write("✓");
      } else {
        skipped += 1;
        process.stdout.write(".");
      }

      // Fire the matcher event if requested. We do this AFTER the
      // embed so the matcher's loadStrategySource() will see the new
      // vector. Inngest dedupes by event payload + step name, so
      // re-running this is safe.
      if (result.embedded && shouldMatch) {
        // Owner lookup for the event payload — we need userId.
        const { data: sess } = await db
          .from("brainstorm_sessions")
          .select("owner_id")
          .eq("id", row.session_id)
          .maybeSingle();
        if (sess?.owner_id) {
          await inngest.send({
            name: "synergy/strategy.generated",
            data: {
              strategyId: row.id,
              sessionId: row.session_id,
              userId: sess.owner_id,
            },
          });
        }
      }
    } catch (err) {
      failed += 1;
      process.stdout.write("✗");
      console.error(`\n[backfill] ${row.id} failed:`, (err as Error).message);
    }
  }

  console.log("\n");
  console.log("[backfill] done.");
  console.log(`  embedded:    ${embedded}`);
  console.log(`  skipped:     ${skipped}`);
  console.log(`  failed:      ${failed}`);
  if (shouldMatch) {
    console.log(
      `  matcher events queued for ${embedded} newly-embedded strategies`,
    );
  }
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
