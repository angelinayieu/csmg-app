// ── POST /api/objective/[spaceId]/derive-features-micros ──────────────
//
// Batch-derive micro-objectives for every Feature + Variable (and
// Mechanism) library_object in the space. Used to PRE-WARM the rubric
// across the board so Deep Synthesize / make_plan / brief / expansion-
// recommendations run instantly on any of these cards — no first-call
// latency penalty.
//
// Concurrency-capped (default 4) so we don't blow the Anthropic rate
// limit. Skips rows with a fresh cached artifact unless `force=true`.
// Returns a per-card summary so the client can show "5/8 derived" in
// the rail. Soft-fails per row — one bad card never blocks the batch.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  deriveMicroObjectives,
  buildMicroObjectivesArtifact,
} from "@/lib/objective-canvas/derive-micro-objectives";
import {
  cacheMicroObjectives,
  getMicroObjectives,
} from "@/lib/objective-canvas/get-micro-objectives";
import { loadOptimizationFactors } from "@/lib/objective-canvas/load-optimization-factors";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  force?: boolean;
  /** Override the default Feature+Variable+Mechanism filter. */
  objectTypes?: string[];
  /** Cap parallel derives. Default 4 keeps us well under rate limits and
   *  still finishes a 20-card board in ~8s. */
  concurrency?: number;
}

const DEFAULT_TYPES = ["feature", "variable", "mechanism"];
const DEFAULT_CONCURRENCY = 4;

interface RowResult {
  libraryObjectId: string;
  title: string;
  objectType: string;
  status: "cached" | "derived" | "failed" | "empty";
  microCount: number;
  reason?: string;
}

/** Tiny p-limit — N workers pull from a shared queue. Avoids a dep. */
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, i: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function pull() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, pull),
  );
  return results;
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    /* empty body is fine — defaults apply */
  }
  const force = !!body.force;
  const types =
    Array.isArray(body.objectTypes) && body.objectTypes.length
      ? body.objectTypes.filter((t) => typeof t === "string" && t.trim())
      : DEFAULT_TYPES;
  const concurrency =
    typeof body.concurrency === "number" && body.concurrency > 0
      ? Math.min(8, Math.floor(body.concurrency))
      : DEFAULT_CONCURRENCY;

  // Load the seed objective + factors once; reused for every derive.
  const [factors, spaceCtx] = await Promise.all([
    loadOptimizationFactors(auth.supabase, spaceId),
    buildSpaceContext(auth.supabase, spaceId),
  ]);
  const objective = (spaceCtx.objective ?? "").trim();
  const factorLite = factors.map((f) => ({
    slug: f.slug,
    label: f.label,
    kind: f.kind,
    why: f.why,
  }));

  // Pull every targeted card in this space. Soft-cap to 200 so a misuse
  // can't fan out a thousand-card derive.
  const { data: rows, error } = await auth.supabase
    .from("library_objects")
    .select("id, title, summary, object_type")
    .eq("space_id", spaceId)
    .in("object_type", types)
    .limit(200);

  if (error) {
    console.error("[derive-features-micros] select failed:", error);
    return NextResponse.json(
      { error: "Failed to load cards" },
      { status: 500 },
    );
  }
  const cards = (rows ?? []) as {
    id: string;
    title: string | null;
    summary: string | null;
    object_type: string;
  }[];

  if (cards.length === 0) {
    return NextResponse.json({
      total: 0,
      cached: 0,
      derived: 0,
      failed: 0,
      empty: 0,
      results: [],
    });
  }

  const results = await runWithConcurrency<
    typeof cards[number],
    RowResult
  >(
    cards,
    async (row): Promise<RowResult> => {
      const headline = String(row.title ?? "").trim();
      const cardBody = String(row.summary ?? "").trim();
      const role = String(row.object_type ?? "").trim();
      if (!headline && !cardBody) {
        return {
          libraryObjectId: row.id,
          title: headline,
          objectType: row.object_type,
          status: "empty",
          microCount: 0,
          reason: "no title/summary",
        };
      }

      // Cache check (unless forced).
      if (!force) {
        try {
          const resolved = await getMicroObjectives(
            auth.supabase,
            spaceId,
            row.id,
            { headline, body: cardBody },
          );
          if (resolved.artifact) {
            return {
              libraryObjectId: row.id,
              title: headline,
              objectType: row.object_type,
              status: "cached",
              microCount: resolved.artifact.micros.length,
            };
          }
        } catch {
          /* fall through to derive */
        }
      }

      // Derive fresh.
      let micros;
      try {
        micros = await deriveMicroObjectives({
          card: { headline, body: cardBody, role: role || undefined },
          factors: factorLite,
          objective,
        });
      } catch (err) {
        console.warn(
          `[derive-features-micros] derive failed for ${row.id}:`,
          err,
        );
        return {
          libraryObjectId: row.id,
          title: headline,
          objectType: row.object_type,
          status: "failed",
          microCount: 0,
          reason: err instanceof Error ? err.message : "derive error",
        };
      }
      if (micros.length === 0) {
        return {
          libraryObjectId: row.id,
          title: headline,
          objectType: row.object_type,
          status: "empty",
          microCount: 0,
          reason: "model returned no usable micros",
        };
      }

      const artifact = buildMicroObjectivesArtifact({
        cardId: row.id,
        card: { headline, body: cardBody, role: role || undefined },
        micros,
      });
      await cacheMicroObjectives(
        auth.supabase,
        spaceId,
        row.id,
        artifact,
        row.id,
      );

      return {
        libraryObjectId: row.id,
        title: headline,
        objectType: row.object_type,
        status: "derived",
        microCount: micros.length,
      };
    },
    concurrency,
  );

  // Aggregate.
  const summary = {
    total: results.length,
    cached: results.filter((r) => r.status === "cached").length,
    derived: results.filter((r) => r.status === "derived").length,
    failed: results.filter((r) => r.status === "failed").length,
    empty: results.filter((r) => r.status === "empty").length,
    results,
  };

  return NextResponse.json(summary);
}
