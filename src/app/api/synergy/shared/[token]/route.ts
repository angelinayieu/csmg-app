// ── GET /api/synergy/shared/[token] ──
//
// Public, unauthenticated reader. Looks up the strategy share token,
// validates it's neither revoked nor expired, then returns a
// redacted strategy bundle. Uses the service-role client to bypass
// RLS — the token itself is the auth.
//
// Privacy redaction rules:
//   - Strategy: statement, pitch, status, dates only. No
//     current_generation_id (internal).
//   - Blocks: full content — this is what's being shared.
//   - Components: label_public + description_public + kind + subkind.
//     description_private is NEVER returned, regardless of the
//     component's visibility. visibility chip is dropped too — the
//     viewer doesn't need to know which rows the owner marked
//     private; they just see "this component backs the strategy".
//
// Tracks usage by bumping view_count + last_viewed_at on each hit.
// Fire-and-forget — we don't want a write hiccup to block the read.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { token } = await ctx.params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: shareRow, error: shareErr } = await db
    .from("synergy_strategy_share_tokens")
    .select(
      "id, strategy_id, token, created_by, created_at, expires_at, revoked_at, label",
    )
    .eq("token", token)
    .maybeSingle();
  if (shareErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(shareErr) },
      { status: 500 },
    );
  }
  if (!shareRow) {
    // Don't leak "exists but revoked" — collapse both into 404.
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  const share = shareRow as {
    id: string;
    strategy_id: string;
    created_by: string;
    expires_at: string | null;
    revoked_at: string | null;
    label: string | null;
    created_at: string;
  };

  if (share.revoked_at) {
    return NextResponse.json(
      { error: "This link has been revoked" },
      { status: 410 },
    );
  }
  if (share.expires_at && Date.parse(share.expires_at) < Date.now()) {
    return NextResponse.json(
      { error: "This link has expired" },
      { status: 410 },
    );
  }

  const { data: strategyRow, error: strategyErr } = await db
    .from("synergy_strategies")
    .select(
      "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
    )
    .eq("id", share.strategy_id)
    .maybeSingle();
  if (strategyErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(strategyErr) },
      { status: 500 },
    );
  }
  if (!strategyRow) {
    return NextResponse.json({ error: "Strategy missing" }, { status: 404 });
  }
  const strategy = strategyRow as {
    id: string;
    session_id: string;
    statement: string | null;
    pitch: string | null;
    status: string;
    current_generation_id: string | null;
    created_at: string;
    updated_at: string;
  };

  // Owner display name — purely cosmetic (the share page renders
  // "by <display_name>"). Missing profile collapses to "Anonymous".
  const [blocksRes, componentsRes, profileRes] = await Promise.all([
    strategy.current_generation_id
      ? db
          .from("synergy_strategy_blocks")
          .select("id, block_type, body, sort_order, meta, created_at")
          .eq("strategy_id", strategy.id)
          .eq("generation_id", strategy.current_generation_id)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] }),
    db
      .from("brainstorm_components")
      .select("id, kind, subkind, label_public, description_public, created_at")
      .eq("session_id", strategy.session_id)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: true }),
    db
      .from("synergy_profiles")
      .select("display_name, avatar_url, bio")
      .eq("user_id", share.created_by)
      .maybeSingle(),
  ]);

  // Fire-and-forget atomic view counter. Concurrent reads don't
  // clobber each other because the RPC does view_count + 1 inside
  // a single UPDATE. Failures are swallowed — telemetry must never
  // block the read.
  db.rpc("synergy_bump_share_view", { p_share_id: share.id }).then(() => {});

  const redactedComponents = ((componentsRes.data ?? []) as Array<{
    id: string;
    kind: string;
    subkind: string | null;
    label_public: string;
    description_public: string;
    created_at: string;
  }>).map((c) => ({
    id: c.id,
    kind: c.kind,
    subkind: c.subkind,
    label_public: c.label_public,
    description_public: c.description_public,
    created_at: c.created_at,
    // visibility deliberately omitted — viewer doesn't need it.
    // description_private deliberately omitted — owner-only.
  }));

  return NextResponse.json({
    share: {
      label: share.label,
      created_at: share.created_at,
      expires_at: share.expires_at,
    },
    strategy: {
      id: strategy.id,
      statement: strategy.statement,
      pitch: strategy.pitch,
      status: strategy.status,
      created_at: strategy.created_at,
      updated_at: strategy.updated_at,
    },
    blocks: blocksRes.data ?? [],
    components: redactedComponents,
    owner: profileRes.data
      ? {
          display_name:
            (profileRes.data as { display_name: string }).display_name,
          avatar_url:
            (profileRes.data as { avatar_url: string | null }).avatar_url,
          bio: (profileRes.data as { bio: string | null }).bio,
        }
      : null,
  });
}
