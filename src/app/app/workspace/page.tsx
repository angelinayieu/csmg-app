// ── /app/workspace ──────────────────────────────────────────────
//
// Universal-canvas Phase C — the "Open your workspace" CTA on the
// homepage routes here. We ensure-or-create the user's workspace
// row, then redirect to its whiteboard. Single round-trip on the
// server so the user never sees a flash of empty state.
//
// Why a separate route instead of inlining the ensure call on /app:
// the homepage stays a server component with no fetch-then-redirect
// dance, and bookmarking /app/workspace becomes a stable shortcut
// to the user's canonical canvas.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/auth/login");
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Look for an existing flagged workspace, oldest-first for stability.
  const existing = await db
    .from("spaces")
    .select("id")
    .eq("user_id", user.id)
    .eq("reasoning_settings->>is_workspace", "true")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    // Workspace exists — drop the user on the Synthesis Lab (universal
    // entry surface). They can pivot into /whiteboard from the
    // sidebar if they want the raw tldraw canvas.
    redirect(`/app/space/${existing.data.id}/triple-lab`);
  }

  // None exists — create one. Same shape as /api/workspace/ensure.
  const insert = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: "Your workspace",
      description:
        "Your home canvas. Brainstorms, strategies, R&D spaces, and twins land here as rooms you can compose.",
      space_prefix: "WS",
      input_text: "",
      entity_count: 0,
      edge_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      reasoning_settings: { is_workspace: true },
      synthesis_data: {},
    })
    .select("id")
    .single();

  if (insert.error || !insert.data?.id) {
    // Fall back to /app if creation failed — we don't want to leave
    // the user on a blank route with no escape hatch.
    console.error("[/app/workspace] insert failed:", insert.error);
    redirect("/app");
  }

  // Freshly-created workspace — land on Synthesis Lab as the
  // universal entry surface.
  redirect(`/app/space/${insert.data.id}/triple-lab`);
}
