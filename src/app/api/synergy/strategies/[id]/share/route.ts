// ── /api/synergy/strategies/[id]/share ──
//
// Owner-side CRUD for read-only share tokens. The public-facing
// reader lives at /api/synergy/shared/[token]; nothing here is
// reachable without auth.
//
//   POST   /api/synergy/strategies/[id]/share        → mint a token
//   GET    /api/synergy/strategies/[id]/share        → list active tokens
//   DELETE /api/synergy/strategies/[id]/share?token_id=xxx → revoke
//
// RLS pins ops to created_by = auth.uid(), so we also validate the
// strategy is owned by the caller via a session-join read first —
// that defends against IDOR even if the token row were to slip past.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CreateBody {
  label?: unknown;
  // Optional ISO timestamp. Server clamps to >= now + 1 hour and
  // <= now + 90d, or stores NULL if not provided ("never expires").
  expires_at?: unknown;
}

function generateToken(): string {
  // 32 URL-safe characters from 24 random bytes (base64url). Pure
  // Web Crypto so we don't add a dependency.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function assertOwnership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  strategyId: string,
  userId: string,
): Promise<NextResponse | null> {
  const { data, error } = await db
    .from("synergy_strategies")
    .select("id, session_id, brainstorm_sessions!inner(owner_id)")
    .eq("id", strategyId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ownerId = (
    data as { brainstorm_sessions?: { owner_id?: string } | null }
  ).brainstorm_sessions?.owner_id;
  if (ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: strategyId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const ownershipErr = await assertOwnership(db, strategyId, user.id);
  if (ownershipErr) return ownershipErr;

  const { data: body, error: parseError } =
    await safeJsonParse<CreateBody>(request);
  if (parseError) return parseError;

  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 80)
      : null;

  let expiresAt: string | null = null;
  if (typeof body.expires_at === "string") {
    const parsed = Date.parse(body.expires_at);
    if (!Number.isNaN(parsed)) {
      const now = Date.now();
      const minMs = now + 60 * 60 * 1000; // 1h
      const maxMs = now + 90 * 24 * 60 * 60 * 1000; // 90d
      const clamped = Math.min(Math.max(parsed, minMs), maxMs);
      expiresAt = new Date(clamped).toISOString();
    }
  }

  // Retry once on the (vanishingly rare) token collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = generateToken();
    const { data: row, error: insertErr } = await db
      .from("synergy_strategy_share_tokens")
      .insert({
        strategy_id: strategyId,
        token,
        created_by: user.id,
        expires_at: expiresAt,
        label,
      })
      .select(
        "id, token, label, created_at, expires_at, revoked_at, last_viewed_at, view_count",
      )
      .single();
    if (!insertErr && row) {
      return NextResponse.json({ share: row });
    }
    // 23505 = unique_violation → try a fresh token. Anything else is
    // a real error.
    const code = (insertErr as { code?: string } | null)?.code;
    if (code !== "23505") {
      return NextResponse.json(
        { error: sanitizeErrorMessage(insertErr) },
        { status: 500 },
      );
    }
  }
  return NextResponse.json(
    { error: "Could not mint a unique token; retry" },
    { status: 500 },
  );
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: strategyId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const ownershipErr = await assertOwnership(db, strategyId, user.id);
  if (ownershipErr) return ownershipErr;

  const { data, error } = await db
    .from("synergy_strategy_share_tokens")
    .select(
      "id, token, label, created_at, expires_at, revoked_at, last_viewed_at, view_count",
    )
    .eq("strategy_id", strategyId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ shares: data ?? [] });
}

export async function DELETE(request: Request, ctx: RouteContext) {
  const { id: strategyId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const ownershipErr = await assertOwnership(db, strategyId, user.id);
  if (ownershipErr) return ownershipErr;

  const url = new URL(request.url);
  const tokenId = url.searchParams.get("token_id");
  if (!tokenId) {
    return NextResponse.json({ error: "token_id required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("synergy_strategy_share_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("strategy_id", strategyId)
    .select(
      "id, token, label, created_at, expires_at, revoked_at, last_viewed_at, view_count",
    )
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ share: data });
}
