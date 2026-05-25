// ── /app/objective — Objective Canvas landing ──
//
// New whiteboard-first brainstorm flow. Renders the empty canvas with
// a centered entry card (Phase 1 — placeholder for now). Existing
// objective canvases (space_kind='objective_canvas') are listed
// inline when they exist.
//
// Route map (Objective Canvas module):
//   /app/objective                              — landing / list + entry card
//   /app/objective/[spaceId]                    — canvas for one objective
//   /app/objective/[spaceId]/sub/[subId]        — sub-objective room (Phase 5)
//
// Designed as a thin route shim around <ObjectiveCanvasModule />, so
// the same module can later be embedded in the middle panel of the
// 3-panel layout (Phase 10).

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { ArrowRight, Plus, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface ObjectiveCanvasRow {
  id: string;
  name: string | null;
  updated_at: string;
}

export default async function ObjectiveCanvasLandingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Spaces with space_kind='objective_canvas' (column lands in Phase 1
  // migration). Until then the query may error on the missing column —
  // we soft-fall back to an empty list so the page still renders.
  let canvases: ObjectiveCanvasRow[] = [];
  const tagged = await db
    .from("spaces")
    .select("id, name, updated_at")
    .eq("user_id", user.id)
    .eq("archived", false)
    .eq("space_kind", "objective_canvas")
    .order("updated_at", { ascending: false })
    .limit(24);
  if (!tagged.error) {
    canvases = (tagged.data ?? []) as ObjectiveCanvasRow[];
  }

  // Landing intentionally has a plain background — the "whiteboard"
  // texture kicks in when the user clicks Start, signaling they've
  // entered the canvas surface.
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{ background: "#fafafa" }}
    >
      <HomeTabNav />

      <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-24">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div
            className="mx-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] font-medium uppercase tracking-wider"
            style={{
              background: "rgba(15,23,42,0.04)",
              color: "rgba(15,23,42,0.55)",
              border: "1px solid rgba(15,23,42,0.06)",
            }}
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.75} />
            Objective Canvas
          </div>
          <h1
            className="mt-4 text-[40px] font-semibold tracking-tight"
            style={{ color: "rgba(15,23,42,0.92)", letterSpacing: "-0.02em" }}
          >
            What are you working on?
          </h1>
          <p
            className="mx-auto mt-2 max-w-xl text-[14.5px] font-light"
            style={{ color: "rgba(15,23,42,0.55)" }}
          >
            Start with an objective. We&rsquo;ll refine it through a few
            questions, propose sub-objectives, and unfurl them on a whiteboard.
          </p>
        </div>

        {/* Placeholder entry card — Phase 1 replaces this with the
            tldraw-mounted objective-entry-card-shape. */}
        <Link
          href="/app/objective/new"
          className="group mx-auto flex max-w-2xl items-center justify-between rounded-3xl p-6 transition-all hover:-translate-y-0.5"
          style={{
            background: "white",
            border: "1px solid rgba(15,23,42,0.08)",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 32px -16px rgba(11,18,40,0.18)",
          }}
        >
          <div className="flex items-center gap-4">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{
                background: "rgba(15,23,42,0.92)",
                color: "white",
              }}
            >
              <Plus className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div>
              <div
                className="text-[15px] font-semibold"
                style={{ color: "rgba(15,23,42,0.92)" }}
              >
                Start a new objective
              </div>
              <div
                className="mt-0.5 text-[12px] font-light"
                style={{ color: "rgba(15,23,42,0.55)" }}
              >
                Type your goal · pick Autopilot or Human-in-the-loop · begin
              </div>
            </div>
          </div>
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-1"
            strokeWidth={2}
            style={{ color: "rgba(15,23,42,0.55)" }}
          />
        </Link>

        {/* Recent objective canvases */}
        {canvases.length > 0 && (
          <div className="mx-auto mt-12 max-w-2xl">
            <h2
              className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "rgba(15,23,42,0.45)" }}
            >
              Recent
            </h2>
            <ul className="space-y-2">
              {canvases.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/objective/${c.id}`}
                    className="flex items-center justify-between rounded-2xl px-5 py-3.5 transition-all hover:bg-white"
                    style={{
                      border: "1px solid rgba(15,23,42,0.06)",
                      background: "rgba(255,255,255,0.6)",
                    }}
                  >
                    <span
                      className="text-[13.5px] font-medium"
                      style={{ color: "rgba(15,23,42,0.85)" }}
                    >
                      {c.name || "Untitled objective"}
                    </span>
                    <span
                      className="text-[10.5px] font-light"
                      style={{ color: "rgba(15,23,42,0.45)" }}
                    >
                      {relativeTime(c.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
