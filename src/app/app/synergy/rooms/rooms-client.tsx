// ── Synergy Rooms — client composition ──
//
// Top-level structure (Phase 5b):
//
//   [ Collaborations  •  Parallel paths ]   ← segmented control (room kind)
//
//   [ All | Invitations | Active | Suggested ]   ← sub-tabs (same on both kinds)
//
//   ─── Section: matches sub-tab ───
//   Grid of cards specific to the selected kind
//
// The segmented control is the only NEW chrome over the prior version
// of this surface. The existing 4-tab sub-nav is preserved verbatim
// but its data source flips based on which segment is active.
//
// Visual language unchanged: white cards on neutral gray-50 background,
// hairline borders, no gradients on actionable surfaces, single accent
// (gray-900 for primary). Lucide icons, no emojis.

"use client";

import { useMemo, useState } from "react";
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
import type { RoomKind } from "@/lib/synergy/types";
import type {
  ActiveRoom,
  Invitation,
  RoomsBundle,
  SuggestedRoom,
} from "./rooms-types";
import { RoomKindSegmented } from "@/components/synergy/rooms/room-kind-segmented";
import { ParallelSuggestedCard } from "@/components/synergy/rooms/parallel-suggested-card";
import { ParallelInvitationCard } from "@/components/synergy/rooms/parallel-invitation-card";
import { ParallelActiveCard } from "@/components/synergy/rooms/parallel-active-card";
import { ParallelEmptyState } from "@/components/synergy/rooms/parallel-empty-state";

type SubTabKey = "all" | "active" | "invitations" | "suggested";

const SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "invitations", label: "Invitations" },
  { key: "active", label: "Active" },
  { key: "suggested", label: "Suggested" },
];

