// ── /app/library/experiments — Experiments Library ────────────────
//
// Cross-workspace view of every prototype brief the user has
// generated, across every objective canvas. The "research notebook"
// surface — what's planned, what's running, what concluded, what
// got abandoned.
//
// Server route: loads all briefs in a single fan-out, hands off to
// the client view for filtering + status mutation.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import {
  loadExperimentsLibrary,
  type ExperimentCardData,
} from "@/lib/objective-canvas/load-experiments-library";
import { ExperimentsLibraryView } from "@/components/objective/experiments-library-view";

export const dynamic = "force-dynamic";

export default async function ExperimentsLibraryPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let experiments: ExperimentCardData[] = [];
  try {
    experiments = await loadExperimentsLibrary({
      db,
      userId: user.id,
      limit: 200,
    });
  } catch (err) {
    console.warn("[experiments library] load failed:", err);
  }

  if (experiments.length === 0) {
    return (
      <div
        className="fixed inset-0 z-40 overflow-y-auto"
        style={{
          background: "#fafafa",
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.05) 1.1px, transparent 1.1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <div
          className="mx-auto flex min-h-screen max-w-[680px] flex-col items-start justify-center px-8"
          style={{ fontFamily: "var(--font-stack, ui-sans-serif)" }}
        >
          <Link
            href="/app/objective"
            className="mb-8 inline-flex items-center gap-1.5 text-[12px] font-medium"
            style={{ color: "rgba(15,23,42,0.55)" }}
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Back to library
          </Link>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "rgba(15,23,42,0.45)" }}
          >
            Experiments
          </div>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight tracking-tight"
            style={{
              color: "rgba(15,23,42,0.92)",
              letterSpacing: "-0.02em",
            }}
          >
            No experiments yet
          </h1>
          <p
            className="mt-3 max-w-[520px] text-[14.5px] font-light leading-relaxed"
            style={{ color: "rgba(15,23,42,0.65)" }}
          >
            Every prototype brief you design from an open question
            becomes an experiment here. Open a sub-objective, expand
            a variation, click <em>Design experiment</em> on any open
            question — the brief lands in this notebook.
          </p>
          <Link
            href="/app/objective"
            className="mt-8 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold"
            style={{
              background: "rgba(15,23,42,0.92)",
              color: "#fff",
            }}
          >
            Open the library →
          </Link>
        </div>
      </div>
    );
  }

  return <ExperimentsLibraryView experiments={experiments} />;
}
