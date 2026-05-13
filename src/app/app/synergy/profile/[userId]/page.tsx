// ── /app/synergy/profile/[userId] — public profile view (read-only) ──
//
// Read-only profile of another user. Routes here from inbox cards,
// room headers, public feed cards, and any other "their identity"
// link. Auth gate lives in /api/synergy/profiles/[userId] which
// returns:
//   - profile (display_name + bio + avatar_url) when caller has any
//     relationship: match_pending | match_accepted | shared_room |
//     public_only
//   - 403 with no body when caller has no relationship
//
// CTA varies by relationship:
//   - match_pending  → "Open inbox" (the request is waiting)
//   - match_accepted → "Open shared room" (deep-link to room)
//   - shared_room    → "Open shared room" (deep-link)
//   - public_only    → "Send connection request" (matches a public
//                      component → opens request modal-equivalent)

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  ArrowLeft,
  Globe,
  Inbox,
  Lock,
  Network,
  Send,
  Sparkles,
  UserCircle2,
} from "lucide-react";

interface PageProps {
  params: Promise<{ userId: string }>;
}

interface Profile {
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

type Relationship =
  | "self"
  | "match_pending"
  | "match_accepted"
  | "shared_room"
  | "public_only"
  | "none";

export default async function SynergyOtherProfilePage({ params }: PageProps) {
  const { userId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  if (userId === user.id) {
    // Self link — always go to the canonical /profile route.
    redirect("/app/synergy/profile");
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Inline the same gate-walking logic as the API route — saves a
  // server-to-server fetch on this page mount + lets us hydrate
  // related context (the room id for the deep-link CTA) in parallel.

  let relationship: Relationship = "none";

  const [matchRes, roomsRes, publicCountRes] = await Promise.all([
    db
      .from("match_requests")
      .select("status")
      .or(
        `and(from_user.eq.${user.id},to_user.eq.${userId}),and(from_user.eq.${userId},to_user.eq.${user.id})`,
      )
      .in("status", ["pending", "accepted"])
      .limit(5),
    db
      .from("synergy_rooms")
      .select("id")
      .or(
        `and(user_a.eq.${user.id},user_b.eq.${userId}),and(user_a.eq.${userId},user_b.eq.${user.id})`,
      )
      .order("created_at", { ascending: false })
      .limit(1),
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("visibility", "public"),
  ]);

  const matchStatuses = new Set(
    ((matchRes.data ?? []) as Array<{ status: string }>).map((r) => r.status),
  );
  const roomId = ((roomsRes.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  const publicCount = (publicCountRes.count as number | null) ?? 0;

  if (matchStatuses.has("accepted")) relationship = "match_accepted";
  else if (matchStatuses.has("pending")) relationship = "match_pending";
  else if (roomId) relationship = "shared_room";
  else if (publicCount > 0) relationship = "public_only";

  if (relationship === "none") {
    return (
      <NotAuthorized />
    );
  }

  const { data: profileRow } = await db
    .from("synergy_profiles")
    .select("display_name, bio, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  const profile = (profileRow ?? null) as Profile | null;
  if (!profile) {
    return <ProfileMissing />;
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-2 text-sm text-gray-600 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
          <UserCircle2 className="h-3 w-3 text-blue-600" /> Profile
        </div>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-8">
        <div className="flex items-start gap-5">
          <div className="inline-flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-blue-700 ring-1 ring-blue-200">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={`${profile.display_name} avatar`}
                className="h-full w-full object-cover"
              />
            ) : (
              <UserCircle2 className="h-10 w-10" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              {profile.display_name}
            </h1>
            <RelationshipBadge relationship={relationship} />
            {profile.bio ? (
              <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
                {profile.bio}
              </p>
            ) : (
              <p className="mt-3 text-[12px] italic text-gray-500">
                (no bio)
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-5">
          <RelationshipCta relationship={relationship} roomId={roomId} />
        </div>
      </section>

      <p className="mt-4 text-center text-[11px] text-gray-500">
        You&apos;re seeing this profile because of an active{" "}
        <strong>{relationshipLabel(relationship)}</strong> relationship.
        Other identity surfaces stay private.
      </p>
    </div>
  );
}

function RelationshipBadge({ relationship }: { relationship: Relationship }) {
  const meta = {
    self: { icon: UserCircle2, label: "you", className: "bg-gray-100 text-gray-700" },
    match_pending: {
      icon: Inbox,
      label: "match pending",
      className: "bg-amber-100 text-amber-700",
    },
    match_accepted: {
      icon: Sparkles,
      label: "match accepted",
      className: "bg-emerald-100 text-emerald-700",
    },
    shared_room: {
      icon: Network,
      label: "shared room member",
      className: "bg-blue-100 text-blue-700",
    },
    public_only: {
      icon: Globe,
      label: "public component",
      className: "bg-purple-100 text-purple-700",
    },
    none: { icon: Lock, label: "no relationship", className: "bg-gray-100 text-gray-500" },
  }[relationship];
  const Icon = meta.icon;
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function RelationshipCta({
  relationship,
  roomId,
}: {
  relationship: Relationship;
  roomId: string | null;
}) {
  if (relationship === "match_pending") {
    return (
      <Link
        href="/app/synergy/requests"
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
      >
        <Inbox className="h-3.5 w-3.5" /> Open inbox
      </Link>
    );
  }
  if (
    (relationship === "match_accepted" || relationship === "shared_room") &&
    roomId
  ) {
    return (
      <Link
        href={`/app/synergy/room/${roomId}`}
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
      >
        <Sparkles className="h-3.5 w-3.5" /> Open shared room
      </Link>
    );
  }
  if (relationship === "match_accepted" || relationship === "shared_room") {
    // Edge case: relationship says accepted/shared_room but no roomId
    // (data drift). Fall through to a soft toast-like hint.
    return (
      <span className="text-[12px] italic text-gray-500">
        Shared room not yet provisioned. Check your inbox.
      </span>
    );
  }
  if (relationship === "public_only") {
    return (
      <Link
        href="/app/synergy/discover"
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
      >
        <Send className="h-3.5 w-3.5" /> Browse matches & request
      </Link>
    );
  }
  return null;
}

function relationshipLabel(r: Relationship): string {
  return {
    self: "self",
    match_pending: "pending request",
    match_accepted: "accepted match",
    shared_room: "shared room",
    public_only: "public-component",
    none: "no",
  }[r];
}

function NotAuthorized() {
  return (
    <div className="mx-auto max-w-md py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <Lock className="mx-auto mb-3 h-6 w-6 text-gray-400" />
        <h1 className="text-lg font-semibold text-gray-900">
          Profile not visible
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
          You don&apos;t have an active relationship with this user yet.
          They&apos;ll need to accept (or send) a connection request before
          their profile reveals.
        </p>
        <Link
          href="/app/synergy/discover"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          Browse matches
        </Link>
      </div>
    </div>
  );
}

function ProfileMissing() {
  return (
    <div className="mx-auto max-w-md py-16">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        This user hasn&apos;t set up a Synergy profile yet.
      </div>
    </div>
  );
}
