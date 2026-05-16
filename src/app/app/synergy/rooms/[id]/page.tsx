// ── /app/synergy/rooms/[id] — Room dispatcher ──
//
// Catches both kinds of rooms by ID:
//   - room_kind = 'collaboration'  → 307 redirect to /app/synergy/room/[id]
//     (the existing collab room URL, untouched in Phase 5)
//   - room_kind = 'parallel_path'   → render the parallel-room interior
//
// 404 if the room doesn't exist OR the caller isn't a member.
// Forbidden cases (not a member) also surface as 404 to avoid leaking
// "room exists" to non-members.

import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergySceneBackground } from "@/components/synergy/synergy-scene-background";
import type { ScenePresetKey } from "@/lib/synergy/scene-presets";
import { loadParallelRoomBundle } from "./parallel-room-bundle";
import { ParallelRoomClient } from "@/components/synergy/parallel-room/parallel-room-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RoomDispatcherPage({ params }: PageProps) {
  const { id: roomId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Probe the room shape first so we know whether to dispatch
  // or hand off to the parallel-room bundle loader ──
  const { data: probe } = await db
    .from("synergy_rooms")
    .select("id, room_kind, user_a, user_b")
    .eq("id", roomId)
    .maybeSingle();
  if (!probe) notFound();
  if (probe.user_a !== user.id && probe.user_b !== user.id) notFound();

  // Collaboration rooms: redirect to the existing collab room URL
  if (probe.room_kind === "collaboration") {
    redirect(`/app/synergy/room/${roomId}`);
  }

  // Parallel-path rooms: load full bundle + render
  const bundle = await loadParallelRoomBundle(db, roomId, user.id);
  if (!bundle) notFound();

  // Scene background preference (same soft-fail pattern as /rooms)
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
    // Migration not applied yet — default mist.
  }

  return (
    <>
      <SynergySceneBackground
        preset={backgroundPreset}
        customUrl={backgroundCustomUrl}
      />
      <div className="mx-auto max-w-[920px] py-10">
        <ParallelRoomClient bundle={bundle} />
      </div>
    </>
  );
}
