// ── POST /api/spaces/[id]/preflight/approve ──────────────────────────
//
// The contract gate. The user clicks "Run this plan ▶" on the
// preflight page; this route:
//
//   1. Re-runs the aggregator to capture the LATEST PreflightView
//      with all overrides applied (canonical source of truth)
//   2. Inserts a preflight_approvals row freezing the full view +
//      hash + opt-in toggles
//   3. Marks the kg_generation_plan as approved (status='approved')
//      so downstream stages know they can proceed
//   4. Fires the downstream pipeline async via after() — currently
//      kicks off /api/pipeline/decompose with autoAdvance=true so
//      the rest of the chain (synthesis → strategy → twin → lab)
//      runs without further user action
//   5. Returns the redirect target (the canvas page)
//
// Idempotent on re-click: if a fresh approval was made within 30s
// AND the preflight_hash matches, we return the existing approval
// without re-firing the pipeline. Defends against double-click +
// race conditions.
//
// Body (optional): { reasoning?: string }
//   reasoning is captured on the approval row for audit.

import { NextResponse } from "next/server";
import { after } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import { loadPreflightView } from "@/lib/preflight/load-preflight";

export const dynamic = "force-dynamic";

interface ApproveBody {
  reasoning?: string;
  /** Optional persona/subject anchoring — lets the user approve a
   *  variant of the same space's preflight scoped to one persona. */
  subject_id?: string | null;
}

interface ApproveResponse {
  ok: true;
  approval_id: string;
  preflight_hash: string;
  redirect_to: string;
  enabled_optins: string[];
  /** True when the previous approval (within idempotency window)
   *  was returned instead of creating a new one. */
  already_approved: boolean;
}

const IDEMPOTENCY_WINDOW_SECONDS = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body } = await safeJsonParse(request);
  const b = (body ?? {}) as ApproveBody;
  const reasoning = typeof b.reasoning === "string" ? b.reasoning.trim() || null : null;
  const subjectId = typeof b.subject_id === "string" ? b.subject_id : null;

  // ── 1. Re-run the aggregator to capture canonical contract ────────
  const result = await loadPreflightView({
    db: supabase,
    space_id: spaceId,
    subject_id: subjectId,
    user_id: user.id,
    include_mediator_preview: true,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Failed to load preflight for approval",
        detail: result.detail ?? result.reason,
      },
      { status: 500 },
    );
  }
  const preflight = result.preflight;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 2. Idempotency check ──────────────────────────────────────────
  // If a recent approval has the same hash, return it instead of
  // creating a duplicate. Catches double-clicks + browser retries.
  const cutoff = new Date(
    Date.now() - IDEMPOTENCY_WINDOW_SECONDS * 1000,
  ).toISOString();
  const { data: recentApproval } = await db
    .from("preflight_approvals")
    .select("id, preflight_hash, enabled_optins")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("preflight_hash", preflight.preflight_hash)
    .gte("approved_at", cutoff)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentApproval) {
    const existing = recentApproval as {
      id: string;
      preflight_hash: string;
      enabled_optins: string[];
    };
    return NextResponse.json({
      ok: true,
      approval_id: existing.id,
      preflight_hash: existing.preflight_hash,
      redirect_to: `/app/space/${spaceId}/whiteboard`,
      enabled_optins: existing.enabled_optins,
      already_approved: true,
    } satisfies ApproveResponse);
  }

  // ── 3. Compute enabled_optins from the live preflight ─────────────
  const enabledOptins = preflight.downstream.could_generate
    .filter((item) => item.enabled)
    .map((item) => item.id);

  // ── 4. Insert the approval row ────────────────────────────────────
  const { data: inserted, error: insertErr } = await db
    .from("preflight_approvals")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      preflight_hash: preflight.preflight_hash,
      preflight_snapshot: preflight,
      enabled_optins: enabledOptins,
      reasoning,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      {
        error: "Failed to record approval",
        detail: insertErr?.message ?? "(unknown)",
      },
      { status: 500 },
    );
  }
  const approvalId = (inserted as { id: string }).id;

  // ── 5. Mark the active kg_generation_plan as approved ─────────────
  // Soft-fail: if no plan exists or the update flubs, the approval
  // still counts — the downstream pipeline can proceed without an
  // explicit kg_generation_plan flip.
  try {
    await db
      .from("kg_generation_plans")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("space_id", spaceId)
      .in("status", ["proposed", "edited"]);
  } catch (err) {
    console.warn(
      "[preflight-approve] kg_generation_plan flip failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── 6. Fire the downstream pipeline async ─────────────────────────
  // Wrap in after() so the user gets their redirect immediately while
  // decompose + chain run in the background. The decompose route
  // handles its own auth + idempotency.
  after(
    fireDownstreamPipeline({
      spaceId,
      userId: user.id,
      approvalId,
      enabledOptins,
    }).catch((err) => {
      console.warn(
        `[preflight-approve] downstream fire failed for approval ${approvalId}:`,
        err instanceof Error ? err.message : err,
      );
    }),
  );

  return NextResponse.json({
    ok: true,
    approval_id: approvalId,
    preflight_hash: preflight.preflight_hash,
    redirect_to: `/app/space/${spaceId}/whiteboard`,
    enabled_optins: enabledOptins,
    already_approved: false,
  } satisfies ApproveResponse);
}

// ── Internal: pipeline kickoff ──────────────────────────────────────

async function fireDownstreamPipeline(args: {
  spaceId: string;
  userId: string;
  approvalId: string;
  enabledOptins: string[];
}): Promise<void> {
  // The decompose route is the canonical entry point — it chains
  // research → synthesis → strategy → twin → lab via autoAdvance.
  // We pass the enabled_optins as a header so it can read the user's
  // toggles without re-querying preflight_approvals.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";
  const url =
    baseUrl.startsWith("http")
      ? `${baseUrl}/api/pipeline/decompose`
      : `https://${baseUrl}/api/pipeline/decompose`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Internal call — would need an auth token forwarding strategy
      // for production. For now we rely on the route's per-space
      // ownership check using the same user_id we just verified.
      "X-Preflight-Approval-Id": args.approvalId,
      "X-Preflight-Optins": args.enabledOptins.join(","),
    },
    body: JSON.stringify({
      space_id: args.spaceId,
      auto_advance: true,
      preflight_approval_id: args.approvalId,
    }),
  });
}
