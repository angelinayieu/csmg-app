import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  ALL_DATA_CATEGORIES,
  completeConsentMap,
  defaultConsentMap,
  type DataCategory,
  type EscalationPolicy,
} from "@/types/consent";

const VALID_ESCALATION_POLICIES: EscalationPolicy[] = [
  "ask_each_time",
  "auto_if_value_above_x",
  "never_escalate",
];

/**
 * GET /api/user/consent
 * Returns the caller's consent manifest. Seeds defaults if missing.
 */
export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: row } = await db
    .from("user_consent_manifest")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    const seed = defaultConsentMap();
    const { data: created, error: insErr } = await db
      .from("user_consent_manifest")
      .insert({ user_id: user.id, consent_map: seed })
      .select()
      .single();

    if (insErr) {
      console.error("[consent] seed insert failed:", insErr);
      return NextResponse.json({ error: "Failed to create consent manifest" }, { status: 500 });
    }
    return NextResponse.json({ manifest: created });
  }

  // Fill in any missing categories with defaults so the client always has a complete map.
  const complete = completeConsentMap(
    row.consent_map as Partial<Record<DataCategory, boolean>>
  );
  return NextResponse.json({
    manifest: { ...row, consent_map: complete },
  });
}

/**
 * PUT /api/user/consent
 * Body: { consent_map?: Partial<Record<DataCategory, boolean>>, friction_budget?: number, escalation_policy?: EscalationPolicy }
 * Upserts the caller's manifest; any omitted fields are left untouched.
 */
export async function PUT(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    consent_map?: Partial<Record<DataCategory, boolean>>;
    friction_budget?: number;
    escalation_policy?: EscalationPolicy;
  }>(request);
  if (parseError) return parseError;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load existing so we can merge
  const { data: existing } = await db
    .from("user_consent_manifest")
    .select("consent_map, friction_budget, escalation_policy")
    .eq("user_id", user.id)
    .maybeSingle();

  const currentMap = completeConsentMap(
    existing?.consent_map as Partial<Record<DataCategory, boolean>>
  );
  const mergedMap: Record<DataCategory, boolean> = { ...currentMap };
  if (body.consent_map && typeof body.consent_map === "object") {
    for (const key of Object.keys(body.consent_map) as DataCategory[]) {
      if (!ALL_DATA_CATEGORIES.includes(key)) continue;
      const val = body.consent_map[key];
      if (typeof val === "boolean") mergedMap[key] = val;
    }
  }

  let friction = existing?.friction_budget ?? 5;
  if (
    typeof body.friction_budget === "number" &&
    Number.isFinite(body.friction_budget) &&
    body.friction_budget >= 1 &&
    body.friction_budget <= 10
  ) {
    friction = Math.round(body.friction_budget);
  }

  let policy: EscalationPolicy = existing?.escalation_policy ?? "ask_each_time";
  if (body.escalation_policy && VALID_ESCALATION_POLICIES.includes(body.escalation_policy)) {
    policy = body.escalation_policy;
  }

  const { data: saved, error: upsertErr } = await db
    .from("user_consent_manifest")
    .upsert(
      {
        user_id: user.id,
        consent_map: mergedMap,
        friction_budget: friction,
        escalation_policy: policy,
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (upsertErr) {
    console.error("[consent] upsert failed:", upsertErr);
    return NextResponse.json({ error: "Failed to save consent manifest" }, { status: 500 });
  }

  return NextResponse.json({ manifest: saved });
}
