// ── Space Lab page ──
// Route: /app/space/[id]/lab
//
// Phase 15: whole-space knowledge reactor. Treats the SPACE itself as
// the specimen. Hero entities (leverage points / fundamental / critical)
// become the subunits. Cross-space bridges become the external bonds.
// All reactions in the space render in the footer.
//
// Full-viewport: bypasses SpaceShell so the lab surface is uninterrupted.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpaceLab } from "@/components/lab/space-lab";
import { SplitLab } from "@/components/lab/split-lab";
import type { Entity, Edge, Bridge, Space } from "@/types";
import type { Reaction } from "@/types/reactions";
import type { System } from "@/types/system";

export const dynamic = "force-dynamic";

const HERO_LIMIT = 8;

function isHero(e: Entity): boolean {
  if (e.is_leverage_point || e.is_master_bottleneck) return true;
  const imp = e.importance ?? "moderate";
  return imp === "fundamental" || imp === "critical";
}

/** Pick top hero subunits from an entity set + backfill with high-
 *  confidence entities if too few qualify. Pulled into a helper so
 *  both single-mode and split-mode can compute heroes independently
 *  per side. */
function pickHeroes(pool: Entity[]): Entity[] {
  const heroes = [...pool]
    .filter(isHero)
    .sort((a, b) => {
      const aLev = a.is_leverage_point ? 1 : 0;
      const bLev = b.is_leverage_point ? 1 : 0;
      if (aLev !== bLev) return bLev - aLev;
      const order = ["fundamental", "critical", "important", "moderate"];
      return (
        order.indexOf(a.importance ?? "moderate") -
        order.indexOf(b.importance ?? "moderate")
      );
    })
    .slice(0, HERO_LIMIT);
  if (heroes.length < 3) {
    const heroIds = new Set(heroes.map((h) => h.id));
    const backfill = [...pool]
      .filter((e) => !heroIds.has(e.id))
      .sort(
        (a, b) =>
          ((b.confidence as number) ?? 0) - ((a.confidence as number) ?? 0),
      )
      .slice(0, Math.min(HERO_LIMIT - heroes.length, 4));
    heroes.push(...backfill);
  }
  return heroes;
}

/** Narrow a full entity/edge pair down to a saved system's
 *  composition. Returns the narrowed pair so the lab can scope a
 *  side without mutating the originals. */
function narrowToSystem(
  system: System,
  allEntities: Entity[],
  allEdges: Edge[],
): { entities: Entity[]; edges: Edge[] } {
  const entitySet = new Set(system.entity_ids);
  const edgeSet = new Set(system.edge_ids);
  return {
    entities: allEntities.filter((e) => entitySet.has(e.id)),
    edges: allEdges.filter((e) => edgeSet.has(e.id)),
  };
}

