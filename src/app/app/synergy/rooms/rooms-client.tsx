// ── Synergy Rooms — client composition ──
//
// Three sections, each rendered as a responsive grid:
//   1. Pending invitations (incoming match requests — anonymous, top priority)
//   2. Active rooms (already-accepted, both users revealed)
//   3. Suggested rooms (my room-ready components — components with matches
//      that haven't been initiated yet)
//
// Visual language is intentionally restrained:
//   - White cards on neutral gray-50 background
//   - Subtle border + double-shadow (Apple-style)
//   - No gradients on backgrounds or buttons
//   - Single accent color (blue-600) used sparingly
//   - Lucide icons, no emojis
//   - Generous whitespace, type at 13-15px, mono microcopy at 10px tracking 0.15em
//
// Filters live as Apple-style pill toggles at the top.

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Inbox,
  Lightbulb,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { abstractAvatarFor } from "@/lib/synergy/abstract-avatar";
import type {
  ActiveRoom,
  Invitation,
  RoomsBundle,
  SuggestedRoom,
} from "./rooms-types";

type TabKey = "all" | "active" | "invitations" | "suggested";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "invitations", label: "Invitations" },
  { key: "active", label: "Active" },
  { key: "suggested", label: "Suggested" },
];

export function SynergyRoomsClient({ bundle }: { bundle: RoomsBundle }) {
  const [tab, setTab] = useState<TabKey>("all");

  const showInvitations = tab === "all" || tab === "invitations";
  const showActive = tab === "all" || tab === "active";
  const showSuggested = tab === "all" || tab === "suggested";

  const totalCount =
    bundle.invitations.length + bundle.active.length + bundle.suggested.length;

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-8 flex items-center justify-between">
        <nav className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            const count =
              t.key === "invitations"
                ? bundle.invitations.length
                : t.key === "active"
                  ? bundle.active.length
                  : t.key === "suggested"
                    ? bundle.suggested.length
                    : undefined;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition",
                  active
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100",
                ].join(" ")}
              >
                {t.label}
                {count !== undefined && count > 0 && (
                  <span
                    className={[
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px]",
                      active ? "bg-white/15 text-white" : "bg-gray-100 text-gray-600",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {totalCount > 0 && (
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-gray-500">
            {totalCount} {totalCount === 1 ? "room" : "rooms"}
          </span>
        )}
      </div>

      {/* Empty state */}
      {totalCount === 0 && <EmptyState />}

      {/* Sections */}
      <div className="space-y-12">
        {showInvitations && bundle.invitations.length > 0 && (
          <Section
            label="Pending invitations"
            count={bundle.invitations.length}
            sub="Anonymous senders. Accept to reveal."
            icon={Inbox}
          >
            <Grid>
              {bundle.invitations.map((inv) => (
                <InvitationCard key={inv.id} invitation={inv} />
              ))}
            </Grid>
          </Section>
        )}

        {showActive && bundle.active.length > 0 && (
          <Section
            label="Active rooms"
            count={bundle.active.length}
            sub="Connected. Both sides revealed."
            icon={Users}
          >
            <Grid>
              {bundle.active.map((room) => (
                <ActiveRoomCard key={room.id} room={room} />
              ))}
            </Grid>
          </Section>
        )}

        {showSuggested && bundle.suggested.length > 0 && (
          <Section
            label="Suggested rooms"
            count={bundle.suggested.length}
            sub="Your components with available collaborators."
            icon={Lightbulb}
          >
            <Grid>
              {bundle.suggested.map((s) => (
                <SuggestedRoomCard key={s.id} room={s} />
              ))}
            </Grid>
          </Section>
        )}
      </div>
    </div>
  );
}

// ── Generic section header ──

function Section({
  label,
  count,
  sub,
  icon: Icon,
  children,
}: {
  label: string;
  count: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-5 flex items-baseline gap-3">
        <Icon className="h-4 w-4 self-center text-gray-600" />
        <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
          {label}
        </h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-600">
          {count}
        </span>
        <span className="text-[12px] text-gray-500">— {sub}</span>
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

// ── Empty state ──

function EmptyState() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-8 py-16 text-center">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
        <Sparkles className="h-4 w-4 text-gray-500" />
      </div>
      <h2 className="mt-5 text-[17px] font-semibold tracking-tight text-gray-900">
        No rooms yet
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-gray-500">
        Publish a strategy with matchable components to start surfacing
        collaborators here.
      </p>
      <Link
        href="/app/synergy"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-gray-800"
      >
        Go to brainstorms
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ── Active room card ──

function ActiveRoomCard({ room }: { room: ActiveRoom }) {
  return (
    <Link
      href={`/app/synergy/room/${room.id}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_24px_-8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar
            displayName={room.their_display_name}
            avatarUrl={room.their_avatar_url}
            seed={room.other_user_seed}
            size={32}
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-gray-900">
              {room.their_display_name ?? "Collaborator"}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              Active
            </div>
          </div>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-700">
          Connected
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <ComponentChip label="Yours" text={room.my_component_label} tone="you" />
        <ComponentChip
          label="Theirs"
          text={room.their_component_label}
          tone="them"
        />
      </div>

      {room.intersection_objective && (
        <p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-gray-600">
          {room.intersection_objective}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between text-[11px] text-gray-500">
        <span className="font-mono uppercase tracking-wider">
          {formatRelative(room.created_at)}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-gray-700 transition group-hover:gap-1.5 group-hover:text-gray-900">
          Open
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

// ── Invitation card (anonymous) ──

function InvitationCard({ invitation }: { invitation: Invitation }) {
  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(invitation.expires_at).getTime() - Date.now()) / 86_400_000,
    ),
  );
  return (
    <Link
      href={`/app/synergy/requests?focus=${invitation.id}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_24px_-8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar
            displayName={null}
            avatarUrl={null}
            seed={invitation.seed}
            size={32}
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-gray-900">
              Anonymous sender
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              Pending · {daysLeft}d left
            </div>
          </div>
        </div>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
          New
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <ComponentChip
          label="They offer"
          text={invitation.their_component_label}
          tone="them"
        />
        <ComponentChip
          label="On your"
          text={invitation.my_component_label}
          tone="you"
        />
      </div>

      {invitation.message && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2">
          <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
          <p className="line-clamp-3 text-[11.5px] leading-relaxed text-gray-700">
            {invitation.message}
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-[11px] text-gray-500">
        <span className="font-mono uppercase tracking-wider">
          {formatRelative(invitation.created_at)}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-gray-700 transition group-hover:gap-1.5 group-hover:text-gray-900">
          Respond
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

// ── Suggested room card ──

function SuggestedRoomCard({ room }: { room: SuggestedRoom }) {
  return (
    <Link
      href={`/app/synergy/discover?focus=${room.id}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_24px_-8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
            {KIND_LABEL[room.kind] ?? room.kind}
          </div>
          <h3 className="mt-1 text-[15px] font-semibold leading-tight tracking-tight text-gray-900">
            {room.label_public}
          </h3>
        </div>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
          {room.match_count} match{room.match_count === 1 ? "" : "es"}
        </span>
      </div>

      <p className="mt-3 line-clamp-3 text-[12.5px] leading-relaxed text-gray-600">
        {room.description_public}
      </p>

      <div className="mt-4 flex items-center justify-between text-[11px] text-gray-500">
        <AvatarPeek seed={room.id} count={Math.min(room.match_count, 4)} />
        <span className="inline-flex items-center gap-1 font-medium text-gray-700 transition group-hover:gap-1.5 group-hover:text-gray-900">
          Browse matches
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

const KIND_LABEL: Record<string, string> = {
  core_idea: "Core idea",
  upstream: "Upstream need",
  downstream: "Downstream output",
  polished_product: "Polished product",
};

// ── Component chip (yours / theirs) ──

function ComponentChip({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: "you" | "them";
}) {
  const labelColor = tone === "you" ? "text-blue-700" : "text-gray-700";
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
      <div
        className={`font-mono text-[9px] uppercase tracking-[0.15em] ${labelColor}`}
      >
        {label}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[12px] font-medium leading-snug text-gray-900">
        {text}
      </div>
    </div>
  );
}

// ── Avatar (real photo or abstract fallback) ──

function Avatar({
  displayName,
  avatarUrl,
  seed,
  size,
}: {
  displayName: string | null;
  avatarUrl: string | null;
  seed: string;
  size: number;
}) {
  if (avatarUrl) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundImage: `url(${avatarUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          flexShrink: 0,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
        }}
        aria-label={displayName ?? "Collaborator"}
      />
    );
  }
  const av = abstractAvatarFor(seed);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: av.background,
        color: av.textColor,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: size * 0.4,
        letterSpacing: "-0.5px",
        flexShrink: 0,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
      }}
      aria-label="Anonymous collaborator"
    >
      {av.initials}
    </span>
  );
}

function AvatarPeek({ seed, count }: { seed: string; count: number }) {
  if (count === 0) return <span />;
  return (
    <div className="flex -space-x-2">
      {Array.from({ length: count }).map((_, i) => (
        <Avatar
          key={i}
          displayName={null}
          avatarUrl={null}
          seed={`${seed}:${i}`}
          size={22}
        />
      ))}
    </div>
  );
}

// ── Time helpers ──

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}
