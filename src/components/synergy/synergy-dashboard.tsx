// ── Synergy dashboard — the new /app home ──
//
// Server component. Pulls everything in parallel: profile (for
// greeting), recent brainstorms, pending-incoming matches, accepted
// rooms, latest strategy doc. Composes the page with ambient bg +
// hero + sections + dock.
//
// Privacy-respectful: only the caller's own data; no cross-user reads
// beyond the matches API (which is already redacted).

import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  ArrowRight,
  ChevronRight,
  CircleDot,
  Compass,
  FileText,
  Inbox,
  Layers,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { SynergyAmbientBg } from "@/components/synergy/synergy-ambient-bg";
import { SynergyDashboardHero } from "@/components/synergy/synergy-dashboard-hero";
import { SynergyGlassDock } from "@/components/synergy/synergy-glass-dock";
import { BlankWhiteboardButton } from "@/components/synergy/blank-whiteboard-button";
import { firstNameFromProfile, timeGreeting } from "@/lib/synergy/greeting";

interface RecentSession {
  id: string;
  title: string;
  updated_at: string;
  node_count: number;
}

interface RecentStrategy {
  id: string;
  session_id: string;
  statement: string | null;
  updated_at: string;
}

interface RecentRoom {
  id: string;
  user_a: string;
  user_b: string;
  other_display_name: string | null;
  created_at: string;
}