export default async function SpaceLabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // Phase 5 — `?systemId=<uuid>` scopes the lab to a saved System
  // (entities + edges from public.systems narrow the hero pool +
  // reagent bay). Absent → whole-space lab (default).
  // Phase 5 follow-on — `?systemB=<uuid>` pairs a second system for
  // A/B navigation chrome.
  searchParams: Promise<{
    systemId?: string | string[];
    systemB?: string | string[];
  }>;
}) {
  const { id: spaceId } = await params;
  const { systemId: rawSystemId, systemB: rawSystemB } = await searchParams;
  const systemId =
    typeof rawSystemId === "string"
      ? rawSystemId
      : Array.isArray(rawSystemId)
        ? rawSystemId[0]
        : null;
  // Phase 5 (extended) — when `?systemB=<id>` is present alongside
  // `?systemId=<id>`, the user has paired two systems. We don't
  // split the chamber visually (real split-screen is a future
  // pass); instead we surface a "compared with: B" pill in the lab
  // header that lets the user swap which one is currently active.
  const systemBId =
    typeof rawSystemB === "string"
      ? rawSystemB
      : Array.isArray(rawSystemB)
        ? rawSystemB[0]
        : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceData } = await db
    .from("spaces")
    .select("*")
    .eq("id", spaceId)
    .single();
  if (!spaceData) redirect("/app");

  const space = spaceData as Space;

  // Parallel fetch: all entities, all edges, all reactions, cross-space bridges
  const [entitiesRes, edgesRes, reactionsRes, bridgesRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db
      .from("reactions")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(60),
    db
      .from("bridges")
      .select("*")
      .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`),
  ]);

  const allEntities = (entitiesRes.data ?? []) as Entity[];
  const allEdges = (edgesRes.data ?? []) as Edge[];
  const reactions = (reactionsRes.data ?? []) as Reaction[];
  const bridges = (bridgesRes.data ?? []) as Bridge[];

  // ── Phase 5 — narrow to saved System(s) when params present ──
  //
  // Server-side scoping keeps the SpaceLab component oblivious to the
  // System primitive — it receives a smaller `entities`/`edges` array
  // (just the system's contents) and renders identically. The
  // `scopedSystem` prop on SpaceLab drives the "Scoped to: <name>"
  // pill so users understand why the chamber is smaller.
  //
  // Phase 5+ — when BOTH systemId and systemB resolve, render the
  // split-screen comparator (`SplitLab`) instead of single-system
  // mode. Each side gets its own narrowed entities/edges + freshly-
  // computed heroes.
  let scopedSystem: System | null = null;
  let comparedSystem: System | null = null;
  if (systemId) {
    const { data: sysRow, error: sysErr } = await db
      .from("systems")
      .select("*")
      .eq("id", systemId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (sysErr) {
      console.warn("[lab page] system lookup failed:", sysErr);
    } else if (sysRow) {
      const sys = sysRow as System;
      // Belt-and-suspenders ownership check — RLS already enforces.
      if (sys.user_id === user.id) {
        scopedSystem = sys;
      }
    }
  }
  if (systemBId && systemBId !== systemId) {
    const { data: bRow } = await db
      .from("systems")
      .select("*")
      .eq("id", systemBId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (bRow && (bRow as System).user_id === user.id) {
      comparedSystem = bRow as System;
    }
  }

  // Per-side narrowing for split mode. Computed up-front so we can
  // also use side A's narrowed pool as the single-mode `entities`
  // when only one system is in scope (no double work).
  const sideA = scopedSystem
    ? narrowToSystem(scopedSystem, allEntities, allEdges)
    : null;
  const sideB = comparedSystem
    ? narrowToSystem(comparedSystem, allEntities, allEdges)
    : null;

  // Working pool for single-mode rendering — narrowed when scoped,
  // full space otherwise.
  const singleModeEntities = sideA ? sideA.entities : allEntities;
  const singleModeEdges = sideA ? sideA.edges : allEdges;

  // Phase 25: hydrate cross-space partner entities so the reagent bay
  // shows real names ("Customer Lifetime Value" instead of "(cross-space)").
  // Collect every entity_id on the FAR side of each bridge; one IN query.
  // RLS naturally restricts to spaces the user owns — partners outside
  // that envelope just stay synthesized stubs.
  const partnerIds = new Set<string>();
  for (const b of bridges) {
    if (b.source_space_id === spaceId) {
      partnerIds.add(b.target_entity_id);
    } else {
      partnerIds.add(b.source_entity_id);
    }
  }
  let partnerEntities: Entity[] = [];
  if (partnerIds.size > 0) {
    const { data: partnerRows } = await db
      .from("entities")
      .select("*")
      .in("id", Array.from(partnerIds));
    partnerEntities = (partnerRows ?? []) as Entity[];
  }

  // ── Render split-screen when both systems resolved ─────────────
  if (scopedSystem && comparedSystem && sideA && sideB) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-[#06090e] text-[#e8edf4]">
        <SplitLab
          space={space}
          reactions={reactions}
          bridges={bridges}
          partnerEntities={partnerEntities}
          sideA={{
            system: scopedSystem,
            heroes: pickHeroes(sideA.entities),
            entities: sideA.entities,
            edges: sideA.edges,
          }}
          sideB={{
            system: comparedSystem,
            heroes: pickHeroes(sideB.entities),
            entities: sideB.entities,
            edges: sideB.edges,
          }}
        />
      </div>
    );
  }

  // ── Single-system or whole-space render (default) ─────────────
  const heroes = pickHeroes(singleModeEntities);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#06090e] text-[#e8edf4]">
      <SpaceLab
        space={space}
        heroes={heroes}
        entities={singleModeEntities}
        edges={singleModeEdges}
        reactions={reactions}
        bridges={bridges}
        partnerEntities={partnerEntities}
        scopedSystem={scopedSystem}
        comparedSystem={comparedSystem}
      />
    </div>
  );
}