export function SynergyRoomsClient({ bundle }: { bundle: RoomsBundle }) {
  const [kind, setKind] = useState<RoomKind>("collaboration");
  const [tab, setTab] = useState<SubTabKey>("all");

  // Local optimistic state: after a successful action on a parallel
  // card, we remove it from the rendered list without waiting for a
  // page refresh. Each set holds the IDs that should be hidden.
  const [hiddenParallelSuggested, setHiddenParallelSuggested] = useState<
    Set<string>
  >(new Set());
  const [hiddenParallelInvitations, setHiddenParallelInvitations] = useState<
    Set<string>
  >(new Set());

  const collab = bundle.collab;
  const parallel = bundle.parallel;

  // Counts for the segmented control
  const collabTotal =
    collab.active.length + collab.invitations.length + collab.suggested.length;

  const visibleParallelSuggested = useMemo(
    () => parallel.suggested.filter((s) => !hiddenParallelSuggested.has(s.match_id)),
    [parallel.suggested, hiddenParallelSuggested],
  );
  const visibleParallelInvitations = useMemo(
    () =>
      parallel.invitations.filter(
        (i) => !hiddenParallelInvitations.has(i.request_id),
      ),
    [parallel.invitations, hiddenParallelInvitations],
  );
  const parallelTotal =
    parallel.active.length +
    visibleParallelInvitations.length +
    visibleParallelSuggested.length;

  const showInvitations = tab === "all" || tab === "invitations";
  const showActive = tab === "all" || tab === "active";
  const showSuggested = tab === "all" || tab === "suggested";

  const isParallel = kind === "parallel_path";
  const totalForKind = isParallel ? parallelTotal : collabTotal;
  const parallelEmpty =
    parallelTotal === 0 &&
    parallel.active.length === 0; // even if nothing optimistic-hidden, all 3 sections truly empty

  return (
    <div>
      {/* Top row: segmented control + total summary */}
      <div className="mb-7 flex items-center justify-between gap-4">
        <RoomKindSegmented
          value={kind}
          onChange={(next) => {
            setKind(next);
            // Reset sub-tab to "all" on kind change so the user lands
            // on the overview of the new kind, not whatever they were
            // viewing in the other.
            setTab("all");
          }}
          collabCount={collabTotal}
          parallelCount={parallelTotal}
        />

        {totalForKind > 0 && (
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-gray-500">
            {totalForKind} {totalForKind === 1 ? "room" : "rooms"}
          </span>
        )}
      </div>

      {/* Sub-tab bar */}
      <div className="mb-8 flex items-center justify-between">
        <nav
          className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1"
          aria-label="Section"
        >
          {SUB_TABS.map((t) => {
            const active = tab === t.key;
            const count = isParallel
              ? t.key === "invitations"
                ? visibleParallelInvitations.length
                : t.key === "active"
                  ? parallel.active.length
                  : t.key === "suggested"
                    ? visibleParallelSuggested.length
                    : undefined
              : t.key === "invitations"
                ? collab.invitations.length
                : t.key === "active"
                  ? collab.active.length
                  : t.key === "suggested"
                    ? collab.suggested.length
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
                      active
                        ? "bg-white/15 text-white"
                        : "bg-gray-100 text-gray-600",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Panel — render-content branches on `kind` */}
      {isParallel ? (
        // ── Parallel-path panel ──
        <div
          role="tabpanel"
          id="rooms-panel-parallel_path"
          aria-label="Parallel paths"
        >
          {parallelEmpty &&
          visibleParallelInvitations.length === 0 &&
          visibleParallelSuggested.length === 0 ? (
            <ParallelEmptyState
              myStrategiesCount={parallel.my_strategies_count}
              myMatchablePublishedCount={parallel.my_matchable_published_count}
            />
          ) : (
            <div className="space-y-12">
              {showInvitations && visibleParallelInvitations.length > 0 && (
                <Section
                  label="Pending invitations"
                  count={visibleParallelInvitations.length}
                  sub="Anonymous senders. Accept to open the parallel-path room."
                  icon={Inbox}
                >
                  <Grid>
                    {visibleParallelInvitations.map((inv) => (
                      <ParallelInvitationCard
                        key={inv.request_id}
                        card={inv}
                        onResolved={(id) =>
                          setHiddenParallelInvitations((prev) => {
                            const next = new Set(prev);
                            next.add(id);
                            return next;
                          })
                        }
                      />
                    ))}
                  </Grid>
                </Section>
              )}

              {showActive && parallel.active.length > 0 && (
                <Section
                  label="Active parallel paths"
                  count={parallel.active.length}
                  sub="Pursuing convergent goals via different routines."
                  icon={Users}
                >
                  <Grid>
                    {parallel.active.map((room) => (
                      <ParallelActiveCard key={room.room_id} card={room} />
                    ))}
                  </Grid>
                </Section>
              )}

              {showSuggested && visibleParallelSuggested.length > 0 && (
                <Section
                  label="Suggested parallel paths"
                  count={visibleParallelSuggested.length}
                  sub="People on similar journeys you haven't connected with yet."
                  icon={Lightbulb}
                >
                  <Grid>
                    {visibleParallelSuggested.map((s) => (
                      <ParallelSuggestedCard
                        key={s.match_id}
                        card={s}
                        onSent={(id) =>
                          setHiddenParallelSuggested((prev) => {
                            const next = new Set(prev);
                            next.add(id);
                            return next;
                          })
                        }
                      />
                    ))}
                  </Grid>
                </Section>
              )}
            </div>
          )}
        </div>
      ) : (
        // ── Collaboration panel (existing surface, unchanged) ──
        <div
          role="tabpanel"
          id="rooms-panel-collaboration"
          aria-label="Collaborations"
        >
          {collabTotal === 0 && <CollabEmptyState />}

          <div className="space-y-12">
            {showInvitations && collab.invitations.length > 0 && (
              <Section
                label="Pending invitations"
                count={collab.invitations.length}
                sub="Anonymous senders. Accept to reveal."
                icon={Inbox}
              >
                <Grid>
                  {collab.invitations.map((inv) => (
                    <InvitationCard key={inv.id} invitation={inv} />
                  ))}
                </Grid>
              </Section>
            )}

            {showActive && collab.active.length > 0 && (
              <Section
                label="Active rooms"
                count={collab.active.length}
                sub="Connected. Both sides revealed."
                icon={Users}
              >
                <Grid>
                  {collab.active.map((room) => (
                    <ActiveRoomCard key={room.id} room={room} />
                  ))}
                </Grid>
              </Section>
            )}

            {showSuggested && collab.suggested.length > 0 && (
              <Section
                label="Suggested rooms"
                count={collab.suggested.length}
                sub="Your components with available collaborators."
                icon={Lightbulb}
              >
                <Grid>
                  {collab.suggested.map((s) => (
                    <SuggestedRoomCard key={s.id} room={s} />
                  ))}
                </Grid>
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Generic section header (shared between collab + parallel panels) ──

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

// ── Collab empty state (existing) ──

function CollabEmptyState() {
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

// ── Active collab room card (existing) ──

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

// ── Invitation card (collab — anonymous) ──

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

// ── Suggested collab room card ──

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
