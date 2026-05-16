// ── /app/synergy/rooms — the Rooms surface ──
//
// One unified surface for everything room-shaped in the user's
// synergy life:
//   - Active rooms: synergy_rooms the user is a member of
//   - Invitations: pending match_requests where to_user === me
//   - Suggested: my matchable components with match_count > 0
//     that don't yet have an active room or pending invitation
//
// Visually flat — pure white cards on an off-white background, no
// gradients, no turquoise. Apple-style restraint: subtle shadows,
// generous whitespace, neutral grays, one accent color used sparingly.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergySceneBackground } from "@/components/synergy/synergy-scene-background";
import { SynergyScenePicker } from "@/components/synergy/synergy-scene-picker";
import type { ScenePresetKey } from "@/lib/synergy/scene-presets";
import { SynergyRoomsClient } from "./rooms-client";
import type { RoomsBundle } from "./rooms-types";
import { loadParallelBundle } from "@/lib/synergy/parallel-rooms-bundle";

export default async function SynergyRoomsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 0. User's background preference (added in 20260811) ──
  // Soft-fail if the column doesn't exist yet (migration not applied) —
  // we just fall back to the default 'mist' preset.
  let backgroundPreset: ScenePresetKey = "mist";
  let backgroundCustomUrl: string | null = null;
  try {
    const { data: bgProfile } = await db
      .from("synergy_profiles")
      .select("background_preset, background_custom_url")
      .eq("user_id", user.id)
      .maybeSingle();
    if (bgProfile?.background_preset) {
      backgroundPreset = bgProfile.background_preset as ScenePresetKey;
    }
    if (bgProfile?.background_custom_url) {
      backgroundCustomUrl = bgProfile.background_custom_url;
    }
  } catch {
    // Migration 20260811 not applied yet — quietly default to mist
  }

  // ── 1. Active rooms (synergy_rooms where I'm a member) ──
  const { data: activeRoomsRaw } = await db
    .from("synergy_rooms")
    .select(
      "id, user_a, user_b, component_a, component_b, intersection_objective, archived_at, created_at",
    )
    .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeRooms = (activeRoomsRaw ?? []) as Array<any>;

  // Hydrate components + profiles for active rooms in two parallel queries
  const activeComponentIds = new Set<string>();
  const activeOtherUserIds = new Set<string>();
  for (const r of activeRooms) {
    activeComponentIds.add(r.component_a);
    activeComponentIds.add(r.component_b);
    activeOtherUserIds.add(r.user_a === user.id ? r.user_b : r.user_a);
  }

  // ── 2. Incoming invitations (pending match_requests to me) ──
  const { data: incomingRaw } = await db
    .from("match_requests")
    .select(
      "id, from_user, to_user, from_component, to_component, message, status, created_at, expires_at",
    )
    .eq("to_user", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incoming = ((incomingRaw ?? []) as Array<any>).filter(
    (r) => new Date(r.expires_at).getTime() > Date.now(),
  );

  const incomingComponentIds = new Set<string>();
  for (const r of incoming) {
    incomingComponentIds.add(r.from_component);
    incomingComponentIds.add(r.to_component);
  }

  // ── 3. My matchable components + their match counts ──
  // (only those that aren't already locked into an active room)
  const activeRoomComponentIds = new Set<string>();
  for (const r of activeRooms) {
    if (r.user_a === user.id) activeRoomComponentIds.add(r.component_a);
    else activeRoomComponentIds.add(r.component_b);
  }
  // Also exclude components that already have a pending outgoing or
  // accepted incoming request — we don't want the user to "propose" a
  // room they've already started forming.
  const { data: myPendingOutgoing } = await db
    .from("match_requests")
    .select("from_component")
    .eq("from_user", user.id)
    .in("status", ["pending", "accepted"]);
  const myPendingComponentIds = new Set<string>(
    ((myPendingOutgoing ?? []) as Array<{ from_component: string }>).map(
      (r) => r.from_component,
    ),
  );

  const { data: myComponentsRaw } = await db
    .from("brainstorm_components")
    .select("id, session_id, kind, subkind, label_public, description_public")
    .eq("owner_id", user.id)
    .neq("visibility", "private");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myComponents = (myComponentsRaw ?? []) as Array<any>;

  // Match counts for "my components" via a single in() query
  const myComponentIds = myComponents.map((c) => c.id);
  const matchCounts = new Map<string, number>();
  if (myComponentIds.length > 0) {
    const { data: matches } = await db
      .from("component_matches")
      .select("component_a, component_b")
      .or(
        `component_a.in.(${myComponentIds.join(",")}),component_b.in.(${myComponentIds.join(",")})`,
      );
    for (const m of (matches ?? []) as Array<{
      component_a: string;
      component_b: string;
    }>) {
      if (myComponentIds.includes(m.component_a)) {
        matchCounts.set(
          m.component_a,
          (matchCounts.get(m.component_a) ?? 0) + 1,
        );
      }
      if (myComponentIds.includes(m.component_b)) {
        matchCounts.set(
          m.component_b,
          (matchCounts.get(m.component_b) ?? 0) + 1,
        );
      }
    }
  }
  const suggestedComponents = myComponents
    .map((c) => ({
      ...c,
      match_count: matchCounts.get(c.id) ?? 0,
    }))
    .filter(
      (c) =>
        c.match_count > 0 &&
        !activeRoomComponentIds.has(c.id) &&
        !myPendingComponentIds.has(c.id),
    )
    .sort((a, b) => b.match_count - a.match_count);

  // ── Hydration: components + other-user labels in batch ──
  const allComponentIds = new Set<string>([
    ...activeComponentIds,
    ...incomingComponentIds,
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let componentLookup = new Map<string, any>();
  if (allComponentIds.size > 0) {
    const { data: comps } = await db
      .from("brainstorm_components")
      .select("id, kind, subkind, label_public, description_public, owner_id")
      .in("id", Array.from(allComponentIds));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    componentLookup = new Map((comps ?? []).map((c: any) => [c.id, c]));
  }

  // Profiles only revealed for accepted contexts (active rooms). For
  // pending invitations, the sender stays anonymous until accept.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let profileLookup = new Map<string, any>();
  if (activeOtherUserIds.size > 0) {
    const { data: profiles } = await db
      .from("synergy_profiles")
      .select("user_id, display_name, bio, avatar_url")
      .in("user_id", Array.from(activeOtherUserIds));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileLookup = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  }

  // ── Parallel-path bundle (Phase 5b) ──
  //
  // Fetched independently of the collab data above. Soft-fails to an
  // empty parallel slice if the migration hasn't been applied yet — so
  // 5b can deploy ahead of the Supabase migration without breaking the
  // surface.
  let parallelSlice: Awaited<
    ReturnType<typeof loadParallelBundle>
  > = {
    active: [],
    invitations: [],
    suggested: [],
    my_strategies_count: 0,
    my_matchable_published_count: 0,
  };
  try {
    parallelSlice = await loadParallelBundle(db, user.id);
  } catch {
    // Tables not yet migrated — quietly fall back to empty.
  }

  // ── Assemble the typed bundle ──
  const collabSlice = {
    active: activeRooms.map((r) => {
      const otherUserId = r.user_a === user.id ? r.user_b : r.user_a;
      const myComponentId =
        r.user_a === user.id ? r.component_a : r.component_b;
      const theirComponentId =
        r.user_a === user.id ? r.component_b : r.component_a;
      const myComp = componentLookup.get(myComponentId);
      const theirComp = componentLookup.get(theirComponentId);
      const profile = profileLookup.get(otherUserId);
      return {
        id: r.id,
        intersection_objective: r.intersection_objective,
        created_at: r.created_at,
        my_component_label: myComp?.label_public ?? "",
        their_component_label: theirComp?.label_public ?? "",
        their_component_kind: theirComp?.kind ?? "core_idea",
        their_display_name: profile?.display_name ?? null,
        their_avatar_url: profile?.avatar_url ?? null,
        // Stable seed so the abstract avatar stays consistent if
        // display_name isn't set yet.
        other_user_seed: otherUserId,
      };
    }),
    invitations: incoming.map((r) => {
      const fromComp = componentLookup.get(r.from_component);
      const toComp = componentLookup.get(r.to_component);
      return {
        id: r.id,
        message: r.message,
        created_at: r.created_at,
        expires_at: r.expires_at,
        their_component_label: fromComp?.label_public ?? "",
        their_component_kind: fromComp?.kind ?? "core_idea",
        my_component_label: toComp?.label_public ?? "",
        // Seed for anonymous avatar. We use the request id rather than
        // the sender's user_id so we don't leak identity across reloads.
        seed: r.id,
      };
    }),
    suggested: suggestedComponents.map((c) => ({
      id: c.id,
      kind: c.kind,
      subkind: c.subkind,
      label_public: c.label_public,
      description_public: c.description_public,
      match_count: c.match_count,
      session_id: c.session_id,
    })),
  };

  const bundle: RoomsBundle = {
    collab: collabSlice,
    parallel: parallelSlice,
  };

  return (
    <>
      <SynergySceneBackground
        preset={backgroundPreset}
        customUrl={backgroundCustomUrl}
      />
      <div className="mx-auto max-w-6xl py-10">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
            Synergy · Rooms
          </div>
          <h1 className="font-display-tight mt-3 text-4xl font-semibold text-gray-900">
            Rooms
          </h1>
          <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-gray-500">
            Matched collaborators, pending invitations, and suggested rooms.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SynergyScenePicker
            currentPreset={backgroundPreset}
            hasCustom={!!backgroundCustomUrl}
          />
          <Link
            href="/app/synergy"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:border-gray-300"
          >
            ← Brainstorms
          </Link>
        </div>
      </header>

      <SynergyRoomsClient bundle={bundle} />
      </div>
    </>
  );
}
