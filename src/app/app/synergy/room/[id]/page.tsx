// ── /app/synergy/room/[id] — shared co-edit room ──
//
// Server-pre-hydrates the room bundle (room metadata + both anchor
// components + the OTHER user's profile + all nodes). Auth +
// membership is enforced by the GET endpoint's RLS gates.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { SynergyRoomBundle } from "@/lib/synergy/room-client";

const SynergyRoomCanvas = dynamic(
  () =>
    import("@/components/synergy/synergy-room-canvas").then(
      (m) => m.SynergyRoomCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading shared room…
        </div>
      </div>
    ),
  },
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SynergyRoomPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Same shape as the GET endpoint produces. We compute it server-side
  // to avoid a client-side fetch flash on first paint.
  const { data: room } = await db
    .from("synergy_rooms")
    .select(
      "id, user_a, user_b, component_a, component_b, intersection_objective, archived_at, created_at",
    )
    .eq("id", id)
    .single();

  if (!room) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          Couldn&apos;t load this room. It may have been deleted, or you might
          not be a member.{" "}
          <Link href="/app/synergy/requests" className="underline">
            Back to inbox
          </Link>
        </div>
      </div>
    );
  }

  const otherUserId = room.user_a === user.id ? room.user_b : room.user_a;

  const [componentsRes, profileRes, nodesRes] = await Promise.all([
    db
      .from("brainstorm_components")
      .select("id, kind, subkind, label_public, description_public")
      .in("id", [room.component_a, room.component_b]),
    db
      .from("synergy_profiles")
      .select("user_id, display_name, bio, avatar_url")
      .eq("user_id", otherUserId)
      .maybeSingle(),
    db
      .from("synergy_room_nodes")
      .select(
        "id, room_id, author_id, parent_id, kind, label, meta, x, y, created_at, updated_at",
      )
      .eq("room_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const components = (componentsRes.data ?? []) as Array<{
    id: string;
    kind: string;
    subkind: string | null;
    label_public: string;
    description_public: string;
  }>;
  const myComponentId =
    room.user_a === user.id ? room.component_a : room.component_b;
  const myComponent = components.find((c) => c.id === myComponentId) ?? null;
  const theirComponent =
    components.find((c) => c.id !== myComponentId) ?? null;

  const bundle: SynergyRoomBundle = {
    room: {
      id: room.id,
      user_a: room.user_a,
      user_b: room.user_b,
      intersection_objective: room.intersection_objective,
      archived_at: room.archived_at,
      created_at: room.created_at,
      i_am: room.user_a === user.id ? "a" : "b",
    },
    my_component: myComponent,
    their_component: theirComponent,
    their_profile: profileRes.data ?? null,
    nodes: (nodesRes.data ?? []) as SynergyRoomBundle["nodes"],
  };

  return <SynergyRoomCanvas bundle={bundle} />;
}
