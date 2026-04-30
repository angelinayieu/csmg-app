// ── POST /api/pipeline/research/triangulate ──
//
// Phase 2a — post-hoc triangulation gap-flagging.
//
// Reads every claim for a space + its linked evidence_items, runs the
// triangulation gap detector, and emits one `triangulation_gap`
// structural event per under-supported claim. The events drive (a) the
// canvas's "this claim isn't fully grounded yet" affordances, and
// (b) future research orchestration (the suggested follow-up queries
// can be picked up by the next research pass).
//
// This is a SIDE-EFFECT-ONLY route — it doesn't write to the DB. It
// just reads + emits events. Idempotent across reruns.
//
// Body:
//   { spaceId: string, runId?: string, policy?: TriangulationPolicy }
//
// Response:
//   { totalClaims, gapsFound, gapsEmitted, errors[] }
//
// Auth: user must own the space. Run-id is optional — without one, we
// still compute and return the gap list but skip emission (useful for
// dry-run / debugging).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import {
  detectTriangulationGap,
  DEFAULT_TRIANGULATION_POLICY,
  type TriangulationPolicy,
  type MinimalEvidenceForGap,
  type TriangulationGap,
} from "@/lib/research/triangulation-gap-detector";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ClaimRow {
  id: string;
  claim_text: string;
  source_entity_id: string | null;
}

interface LinkRow {
  claim_id: string;
  evidence_id: string;
  support_type: "supports" | "contradicts" | "contextualizes";
}

interface EvidenceRow {
  id: string;
  url: string;
  reliability_prior: number;
}

interface EntityNameRow {
  id: string;
  name: string;
}

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

    const { spaceId, runId, policy: rawPolicy } = (body ?? {}) as {
      spaceId?: string;
      runId?: string;
      policy?: Partial<TriangulationPolicy>;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Caller-supplied policy overrides individual fields; missing
    // fields fall through to defaults. Lets the strategy-refresh path
    // run a stricter requirement (e.g., requiredSupportCount=3) for
    // load-bearing claims while leaving the default at 2.
    const policy: TriangulationPolicy = {
      ...DEFAULT_TRIANGULATION_POLICY,
      ...(rawPolicy ?? {}),
    };

    // ── Load claims + their evidence in parallel ────────────────────
    const [claimsRes, linksRes, evidenceRes, entitiesRes] = await Promise.all([
      db
        .from("claims")
        .select("id, claim_text, source_entity_id")
        .eq("space_id", spaceId),
      db
        .from("claim_evidence_links")
        // RLS / FK cascade requires we filter by claim membership in
        // the space — done by joining on claims fetched above. The
        // simplest portable approach is to fetch all links for the
        // space's claims via .in() after the claim fetch. We chain
        // these in two waves to keep the query simple.
        .select("claim_id, evidence_id, support_type"),
      db
        .from("evidence_items")
        .select("id, url, reliability_prior")
        .eq("space_id", spaceId),
      db
        .from("entities")
        .select("id, name")
        .eq("space_id", spaceId),
    ]);

    const claims = (claimsRes.data ?? []) as ClaimRow[];
    if (claims.length === 0) {
      return NextResponse.json({
        totalClaims: 0,
        gapsFound: 0,
        gapsEmitted: 0,
        errors: [],
      });
    }

    const claimIdSet = new Set(claims.map((c) => c.id));
    const links = ((linksRes.data ?? []) as LinkRow[]).filter((l) =>
      claimIdSet.has(l.claim_id),
    );
    const evidenceById = new Map<string, EvidenceRow>();
    for (const ev of (evidenceRes.data ?? []) as EvidenceRow[]) {
      evidenceById.set(ev.id, ev);
    }
    const entityNameById = new Map<string, string>();
    for (const e of (entitiesRes.data ?? []) as EntityNameRow[]) {
      entityNameById.set(e.id, e.name);
    }

    // Group links by claim, reconstruct minimal evidence per claim.
    const linksByClaim = new Map<string, LinkRow[]>();
    for (const link of links) {
      const arr = linksByClaim.get(link.claim_id) ?? [];
      arr.push(link);
      linksByClaim.set(link.claim_id, arr);
    }

    // ── Detect gaps ─────────────────────────────────────────────────
    const gaps: TriangulationGap[] = [];
    for (const claim of claims) {
      const claimLinks = linksByClaim.get(claim.id) ?? [];
      const evidence: MinimalEvidenceForGap[] = [];
      for (const link of claimLinks) {
        const ev = evidenceById.get(link.evidence_id);
        if (!ev) continue;
        evidence.push({
          url: ev.url,
          support_type: link.support_type,
          reliability_prior: ev.reliability_prior,
        });
      }
      const entityNames = claim.source_entity_id
        ? [entityNameById.get(claim.source_entity_id)].filter(
            (n): n is string => typeof n === "string",
          )
        : [];

      const gap = detectTriangulationGap({
        claimId: claim.id,
        claimText: claim.claim_text,
        evidence,
        relatedEntityNames: entityNames,
        policy,
      });
      if (gap) gaps.push(gap);
    }

    // ── Emit events ─────────────────────────────────────────────────
    let gapsEmitted = 0;
    const errors: string[] = [];
    if (runId && gaps.length > 0) {
      for (const gap of gaps) {
        try {
          await emitStructuralEvent(db, runId, {
            type: "triangulation_gap",
            claimId: gap.claimId,
            claimText: gap.claimText,
            currentSupportCount: gap.currentSupportCount,
            requiredSupportCount: gap.requiredSupportCount,
            hasContradictor: gap.hasContradictor,
            suggestedQueries: gap.suggestedQueries,
          });
          gapsEmitted++;
        } catch (err) {
          errors.push(
            `emit failed for claim ${gap.claimId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    return NextResponse.json({
      totalClaims: claims.length,
      gapsFound: gaps.length,
      gapsEmitted,
      // Caller can use `gaps` directly when no runId was provided
      // (dry-run mode) — drives "preview gap list" in the UI without
      // event side-effects.
      gaps,
      errors: errors.slice(0, 10),
    });
  } catch (outerErr) {
    console.error("[research/triangulate] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Triangulation failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
