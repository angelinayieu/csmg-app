// ── POST /api/synergy/sessions/[id]/components/match ──
//
// On-demand match recompute for every matchable component owned by
// the requesting user in this session. Iterates through the session's
// brainstorm_components rows and calls matchOneComponent for each.
//
// Why session-scoped rather than component-by-component on the
// client? Because users typically want "find matches across all my
// stuff" after publishing — not piecemeal. The session is the unit
// they think in.
//
// Side effect: auto-creates a synergy_profiles row on first call so
// the user can immediately be matched against by others. Display
// name defaults to the email's local-part; user can edit later.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { matchOneComponent } from "@/lib/synergy/matcher";

export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify session ownership
  const { data: session } = await db
    .from("brainstorm_sessions")
    .select(
      "id, owner_id, objective_statement, objective_constraints, objective_success_criteria",
    )
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Auto-bootstrap profile (idempotent)
  await ensureProfile(db, user.id, user.email);

  // Pull matchable components for this session
  const { data: components } = await db
    .from("brainstorm_components")
    .select(
      "id, owner_id, session_id, kind, subkind, label_public, description_public",
    )
    .eq("session_id", sessionId)
    .neq("visibility", "private");

  const list = (components ?? []) as Array<{
    id: string;
    owner_id: string;
    session_id: string;
    kind: string;
    subkind: string | null;
    label_public: string;
    description_public: string;
  }>;
  if (list.length === 0) {
    return NextResponse.json({
      candidates_considered_total: 0,
      matches_persisted_total: 0,
      components_processed: 0,
    });
  }

  // Use the service-role client for the matcher itself so it can read
  // across owner_ids via the RPC + upsert into component_matches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serviceDb = createServiceClient() as any;

  let totalCandidates = 0;
  let totalPersisted = 0;
  const errors: string[] = [];

  for (const c of list) {
    try {
      const result = await matchOneComponent(serviceDb, {
        id: c.id,
        owner_id: c.owner_id,
        session_id: c.session_id,
        kind: c.kind,
        subkind: c.subkind,
        label_public: c.label_public,
        description_public: c.description_public,
        objective_statement: session.objective_statement,
      });
      totalCandidates += result.candidates_considered;
      totalPersisted += result.matches_persisted;
    } catch (err) {
      console.error(
        `[/api/synergy/.../components/match] component ${c.id} failed:`,
        err,
      );
      errors.push(sanitizeErrorMessage(err));
    }
  }

  return NextResponse.json({
    candidates_considered_total: totalCandidates,
    matches_persisted_total: totalPersisted,
    components_processed: list.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function ensureProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  email: string | undefined,
) {
  const { data: existing } = await db
    .from("synergy_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return;
  // Default display_name: email local-part, capped at 64, falling
  // back to a generic if email isn't available.
  const localPart = (email ?? "").split("@")[0] ?? "";
  const displayName =
    localPart.length >= 2 ? localPart.slice(0, 64) : "Synergy user";
  await db.from("synergy_profiles").insert({
    user_id: userId,
    display_name: displayName,
    matching_enabled: true,
  });
}
