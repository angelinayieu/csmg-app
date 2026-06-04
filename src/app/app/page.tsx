// ── /app — the home surface ──
//
// The minimal home: clean header, time-aware greeting, the objective chatbox
// (the single entry point into the product), and the user's library. This is
// the ONLY surface — the prior Synergy dashboard (?legacy) and Studio shell
// (?studio) were removed as part of retiring the old build.
//
// First-sign-in onboarding gate stays here — brand-new users with null
// onboarding_completed_at redirect to /app/welcome.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { IntakeHome } from "@/components/home/intake-home";
import type { LibrarySpace } from "@/components/home/library-grid";
import type { SyncedTab } from "@/components/home/objective-chatbox";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getAuthUser();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── First-sign-in onboarding gate (+ display name) ──
  let displayName = user?.email?.split("@")[0] ?? "there";
  if (user) {
    const { data: profile } = await db
      .from("synergy_profiles")
      .select("onboarding_completed_at, display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile || profile.onboarding_completed_at === null) {
      redirect("/app/welcome");
    }
    if (profile.display_name) displayName = profile.display_name as string;
  }

  // ── Minimal home (the only surface) ──
  // Library spaces — rich query with a column-light fallback (mirrors
  // the layout's resilience to an unapplied archived/pinned migration).
  const rich = await db
    .from("spaces")
    .select(
      "id, name, description, space_kind, card_brief, updated_at, archived, parent_space_id, input_text",
    )
    .is("parent_space_id", null)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(12);
  const spacesRows = rich.error
    ? (
        await db
          .from("spaces")
          .select(
            "id, name, description, space_kind, card_brief, updated_at, input_text",
          )
          .order("updated_at", { ascending: false })
          .limit(12)
      ).data ?? []
    : rich.data ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spaces: LibrarySpace[] = (spacesRows as any[])
    // Hide un-promoted DRAFT objective spaces (empty input_text) — they're
    // intake scratch, not library items, and would otherwise pile up as
    // empty "Draft" cards in the grid.
    .filter(
      (s) =>
        !(
          s.space_kind === "objective_canvas" &&
          !String(s.input_text ?? "").trim()
        ),
    )
    .map((s) => {
      // Pass the cached card brief through ONLY when it's well-formed and
      // not stale (its source updated_at is at/after the space's). Stale or
      // missing → null, so the grid regenerates it progressively.
      const cb = s.card_brief as
        | {
            kind?: unknown;
            name?: unknown;
            points?: unknown;
            from_updated_at?: unknown;
          }
        | null;
      const fresh =
        !!cb &&
        typeof cb.name === "string" &&
        typeof cb.kind === "string" &&
        Array.isArray(cb.points) &&
        (!s.updated_at ||
          typeof cb.from_updated_at !== "string" ||
          new Date(cb.from_updated_at).getTime() >=
            new Date(s.updated_at).getTime());
      return {
        id: s.id,
        name: s.name ?? null,
        description: s.description ?? null,
        space_kind: s.space_kind ?? null,
        card_brief: fresh ? (cb as unknown as LibrarySpace["card_brief"]) : null,
      };
    });

  const [profileRes, tabsRes, driveRes] = await Promise.all([
    user
      ? db.from("profiles").select("credit_balance").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    user
      ? db
          .from("browser_tabs")
          .select("id, url, title, favicon_url, tab_group")
          .eq("user_id", user.id)
          .order("synced_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
    user
      ? db
          .from("user_integrations")
          .select("status")
          .eq("user_id", user.id)
          .eq("provider", "google_drive")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const creditBalance: number = profileRes?.data?.credit_balance ?? 0;
  const syncedTabs: SyncedTab[] = (tabsRes?.data ?? []) as SyncedTab[];
  const driveConnected = driveRes?.data?.status === "connected";

  // Whiteboard-native intake: find-or-create the user's hidden DRAFT objective
  // space so typing on the chatbox lands the user on a real board (no
  // navigation/persistence-swap on submit). One per user.
  let draftSpaceId: string | undefined;
  if (user) {
    const { data: draft } = await db
      .from("spaces")
      .select("id")
      .eq("user_id", user.id)
      .eq("space_kind", "objective_canvas")
      .eq("synthesis_data->objective_canvas->>draft", "true")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draft?.id) {
      draftSpaceId = draft.id as string;
    } else {
      const { data: created } = await db
        .from("spaces")
        .insert({
          user_id: user.id,
          name: "Draft",
          description: "",
          space_prefix: "OB",
          input_text: "",
          entity_count: 0,
          edge_count: 0,
          orphan_count: 0,
          cycle_count: 0,
          maturity: "actionable_now",
          space_kind: "objective_canvas",
          pipeline_mode: "review_each",
          synthesis_data: { objective_canvas: { draft: true, stage: "main" } },
        })
        .select("id")
        .single();
      if (created?.id) draftSpaceId = created.id as string;
    }
  }

  return (
    <IntakeHome
      displayName={displayName}
      email={user?.email ?? ""}
      creditBalance={creditBalance}
      spaces={spaces.filter((s) => s.id !== draftSpaceId)}
      syncedTabs={syncedTabs}
      driveConnected={driveConnected}
      draftSpaceId={draftSpaceId}
    />
  );
}