export async function SynergyDashboard() {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Parallel fetches — everything the dashboard needs in one shot.
  const [profileRes, sessionsRes, strategiesRes, roomsRes, pendingRes] =
    await Promise.all([
      db
        .from("synergy_profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      db
        .from("brainstorm_sessions")
        .select("id, title, updated_at")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(3),
      db
        .from("synergy_strategies")
        .select("id, session_id, statement, updated_at")
        .order("updated_at", { ascending: false })
        .limit(2),
      db
        .from("synergy_rooms")
        .select("id, user_a, user_b, created_at")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(3),
      db
        .from("match_requests")
        .select("id", { count: "exact", head: true })
        .eq("to_user", user.id)
        .eq("status", "pending"),
    ]);

  // Hydrate node counts for the recent brainstorms (one query, not N+1)
  const sessionRows = (sessionsRes.data ?? []) as Array<{
    id: string;
    title: string;
    updated_at: string;
  }>;
  const recentSessions: RecentSession[] = await Promise.all(
    sessionRows.map(async (s) => {
      const { count } = await db
        .from("brainstorm_nodes")
        .select("id", { count: "exact", head: true })
        .eq("session_id", s.id);
      return { ...s, node_count: count ?? 0 };
    }),
  );

  // Hydrate the OTHER user's display_name for each room
  const roomRows = (roomsRes.data ?? []) as Array<{
    id: string;
    user_a: string;
    user_b: string;
    created_at: string;
  }>;
  const otherIds = Array.from(
    new Set(
      roomRows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a)),
    ),
  );
  const profileMap = new Map<string, string>();
  if (otherIds.length > 0) {
    const { data: profiles } = await db
      .from("synergy_profiles")
      .select("user_id, display_name")
      .in("user_id", otherIds);
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      display_name: string;
    }>) {
      profileMap.set(p.user_id, p.display_name);
    }
  }
  const recentRooms: RecentRoom[] = roomRows.map((r) => ({
    ...r,
    other_display_name:
      profileMap.get(r.user_a === user.id ? r.user_b : r.user_a) ?? null,
  }));

  const recentStrategies = (strategiesRes.data ?? []) as RecentStrategy[];
  const pendingIncoming = pendingRes.count ?? 0;

  const greeting = timeGreeting(new Date());
  const firstName = firstNameFromProfile(
    profileRes.data?.display_name ?? null,
    user.email ?? null,
  );

  return (
    <>
      <SynergyAmbientBg />
      <main className="relative z-10 min-h-screen pb-32">
        <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
          {/* ── Hero ── */}
          <SynergyDashboardHero greeting={greeting} firstName={firstName} />

          {/* ── Your workspace ──
              Universal-canvas Phase C. A single canvas where every
              brainstorm / strategy / R&D space / twin the user has
              touched accumulates as a room. The pill bar's submits
              route through here too — the workspace is the canonical
              home. */}
          <div className="mt-12">
            <Link
              href="/app/workspace"
              className="group block rounded-3xl border border-white/60 bg-white/60 px-6 py-5 backdrop-blur-xl transition hover:bg-white/80"
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.7), 0 8px 22px -10px rgba(15,23,42,0.10)",
              }}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-900 to-gray-700 text-white">
                  <Compass className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="flex-1">
                  <p className="font-display-tight text-[15px] font-semibold tracking-tight text-gray-900">
                    Open your workspace
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">
                    Your home canvas — every brainstorm, strategy, R&D
                    space, and twin you&rsquo;ve made lives here as a room
                    you can compose.
                  </p>
                </div>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-700"
                  strokeWidth={1.75}
                />
              </div>
            </Link>
          </div>

          {/* ── Start a blank whiteboard / Distill your thoughts ──
              Two clean entry points sitting side-by-side:
              - Blank whiteboard: visual surface (sticky notes, arrows,
                lasso → AI insight).
              - Distill: text dump → 4-layer cascade (Concepts →
                Clusters → Ranked Insights → Main Idea). For when the
                user wants converging answers, not a free-form board. */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BlankWhiteboardButton />
            <Link
              href="/app/distill"
              className="group block rounded-3xl border border-white/60 bg-white/60 px-6 py-5 backdrop-blur-xl transition hover:bg-white/80"
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.7), 0 8px 22px -10px rgba(15,23,42,0.10)",
              }}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                  <Target className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="flex-1">
                  <p className="font-display-tight text-[15px] font-semibold tracking-tight text-gray-900">
                    Distill your thoughts
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">
                    Dump your text. Watch it fold into concepts, clusters,
                    ranked insights, and one main idea.
                  </p>
                </div>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-700"
                  strokeWidth={1.75}
                />
              </div>
            </Link>
          </div>

          {/* ── Recent brainstorms ── */}
          {recentSessions.length > 0 && (
            <SectionHeader
              icon={Layers}
              label="Pick up where you left off"
              linkLabel="All brainstorms"
              linkHref="/app/synergy"
              className="mt-16"
            />
          )}
          {recentSessions.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/app/synergy/${s.id}`}
                    className="group block h-full"
                  >
                    <DashboardGlassCard
                      icon={Layers}
                      iconTone="from-blue-500 to-blue-500"
                      title={s.title || "Untitled"}
                      meta={`${s.node_count} ${s.node_count === 1 ? "node" : "nodes"} · ${formatRelative(s.updated_at)}`}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* ── Connections ── */}
          <SectionHeader
            icon={Users}
            label="Connections"
            linkLabel="Discover all matches"
            linkHref="/app/synergy/discover"
            className="mt-12"
          />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link href="/app/synergy/requests" className="group block">
              <DashboardGlassCard
                icon={Inbox}
                iconTone="from-rose-500 to-orange-500"
                title={
                  pendingIncoming > 0
                    ? `${pendingIncoming} new connection ${pendingIncoming === 1 ? "request" : "requests"}`
                    : "No new requests"
                }
                meta={
                  pendingIncoming > 0
                    ? "Profiles reveal only after you accept."
                    : "Browse matches to start one."
                }
                badge={pendingIncoming > 0 ? `${pendingIncoming}` : null}
              />
            </Link>
            <Link href="/app/synergy/discover" className="group block">
              <DashboardGlassCard
                icon={Compass}
                iconTone="from-purple-500 to-violet-500"
                title="Find collaborators"
                meta="Components from other users that complement yours."
              />
            </Link>
          </div>

          {/* ── Active rooms ── */}
          {recentRooms.length > 0 && (
            <>
              <SectionHeader
                icon={Sparkles}
                label="Active synergy rooms"
                className="mt-12"
              />
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {recentRooms.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/app/synergy/room/${r.id}`}
                      className="group block h-full"
                    >
                      <DashboardGlassCard
                        icon={Sparkles}
                        iconTone="from-emerald-500 to-teal-500"
                        title={`with ${r.other_display_name ?? "(loading)"}`}
                        meta={`Opened ${formatRelative(r.created_at)}`}
                        live
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* ── Living strategies ── */}
          <SectionHeader
            icon={FileText}
            label="Living strategies"
            className="mt-12"
          />
          {recentStrategies.length === 0 ? (
            <Link href="/app/strategy/new" className="group block">
              <div
                className="mt-4 flex items-center gap-4 rounded-2xl p-5 transition hover:-translate-y-0.5"
                style={{
                  background: "rgba(255, 255, 255, 0.55)",
                  backdropFilter: "blur(24px) saturate(180%)",
                  WebkitBackdropFilter: "blur(24px) saturate(180%)",
                  border: "1px dashed rgba(99, 102, 241, 0.3)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 8px 24px -8px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
                  <FileText className="h-5 w-5 text-white" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">
                    No strategies yet — generate one from a prompt
                  </div>
                  <p className="text-[12px] text-gray-600">
                    A living strategy doc — statement, plan, risks, hypotheses,
                    upstream needs, downstream products. Refine inline.
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
            </Link>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recentStrategies.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/app/synergy/${s.session_id}/strategy`}
                    className="group block h-full"
                  >
                    <DashboardGlassCard
                      icon={FileText}
                      iconTone="from-indigo-500 to-purple-500"
                      title={s.statement ?? "Untitled strategy"}
                      meta={`Edited ${formatRelative(s.updated_at)}`}
                    />
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/app/strategy/new" className="group block h-full">
                  <DashboardGlassCard
                    icon={Sparkles}
                    iconTone="from-violet-500 to-fuchsia-500"
                    title="Generate from a prompt"
                    meta="Skip the brainstorm. Draft the full strategy directly."
                    dashed
                  />
                </Link>
              </li>
            </ul>
          )}
        </div>

        {/* ── Dock ── */}
        <SynergyGlassDock />
      </main>
    </>
  );
}

// ── Section header ──

function SectionHeader({
  icon: Icon,
  label,
  linkLabel,
  linkHref,
  className = "",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  linkLabel?: string;
  linkHref?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-blue-600" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-600">
          {label}
        </span>
      </div>
      {linkHref && linkLabel && (
        <Link
          href={linkHref}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-gray-500 transition hover:text-blue-700"
        >
          {linkLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

// ── Glass card (shared) ──

function DashboardGlassCard({
  icon: Icon,
  iconTone,
  title,
  meta,
  badge,
  live,
  dashed,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconTone: string;
  title: string;
  meta: string;
  badge?: string | null;
  live?: boolean;
  dashed?: boolean;
}) {
  return (
    <div
      className="relative flex h-full items-start gap-3 rounded-2xl p-4 transition duration-300 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.01]"
      style={{
        background: "rgba(255, 255, 255, 0.6)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: dashed
          ? "1px dashed rgba(99, 102, 241, 0.3)"
          : "1px solid rgba(255, 255, 255, 0.55)",
        boxShadow: [
          "inset 0 1px 0 rgba(255, 255, 255, 0.65)",
          "0 1px 2px rgba(15, 23, 42, 0.04)",
          "0 12px 32px -10px rgba(15, 23, 42, 0.1)",
          "0 0 30px -10px rgba(6, 182, 212, 0.18)",
        ].join(", "),
      }}
    >
      <div
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconTone}`}
      >
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
        <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-gray-600">
          {meta}
        </div>
      </div>
      {badge && (
        <span
          className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-semibold text-white"
          style={{ boxShadow: "0 0 0 1.5px rgba(255,255,255,0.92), 0 1px 2px rgba(0,0,0,0.08)" }}
        >
          {badge}
        </span>
      )}
      {live && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider text-emerald-700"
          title="Active room"
        >
          <CircleDot className="h-2.5 w-2.5" />
          live
        </span>
      )}
    </div>
  );
}

// ── Time format helper ──

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Suppress unused Target import — kept for the next polish pass
// where the hero section will add a context-aware action chip.
void Target;
