// ── /app/synergy/room/by-request/[id] — redirect helper ──
//
// Inbox cards link here using the match_request id; we look up the
// associated synergy_rooms row and redirect to its canonical URL.
// Convenient because match requests are what the inbox knows about,
// but the canvas needs the room id.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RoomByRequestPage({ params }: PageProps) {
  const { id: requestId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: room } = await db
    .from("synergy_rooms")
    .select("id")
    .eq("match_request_id", requestId)
    .maybeSingle();

  if (room?.id) {
    redirect(`/app/synergy/room/${room.id}`);
  }

  return (
    <div className="mx-auto max-w-4xl py-16">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Couldn&apos;t find the shared room for that request. The match may have
        been declined, withdrawn, or the room wasn&apos;t created yet.{" "}
        <Link href="/app/synergy/requests" className="underline">
          Back to inbox
        </Link>
      </div>
    </div>
  );
}
