// ── /app/synergy — sessions gallery ──
//
// Brainstorm gallery. Each session renders its node positions as a
// schematic SVG thumbnail (see _components/brainstorm-thumbnail.tsx),
// so the page reads as a library of visual artifacts rather than a
// list of titles. Layout: resume-hero tile for the most-recent
// session, then a 3-up grid for the rest. Server-rendered.

import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { SynergyBellBadge } from "@/components/synergy/synergy-bell-badge";
import { BrainstormCard, type BrainstormCardData } from "./_components/brainstorm-card";
import { BrainstormResumeHero } from "./_components/brainstorm-resume-hero";
import type { ThumbnailNode } from "./_components/brainstorm-thumbnail";

interface ListedSessionRow {
  id: string;
  title: string;
  state: string;
  objective_statement: string | null;
  updated_at: string;
}

interface NodeRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  kind: string;
  x: number;
  y: number;
}

export default async function SynergyListPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: rows } = await db
    .from("brainstorm_sessions")
    .select("id, title, state, objective_statement, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  const sessionRows = (rows ?? []) as ListedSessionRow[];

  // Pull node positions for every session in a single in() query so
  // each tile can render a real graph thumbnail. Cap to keep render
  // cost bounded — sessions with hundreds of nodes still read as a
  // dense cluster at thumbnail scale, so we don't need them all.
  const nodesBySession = new Map<string, ThumbnailNode[]>();
  const NODE_CAP_PER_SESSION = 120;
  if (sessionRows.length > 0) {
    const { data: nodes } = await db
      .from("brainstorm_nodes")
      .select("id, session_id, parent_id, kind, x, y")
      .in(
        "session_id",
        sessionRows.map((s) => s.id),
      );
    for (const row of (nodes ?? []) as NodeRow[]) {
      const bucket = nodesBySession.get(row.session_id) ?? [];
      if (bucket.length >= NODE_CAP_PER_SESSION) continue;
      bucket.push({
        id: row.id,
        parent_id: row.parent_id,
        kind: row.kind,
        x: row.x,
        y: row.y,
      });
      if (bucket.length === 1) nodesBySession.set(row.session_id, bucket);
    }
  }

  const sessions: BrainstormCardData[] = sessionRows.map((s) => ({
    ...s,
    nodes: nodesBySession.get(s.id) ?? [],
  }));

  // Hero = most-recent session that already has content. Falls back to
  // most-recent overall (which may be empty — that's fine, the
  // thumbnail well degrades to a soft dotted placeholder).
  const heroIndex = sessions.findIndex((s) => s.nodes.length > 0);
  const hero =
    heroIndex >= 0 ? sessions[heroIndex] : sessions.length > 0 ? sessions[0] : null;
  const heroId = hero?.id;
  const gridSessions = sessions.filter((s) => s.id !== heroId);

  return (
    <div className="relative -mx-6 -my-6 min-h-full overflow-hidden bg-[#fafbfc]">
      {/* Whiteboard dotted surface — same vocabulary as the loader so
          the page feels like a continuation of the same canvas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.055) 1px, transparent 0)",
          backgroundSize: "24px 24px",
          maskImage:
            "linear-gradient(180deg, black 0%, black 80%, rgba(0,0,0,0.7) 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 80%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-8">
        {/* ── Header ───────────────────────────────────────────────── */}
        <header className="mb-6 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider text-slate-500 backdrop-blur-md">
              <Sparkles className="h-3 w-3 text-slate-700" /> Synergy
            </div>
            <h1 className="font-display-tight mt-3 text-[34px] font-semibold leading-tight text-slate-900">
              Brainstorms
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-slate-600">
              Solo boards with voice. Speak or sketch — the AI maps your
              thinking into upstream needs and downstream outputs.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/app/synergy/new"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[0_8px_18px_-10px_rgba(15,23,42,0.5)]"
            >
              <Plus className="h-4 w-4" />
              New brainstorm
            </Link>
          </div>
        </header>

        {/* ── Secondary nav strip ──────────────────────────────────── */}
        <div className="mb-8 flex items-center justify-between border-b border-slate-200/80 pb-3">
          <nav className="flex items-center gap-1">
            <SecondaryNavLink href="/app/synergy" active>
              All
            </SecondaryNavLink>
            <SecondaryNavLink href="/app/synergy/discover">Discover</SecondaryNavLink>
            <SecondaryNavLink href="/app/synergy/feed">Feed</SecondaryNavLink>
            <SecondaryNavLink href="/app/synergy/profile">Profile</SecondaryNavLink>
          </nav>
          <div className="flex items-center gap-2">
            <SynergyBellBadge />
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────── */}
        {sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-10">
            {hero && <BrainstormResumeHero session={hero} />}

            {gridSessions.length > 0 && (
              <section>
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                  Recent
                </h2>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {gridSessions.map((s) => (
                    <li key={s.id}>
                      <BrainstormCard session={s} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SecondaryNavLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white"
          : "rounded-md px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
      }
    >
      {children}
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white/70 p-16 text-center backdrop-blur-md">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)",
          backgroundSize: "16px 16px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 90%)",
        }}
      />
      <div className="relative">
        <Sparkles className="mx-auto mb-3 h-6 w-6 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">
          No brainstorms yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Start a board, hit the mic, and start talking. The AI will pull
          structure out of the stream as you go.
        </p>
        <Link
          href="/app/synergy/new"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" /> Start your first brainstorm
        </Link>
      </div>
    </div>
  );
}
