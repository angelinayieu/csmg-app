// ── GET /api/tools ──
//
// Catalog endpoint. Returns the public metadata of every registered
// tool — id, domain, label, description, requiresAuth — so client
// components can render tool pickers / lookup surfaces without
// hardcoding the connector list.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { describeTools } from "@/lib/tools/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  return NextResponse.json({ tools: describeTools() });
}
