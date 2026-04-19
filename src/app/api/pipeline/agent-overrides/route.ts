import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { AgentOverrides } from "@/types/intelligence";

export const maxDuration = 10;

/**
 * POST /api/pipeline/agent-overrides
 * Body: { spaceId: string, agentId: string, overrides: Partial<AgentOverrides> }
 *
 * Merges partial overrides into synthesis_data.agent_overrides[agentId].
 * Returns the updated override.
 *
 * DELETE /api/pipeline/agent-overrides?spaceId=...&agentId=...
 * Removes overrides for a given agent.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let agentId: string;
  let overrides: Partial<AgentOverrides>;

  try {
    const body = await request.json();
    spaceId = body.spaceId;
    agentId = body.agentId;
    overrides = body.overrides ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId || !agentId) {
    return NextResponse.json({ error: "spaceId and agentId required" }, { status: 400 });
  }

  const { data: row } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!row) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const synthData = (row.synthesis_data ?? {}) as Record<string, unknown>;
  const existingOverrides = (synthData.agent_overrides ?? {}) as Record<string, AgentOverrides>;
  const prior = existingOverrides[agentId] ?? { agent_id: agentId, lifecycle: "active" as const, updated_at: new Date().toISOString() };

  const merged: AgentOverrides = {
    ...prior,
    ...overrides,
    agent_id: agentId,
    updated_at: new Date().toISOString(),
    updated_by: "user",
  };

  const newOverrides = { ...existingOverrides, [agentId]: merged };

  await db.from("spaces").update({
    synthesis_data: { ...synthData, agent_overrides: newOverrides },
  }).eq("id", spaceId);

  return NextResponse.json({ success: true, overrides: merged });
}

export async function DELETE(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("spaceId");
  const agentId = url.searchParams.get("agentId");

  if (!spaceId || !agentId) {
    return NextResponse.json({ error: "spaceId and agentId required" }, { status: 400 });
  }

  const { data: row } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!row) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const synthData = (row.synthesis_data ?? {}) as Record<string, unknown>;
  const existingOverrides = (synthData.agent_overrides ?? {}) as Record<string, AgentOverrides>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [agentId]: _removed, ...rest } = existingOverrides;

  await db.from("spaces").update({
    synthesis_data: { ...synthData, agent_overrides: rest },
  }).eq("id", spaceId);

  return NextResponse.json({ success: true });
}
