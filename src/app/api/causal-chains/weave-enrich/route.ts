import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { rankBridgesByGoalRelevance, type RankedBridge } from "@/lib/weaving/rank-bridges";
import type { Bridge, Entity, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";

export const maxDuration = 180;

/**
 * POST /api/causal-chains/weave-enrich
 *
 * Body: { spaceId: string, maxPeers?: number }
 *
 * Composite endpoint that:
 *   1. Pulls entities referenced in the current space's Causal Chains + labs
 *      (falls back to top-centrality entities if no chains yet)
 *   2. Lists the user's other spaces
 *   3. Computes a shared-variable signature for each peer (entity name overlap)
 *   4. Calls /api/weave for each peer that scores above threshold
 *   5. Re-ranks all bridges by goal relevance
 *   6. Returns the top bridges + callout text for the Operating Twin right panel
 *
 * Signature algorithm (deterministic):
 *   - Normalize entity names → lowercase, strip punctuation, drop short stopwords
 *   - For each peer space, count tokens shared with the current space's chain entities
 *   - Peer score = (shared_tokens / chain_tokens) × (peer.synthesis_present ? 1.2 : 1.0)
 *   - Only invoke weave when peer_score ≥ 0.15 AND shared_tokens ≥ 2
 */
export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const parsed = await safeJsonParse<{ spaceId?: string; maxPeers?: number }>(request);
  if (parsed.error) return parsed.error;
  const spaceId = parsed.data?.spaceId;
  const maxPeers = Math.max(1, Math.min(5, parsed.data?.maxPeers ?? 3));
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, name, synthesis_data")
    .eq("id", spaceId)
    .single();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const synthesisData =
      typeof spaceRow.synthesis_data === "string"
        ? (JSON.parse(spaceRow.synthesis_data) as SynthesisData)
        : (spaceRow.synthesis_data as SynthesisData | null);

    // Load current space entities/cycles/goal
    const [entityRes, cycleRes, goalRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db
        .from("improvement_goals")
        .select("*")
        .eq("space_id", spaceId)
        .eq("status", "active")
        .is("parent_goal_id", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    const entities = (entityRes.data ?? []) as Entity[];
    const cycles = (cycleRes.data ?? []) as Cycle[];
    const activeGoal = (goalRes.data ?? null) as ImprovementGoal | null;

    // ── Step 1: Determine "signature entities" — the ones we care about linking ──

    const chainEntityIds = new Set<string>();
    for (const chain of synthesisData?.causal_chains ?? []) {
      for (const eid of chain.entity_ids) chainEntityIds.add(eid);
    }
    let signatureEntities = entities.filter((e) => chainEntityIds.has(e.id));
    if (signatureEntities.length === 0) {
      // Fallback: top 10 by centrality_rank (nulls last)
      signatureEntities = [...entities]
        .sort((a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99))
        .slice(0, 10);
    }
    const signatureTokens = buildTokenSet(signatureEntities);

    if (signatureTokens.size === 0) {
      return NextResponse.json({
        peers_considered: 0,
        peers_invoked: [],
        new_bridges: 0,
        ranked: [],
        message: "No signature entities to weave against.",
      });
    }

    // ── Step 2: Fetch user's other spaces ──

    const { data: peerSpaces } = await db
      .from("spaces")
      .select("id, name, synthesis_data")
      .eq("user_id", user.id)
      .neq("id", spaceId)
      .limit(25);

    const peers = (peerSpaces ?? []) as Array<{
      id: string;
      name: string;
      synthesis_data: unknown;
    }>;

    // ── Step 3: Score peers by signature overlap ──

    interface PeerScore {
      peer_id: string;
      peer_name: string;
      score: number;
      shared_tokens: number;
      has_synthesis: boolean;
    }
    const peerScores: PeerScore[] = [];

    for (const peer of peers) {
      const { data: peerEntities } = await db
        .from("entities")
        .select("name, description, entity_category")
        .eq("space_id", peer.id);
      const peerTokens = buildTokenSet(peerEntities ?? []);
      let shared = 0;
      for (const tok of signatureTokens) {
        if (peerTokens.has(tok)) shared++;
      }
      const hasSynth = !!peer.synthesis_data;
      const score =
        (shared / Math.max(1, signatureTokens.size)) * (hasSynth ? 1.2 : 1.0);
      peerScores.push({
        peer_id: peer.id,
        peer_name: peer.name,
        score: Math.round(score * 100) / 100,
        shared_tokens: shared,
        has_synthesis: hasSynth,
      });
    }

    // Sort desc + threshold
    peerScores.sort((a, b) => b.score - a.score);
    const invokeList = peerScores
      .filter((p) => p.score >= 0.15 && p.shared_tokens >= 2)
      .slice(0, maxPeers);

    // ── Step 4: Invoke /api/weave for each selected peer ──

    const invokedResults: Array<{
      peer_id: string;
      peer_name: string;
      bridges_found: number;
      error?: string;
    }> = [];

    // Build absolute URL for internal fetch — use request's origin
    const origin = new URL(request.url).origin;
    const cookie = request.headers.get("cookie") ?? "";

    for (const peer of invokeList) {
      try {
        const res = await fetch(`${origin}/api/weave`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie, // forward auth
          },
          body: JSON.stringify({ spaceAId: spaceId, spaceBId: peer.peer_id }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          invokedResults.push({
            peer_id: peer.peer_id,
            peer_name: peer.peer_name,
            bridges_found: 0,
            error: errBody.error ?? `HTTP ${res.status}`,
          });
          continue;
        }
        const data = (await res.json()) as { bridgesSaved?: number; bridges?: unknown[] };
        invokedResults.push({
          peer_id: peer.peer_id,
          peer_name: peer.peer_name,
          bridges_found: data.bridgesSaved ?? (data.bridges?.length ?? 0),
        });
      } catch (err) {
        invokedResults.push({
          peer_id: peer.peer_id,
          peer_name: peer.peer_name,
          bridges_found: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Step 5: Re-rank all bridges ──

    const { data: bridgeRows } = await db
      .from("bridges")
      .select("*")
      .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`);
    const bridges = (bridgeRows ?? []) as Bridge[];

    const ranked: RankedBridge[] = rankBridgesByGoalRelevance({
      bridges,
      currentSpaceId: spaceId,
      entities,
      cycles,
      synthesisData,
      activeGoal,
    });

    // ── Step 6: Build callout text for UI ──

    const newBridgeCount = invokedResults.reduce((s, r) => s + r.bridges_found, 0);
    const topRanked = ranked[0];
    let callout: string | null = null;
    if (newBridgeCount > 0 && topRanked) {
      const peerName = invokedResults.find((r) => r.bridges_found > 0)?.peer_name;
      const chainLabel = topRanked.chain_id
        ? `"${
            synthesisData?.causal_chains?.find((c) => c.id === topRanked.chain_id)?.name ??
            "a chain"
          }"`
        : "your graph";
      callout =
        peerName !== undefined
          ? `${newBridgeCount} new bridge${newBridgeCount === 1 ? "" : "s"} found — ${chainLabel} shares structure with ${peerName}'s "${topRanked.bridge.shared_variable_name}"`
          : `${newBridgeCount} new bridge${newBridgeCount === 1 ? "" : "s"} found`;
    } else if (ranked.length > 0 && invokeList.length === 0) {
      callout = `No new bridges — ${ranked.length} existing bridge${ranked.length === 1 ? "" : "s"} re-ranked against your active goal.`;
    } else if (invokeList.length === 0) {
      callout = "No peer spaces share enough structure with this dashboard to weave yet.";
    }

    return NextResponse.json({
      peers_considered: peerScores.length,
      peers_invoked: invokedResults,
      peer_scores: peerScores.slice(0, 8), // top 8 for debugging
      new_bridges: newBridgeCount,
      total_bridges: bridges.length,
      ranked: ranked.slice(0, 12),
      callout,
    });
  } catch (err) {
    console.error("[weave-enrich] failed:", err);
    return NextResponse.json(
      { error: `Weave-enrich failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── Helpers ──

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "these", "those",
  "its", "their", "our", "your", "his", "her", "but", "not", "any", "all",
  "some", "how", "what", "when", "why", "where", "who", "which",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function buildTokenSet(
  entities: Array<{ name?: string | null; description?: string | null; entity_category?: string | null }>,
): Set<string> {
  const set = new Set<string>();
  for (const e of entities) {
    if (e.name) for (const t of tokenize(e.name)) set.add(t);
    // Skip description tokens — too noisy
  }
  return set;
}
