// ── /app/synergy/[id]/process — processing page ──
//
// Server component: pre-hydrates the session, its node count, any
// previously-extracted components, and any cached promise scores so
// the client doesn't have to fetch on mount. Auth is enforced by the
// parent /app/layout.tsx redirect.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergyProcessing } from "@/components/synergy/synergy-processing";
import type {
  BrainstormComponent,
  BrainstormSession,
  PromiseScore,
} from "@/lib/synergy/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SynergyProcessPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Phase 3 — migration redirect. The legacy "process" page is
  // subsumed by the canvas's Final Products drawer + selection
  // popover, so migrated sessions skip straight to the whiteboard.
  const { data: migrationRow } = await db
    .from("brainstorm_sessions")
    .select("migrated_to_space_id")
    .eq("id", id)
    .maybeSingle();
  if (migrationRow?.migrated_to_space_id) {
    redirect(`/app/space/${migrationRow.migrated_to_space_id}/whiteboard`);
  }

  // Run the four reads in parallel — session, node count, components,
  // cached scores. Components + scores have RLS-gated owner reads.
  const [sessionRes, nodeCountRes, componentsRes, scoresRes] = await Promise.all([
    db.from("brainstorm_sessions").select("*").eq("id", id).single(),
    db
      .from("brainstorm_nodes")
      .select("id", { count: "exact", head: true })
      .eq("session_id", id),
    db
      .from("brainstorm_components")
      .select(
        "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
      )
      .eq("session_id", id)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: true }),
    db
      .from("brainstorm_node_scores")
      .select("node_id, score, why, child_count")
      .eq("session_id", id)
      .order("score", { ascending: false }),
  ]);

  if (sessionRes.error || !sessionRes.data) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          Couldn&apos;t load this brainstorm. It may have been deleted, or you
          might not have access.{" "}
          <Link href="/app/synergy" className="underline">
            Back to brainstorms
          </Link>
        </div>
      </div>
    );
  }

  const session = sessionRes.data as BrainstormSession;
  const nodeCount = nodeCountRes.count ?? 0;
  const components = (componentsRes.data ?? []) as BrainstormComponent[];

  // Cached scores need the node label/kind to render — fetch the
  // matching nodes in a single in() query.
  const cachedScores = (scoresRes.data ?? []) as Array<{
    node_id: string;
    score: number;
    why: string;
    child_count: number;
  }>;
  let initialScores: PromiseScore[] = [];
  if (cachedScores.length > 0) {
    const { data: scoreNodes } = await db
      .from("brainstorm_nodes")
      .select("id, label, kind")
      .in(
        "id",
        cachedScores.map((s) => s.node_id),
      );
    const nodeMap = new Map<string, { label: string; kind: PromiseScore["kind"] }>(
      ((scoreNodes ?? []) as Array<{ id: string; label: string; kind: PromiseScore["kind"] }>)
        .map((n) => [n.id, { label: n.label, kind: n.kind }]),
    );
    initialScores = cachedScores
      .map((s) => {
        const node = nodeMap.get(s.node_id);
        if (!node) return null;
        return { ...s, label: node.label, kind: node.kind };
      })
      .filter((s): s is PromiseScore => s !== null);
  }

  return (
    <SynergyProcessing
      session={session}
      initialNodeCount={nodeCount}
      initialComponents={components}
      initialScores={initialScores}
    />
  );
}
