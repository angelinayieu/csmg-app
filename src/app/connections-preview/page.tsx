// ── /connections-preview ──────────────────────────────────────────────
//
// Standalone DIAGNOSTIC surface for the cross-room concept-connection layer
// (`build-concept-clusters` + `/api/objective/[spaceId]/concept-connections`).
// It exists so the dense cross-room fabric is VISIBLE without touching the
// live map views (the parallel session's contested lane) and without forking
// a 4th map engine. Server-rendered via the pure builder — no client fetch,
// no new dependency. Navigate to `/connections-preview` → pick a space.
//
// What it shows: every concept that recurs across ≥2 rooms, the rooms it
// bridges, and the varied phrasings that exact canonical_concept_id keeps
// apart but clustering merges. This is the substrate a real map edge layer
// would render; here it's a readable list so you can judge quality.

import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/embeddings";
import {
  buildConceptClusters,
  type ConceptEntityInput,
} from "@/lib/objective-canvas/build-concept-clusters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEMANTIC_COSINE = 0.84;

export default async function ConnectionsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ spaceId?: string; semantic?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const { spaceId, semantic: semanticParam } = await searchParams;
  const semantic = semanticParam === "1";

  // ── No space selected → picker ────────────────────────────────────
  if (!spaceId) {
    const { data: spaces } = await supabase
      .from("spaces")
      .select("id, description, input_text, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(60);
    const rows = (spaces ?? []) as Array<{
      id: string;
      description: string | null;
      input_text: string | null;
      created_at: string;
    }>;
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-white">Cross-room concept connections</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/60">
          Pick a space to see every concept that recurs across its rooms — the
          dense cross-room fabric that exact-match keeps hidden.
        </p>
        <div className="mt-6 grid gap-2">
          {rows.length === 0 && (
            <p className="text-sm text-white/40">No spaces yet.</p>
          )}
          {rows.map((s) => {
            const label =
              (s.description?.trim() || s.input_text?.trim() || "Untitled space").slice(0, 90);
            return (
              <Link
                key={s.id}
                href={`/connections-preview?spaceId=${s.id}`}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/80 shadow-sm transition hover:border-white/25 hover:bg-white/[0.06]"
              >
                {label}
              </Link>
            );
          })}
        </div>
      </Shell>
    );
  }

  // ── Ownership gate ────────────────────────────────────────────────
  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id, description, input_text")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || (space as { user_id: string }).user_id !== user.id) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-white">Not found</h1>
        <BackLink />
      </Shell>
    );
  }
  const spaceLabel =
    ((space as { description: string | null }).description?.trim() ||
      (space as { input_text: string | null }).input_text?.trim() ||
      "Untitled space");

  // ── Load room entities + room titles ──────────────────────────────
  const { data: entityRows } = await supabase
    .from("entities")
    .select("id, name, parent_sub_objective_id, canonical_concept_id")
    .eq("space_id", spaceId)
    .not("parent_sub_objective_id", "is", null);
  const { data: roomRows } = await supabase
    .from("improvement_goals")
    .select("id, title")
    .eq("space_id", spaceId);

  const roomTitle = new Map<string, string>();
  for (const r of (roomRows ?? []) as Array<{ id: string; title: string }>) {
    roomTitle.set(r.id, r.title ?? "Untitled room");
  }

  const rawEntities = (entityRows ?? []) as Array<{
    id: string;
    name: string;
    parent_sub_objective_id: string | null;
    canonical_concept_id: string | null;
  }>;
  const nameById = new Map<string, { name: string; roomId: string | null }>();
  for (const e of rawEntities) {
    nameById.set(e.id, { name: e.name, roomId: e.parent_sub_objective_id });
  }

  const entities: ConceptEntityInput[] = rawEntities.map((r) => ({
    id: r.id,
    name: r.name,
    roomId: r.parent_sub_objective_id,
    canonicalConceptId: r.canonical_concept_id,
  }));

  // Opt-in semantic merge (embedding cosine). Soft-fails to lexical.
  let semanticApplied = false;
  let entitiesForBuild = entities;
  if (semantic && entities.length > 0 && entities.length <= 800) {
    try {
      const vectors = await embedTexts(entities.map((e) => e.name));
      if (Array.isArray(vectors) && vectors.length === entities.length) {
        entitiesForBuild = entities.map((e, i) => ({ ...e, embedding: vectors[i] }));
        semanticApplied = true;
      }
    } catch {
      // soft-fail → lexical
    }
  }

  const result = buildConceptClusters(
    entitiesForBuild,
    semanticApplied ? { cosineThreshold: SEMANTIC_COSINE } : {},
  );
  const crossRoom = result.clusters.filter((c) => c.crossRoom);

  return (
    <Shell>
      <BackLink />
      <h1 className="mt-2 text-2xl font-semibold text-white">{spaceLabel}</h1>
      <p className="mt-1 text-sm text-white/50">Cross-room concept connections</p>

      {/* Lexical (verified default) ↔ Semantic (opt-in, embedding cosine). */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-white/40">Matching:</span>
        <Link
          href={`/connections-preview?spaceId=${spaceId}`}
          className={
            "rounded-full px-3 py-1 transition " +
            (!semantic
              ? "bg-white/10 text-white"
              : "text-white/45 hover:text-white/80")
          }
        >
          Lexical
        </Link>
        <Link
          href={`/connections-preview?spaceId=${spaceId}&semantic=1`}
          className={
            "rounded-full px-3 py-1 transition " +
            (semantic
              ? "bg-sky-400/15 text-sky-100"
              : "text-white/45 hover:text-white/80")
          }
        >
          Semantic{semantic && !semanticApplied ? " (unavailable)" : ""}
        </Link>
      </div>

      {/* Stat strip — lead with the result. */}
      <div className="mt-5 flex flex-wrap gap-3">
        <Stat n={crossRoom.length} label="cross-room concepts" accent />
        <Stat n={result.stats.connections} label="connections" />
        <Stat n={result.stats.entities} label="room entities" />
        <Stat n={result.stats.clusters} label="total concepts" />
      </div>

      {crossRoom.length === 0 ? (
        <p className="mt-8 max-w-xl text-sm text-white/50">
          No concepts recur across rooms in this space yet. (New rooms link to
          canonical concepts at generation time; regenerate a room, or this
          space&apos;s concepts are genuinely distinct.)
        </p>
      ) : (
        <div className="mt-6 grid gap-3">
          {crossRoom.map((c) => {
            const members = c.memberIds
              .map((id) => nameById.get(id))
              .filter((m): m is { name: string; roomId: string | null } => !!m);
            return (
              <div
                key={c.clusterId}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_2px_20px_-8px_rgba(0,0,0,0.5)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-medium text-white">{c.label}</h3>
                  <span className="shrink-0 text-xs text-white/40">
                    spans {c.roomIds.length} rooms · {members.length} variants
                  </span>
                </div>

                {/* Rooms this concept bridges. */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.roomIds.map((rid) => (
                    <span
                      key={rid}
                      className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-xs text-sky-100/90"
                    >
                      {roomTitle.get(rid) ?? "room"}
                    </span>
                  ))}
                </div>

                {/* The varied phrasings clustering merged. */}
                {members.length > 1 && (
                  <ul className="mt-3 space-y-1 border-t border-white/5 pt-3">
                    {members.map((m, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-white/55">
                        <span className="text-white/25">{roomTitle.get(m.roomId ?? "") ?? "—"}</span>
                        <span className="text-white/30">·</span>
                        <span>{m.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-8 text-xs text-white/30">
        Deterministic clustering (canonical id · exact name · shared wording ·
        contained phrase). Upgrade to embeddings to also catch synonyms that
        share no words.
      </p>
    </Shell>
  );
}

// ── Presentational bits ────────────────────────────────────────────

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b0d12] px-6 py-10">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div
      className={
        "rounded-xl border px-4 py-3 " +
        (accent
          ? "border-sky-400/30 bg-sky-400/10"
          : "border-white/10 bg-white/[0.03]")
      }
    >
      <div className={"text-xl font-semibold " + (accent ? "text-sky-100" : "text-white")}>
        {n}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/connections-preview" className="text-xs text-white/40 hover:text-white/70">
      ← all spaces
    </Link>
  );
}
