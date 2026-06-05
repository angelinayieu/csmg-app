// POST /api/tabs/sync
//
// Called by the akiboe tab-sync browser extension (NOT a Supabase-
// authenticated user). Auth is a per-user pairing token issued by
// /api/integrations/tabs/pair and pasted into the extension; we resolve
// it → user_id with a service-role client (RLS-bypassing) and upsert the
// open tabs into browser_tabs.
//
// Body: { tabs: [{ url, title?, favIconUrl?, tab_group? }] }
// Header: Authorization: Bearer <pairing_token>

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TabIn {
  url?: string;
  title?: string;
  favIconUrl?: string;
  favicon_url?: string;
  tab_group?: string;
}

export async function POST(req: Request) {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.toLowerCase().startsWith("bearer ")
    ? authz.slice(7).trim()
    : "";
  if (!token) {
    return NextResponse.json({ error: "Missing pairing token." }, { status: 401 });
  }

  let body: { tabs?: TabIn[] };
  try {
    body = (await req.json()) as { tabs?: TabIn[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const rawTabs = Array.isArray(body.tabs) ? body.tabs : [];

  const db = createServiceClient();

  // Resolve pairing token → user.
  const { data: integ, error: integErr } = await db
    .from("user_integrations")
    .select("user_id")
    .eq("provider", "browser_tabs")
    .eq("pairing_token", token)
    .maybeSingle();
  if (integErr || !integ) {
    return NextResponse.json({ error: "Invalid pairing token." }, { status: 401 });
  }
  const userId = (integ as { user_id: string }).user_id;

  // Normalize + validate: http/https only, dedupe by URL, cap 100.
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  for (const t of rawTabs.slice(0, 300)) {
    const url = (t.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue; // skip chrome://, file://, etc.
    if (seen.has(url)) continue;
    seen.add(url);
    const favicon = (t.favIconUrl || t.favicon_url || "").toString();
    rows.push({
      user_id: userId,
      url,
      title: typeof t.title === "string" ? t.title.slice(0, 400) : null,
      favicon_url: favicon ? favicon.slice(0, 1000) : null,
      tab_group: typeof t.tab_group === "string" ? t.tab_group.slice(0, 120) : null,
      synced_at: now,
    });
    if (rows.length >= 100) break;
  }

  // Snapshot semantics: the POSTed tabs ARE the user's synced set (the
  // chosen windows). Upsert them, then drop any previously-synced tab no
  // longer present — so deselecting a window removes its tabs.
  const { data: existing } = await db
    .from("browser_tabs")
    .select("id, url")
    .eq("user_id", userId);

  if (rows.length > 0) {
    const { error: upErr } = await db
      .from("browser_tabs")
      .upsert(rows, { onConflict: "user_id,url" });
    if (upErr) {
      console.error("[tabs/sync] upsert failed:", upErr.message);
      return NextResponse.json({ error: "Could not save tabs." }, { status: 500 });
    }
  }

  const keep = new Set(rows.map((r) => r.url as string));
  const staleIds = ((existing ?? []) as Array<{ id: string; url: string }>)
    .filter((r) => !keep.has(r.url))
    .map((r) => r.id);
  if (staleIds.length > 0) {
    const { error: delErr } = await db
      .from("browser_tabs")
      .delete()
      .in("id", staleIds);
    if (delErr) {
      console.warn("[tabs/sync] stale cleanup failed (non-fatal):", delErr.message);
    }
  }

  await db
    .from("user_integrations")
    .update({ last_synced_at: now, status: "connected" })
    .eq("user_id", userId)
    .eq("provider", "browser_tabs");

  return NextResponse.json({ synced: rows.length });
}
