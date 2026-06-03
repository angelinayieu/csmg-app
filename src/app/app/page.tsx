// ── /app — the home surface ──
//
// Default: the minimal home — clean header, time-aware greeting, the
// objective chatbox (the single entry point into the product), and the
// user's library. Everything else is re-routed off the default path but
// left intact in the repo:
//   • /app?legacy=1  → the prior Synergy dashboard (+ HomeTabNav)
//   • /app?studio=1  → the older Studio shell (HomeShell)
//
// First-sign-in onboarding gate stays here — brand-new users with null
// onboarding_completed_at redirect to /app/welcome.

import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeShell } from "@/components/home/home-shell";
import { SynergyDashboard } from "@/components/synergy/synergy-dashboard";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { MinimalHome } from "@/components/home/minimal-home";
import type { LibrarySpace } from "@/components/home/library-grid";
import type { SyncedTab } from "@/components/home/objective-chatbox";
import { TEMPLATE_LIST } from "@/lib/use-cases/library";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams?: Promise<{ style?: string; legacy?: string; studio?: string }>;
}) {
  const params = await searchParams;
  const showLegacy = params?.legacy === "1"; // prior Synergy dashboard
  const showStudio = params?.studio === "1"; // older Studio shell

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

  // ── Default: Minimal home ──
  if (!showLegacy && !showStudio) {
    // Library spaces — rich query with a column-light fallback (mirrors
    // the layout's resilience to an unapplied archived/pinned migration).
    const rich = await db
      .from("spaces")
      .select(
        "id, name, description, space_kind, card_brief, updated_at, archived, parent_space_id",
      )
      .is("parent_space_id", null)
      .eq("archived", false)
      .order("updated_at", { ascending: false })
      .limit(12);
    const spacesRows = rich.error
      ? (
          await db
            .from("spaces")
            .select("id, name, description, space_kind, card_brief, updated_at")
            .order("updated_at", { ascending: false })
            .limit(12)
        ).data ?? []
      : rich.data ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spaces: LibrarySpace[] = (spacesRows as any[]).map((s) => {
      // Pass the cached card brief through ONLY when it's well-formed and
      // not stale (its source updated_at is at/after the space's). Stale or
      // missing → null, so the grid regenerates it progressively.
      const cb = s.card_brief as
        | { name?: unknown; points?: unknown; from_updated_at?: unknown }
        | null;
      const fresh =
        !!cb &&
        typeof cb.name === "string" &&
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

    // Whiteboard-native intake: find-or-create the user's hidden DRAFT
    // objective space so typing on the chatbox lands the user on a real board
    // (no navigation/persistence-swap on submit). One per user.
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
      <MinimalHome
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

  // ── Legacy: Synergy dashboard (/app?legacy=1) ──
  if (showLegacy) {
    return (
      <>
        <HomeTabNav />
        <SynergyDashboard />
      </>
    );
  }

  // ── Studio shell — older surface (/app?studio=1) ──
  const immersiveMode = params?.style === "gradient" ? "gradient" : "canvas";

  const richSpacesRes = await db
    .from("spaces")
    .select("*")
    .is("parent_space_id", null)
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(60);

  const spacesRes = richSpacesRes.error
    ? await db
        .from("spaces")
        .select("*")
        .is("parent_space_id", null)
        .order("updated_at", { ascending: false })
        .limit(60)
    : richSpacesRes;

  const profileRes = user
    ? await db.from("profiles").select("credit_balance").eq("id", user.id).single()
    : { data: null };
  const rawSpaces = (spacesRes.data ?? []) as Space[];
  const spaces = rawSpaces.filter((s) => !s.archived);
  const creditBalance: number = profileRes?.data?.credit_balance ?? 0;

  const greetingName = user?.email?.split("@")[0] ?? "there";

  const templates = TEMPLATE_LIST.map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    icon: t.icon,
    accent_color: t.accent_color,
    category: t.category,
    default_surface: t.default_surface,
    seed_entity_count: t.seed_entities.length,
    question_count: t.question_library.length,
  }));

  return (
    <HomeShell
      greetingName={greetingName}
      templates={templates}
      spaces={spaces}
      mode={immersiveMode}
      userEmail={user?.email ?? ""}
      userId={user?.id ?? null}
      creditBalance={creditBalance}
    />
  );
}
