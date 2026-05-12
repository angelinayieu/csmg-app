// ── /app/synergy — sessions list ──
//
// Server-rendered list of the user's brainstorm sessions. Each row
// links to /app/synergy/[id]. "New brainstorm" → /app/synergy/new.
// No nested layout — relies on the parent /app layout's auth + chrome.

import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";

interface ListedSession {
  id: string;
  title: string;
  state: string;
  objective_statement: string | null;
  updated_at: string;
  node_count: number;
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

  const sessionRows = (rows ?? []) as Omit<ListedSession, "node_count">[];

  // Per-session node counts via a single in() query.
  const counts = new Map<string, number>();
  if (sessionRows.length > 0) {
    const { data: nodes } = await db
      .from("brainstorm_nodes")
      .select("session_id")
      .in(
        "session_id",
        sessionRows.map((s) => s.id),
      );
    for (const row of nodes ?? []) {
      counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
    }
  }
  const sessions: ListedSession[] = sessionRows.map((s) => ({
    ...s,
    node_count: counts.get(s.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-600">
            <Sparkles className="h-3 w-3 text-blue-600" /> Synergy
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
            Brainstorms
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Voice-augmented solo boards. Speak, sketch, and let the AI map your
            thinking into upstream needs and downstream outputs.
          </p>
        </div>
        <Link
          href="/app/synergy/new"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          <Plus className="h-4 w-4" />
          New brainstorm
        </Link>
      </header>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-16 text-center">
          <Sparkles className="mx-auto mb-3 h-6 w-6 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            No brainstorms yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Start a board, hit the mic, and start talking. The AI will pull
            structure out of the stream as you go.
          </p>
          <Link
            href="/app/synergy/new"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
          >
            <Plus className="h-4 w-4" /> Start your first brainstorm
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/app/synergy/${s.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-blue-400 hover:shadow-sm"
              >
                <div className="text-sm font-semibold text-gray-900">
                  {s.title}
                </div>
                {s.objective_statement && (
                  <div className="mt-1 line-clamp-2 text-[11px] text-gray-600">
                    {s.objective_statement}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
                  <span>{s.node_count} {s.node_count === 1 ? "node" : "nodes"}</span>
                  <span>·</span>
                  <span>{relativeTime(s.updated_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
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
