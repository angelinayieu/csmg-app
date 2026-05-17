// ── /app/space/[id]/strategy — canvas-side strategy doc ──
//
// Phase 3 (Canvas unification). The migration target for users
// landing here from the old /app/synergy/[id]/strategy URL (the
// synergy page redirects when migrated_to_space_id is set).
//
// Reuses the existing SynergyStrategy component intact — it
// renders the doc the same way regardless of where the data
// came from. The only difference is the query path:
//   • synergy page: queries by session_id
//   • this page:    queries by space_id (the new synergy_strategies.space_id FK)
//                   PLUS falls back to session_id when no space_id exists yet
//                   (pre-migration legacy rows). Same UUID across both.
//
// Components are read from entities WHERE is_extracted=true (the
// dual-written canvas representation) — falls back to
// brainstorm_components for legacy/un-migrated strategies. The
// shape returned to SynergyStrategy is identical so the renderer
// doesn't care which source we read from.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergyStrategy } from "@/components/synergy/synergy-strategy";
import { SynergySceneBackground } from "@/components/synergy/synergy-scene-background";
import type { ScenePresetKey } from "@/lib/synergy/scene-presets";
import type {
  BrainstormComponent,
  ComponentKind,
  ComponentVisibility,
  StrategyBundle,
  SynergyStrategy as SynergyStrategyRow,
  SynergyStrategyBlock,
} from "@/lib/synergy/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CanvasStrategyPage({ params }: PageProps) {
  const { id: spaceId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Background preset (Tier 3a, same as synergy page).
  let backgroundPreset: ScenePresetKey = "mist";
  let backgroundCustomUrl: string | null = null;
  try {
    const { data: bgProfile } = await db
      .from("synergy_profiles")
      .select("background_preset, background_custom_url")
      .eq("user_id", user.id)
      .maybeSingle();
    if (bgProfile?.background_preset) {
      backgroundPreset = bgProfile.background_preset as ScenePresetKey;
    }
    if (bgProfile?.background_custom_url) {
      backgroundCustomUrl = bgProfile.background_custom_url;
    }
  } catch {
    // bg column missing — default to mist
  }

  // Parallel fetch: space meta, strategy (try space_id then
  // fallback to session_id), extracted entities (canvas
  // representation of components), entity count (the "node count"
  // analog).
  const [spaceRes, strategyByspaceRes, entitiesRes, entityCountRes] =
    await Promise.all([
      db
        .from("spaces")
        .select("id, name, kind")
        .eq("id", spaceId)
        .single(),
      db
        .from("synergy_strategies")
        .select(
          "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
        )
        .eq("space_id", spaceId)
        .maybeSingle(),
      db
        .from("entities")
        .select(
          "id, name, description, private_description, extraction_kind, visibility, created_at",
        )
        .eq("space_id", spaceId)
        .eq("is_extracted", true)
        .order("created_at", { ascending: true }),
      db
        .from("entities")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ]);

  if (spaceRes.error || !spaceRes.data) {
    return (
      <>
        <SynergySceneBackground
          preset={backgroundPreset}
          customUrl={backgroundCustomUrl}
        />
        <div className="mx-auto max-w-4xl py-16">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
            Couldn&apos;t load this space.{" "}
            <Link href="/app" className="underline">
              Back home
            </Link>
          </div>
        </div>
      </>
    );
  }

  const space = spaceRes.data as { id: string; name: string; kind: string };

  // Strategy resolution: prefer the new space_id link; fall back to
  // session_id matching for pre-migration legacy rows (the migration
  // sets BOTH fields, so this lookup-by-session catches strategies
  // that existed before the migration even ran).
  let strategy = (strategyByspaceRes.data ?? null) as SynergyStrategyRow | null;
  if (!strategy) {
    const { data: legacyStrategy } = await db
      .from("synergy_strategies")
      .select(
        "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
      )
      .eq("session_id", spaceId)
      .maybeSingle();
    strategy = legacyStrategy as SynergyStrategyRow | null;
  }

  // Map extracted entities → BrainstormComponent shape so the
  // existing SynergyStrategy renderer doesn't need to know the
  // data came from entities instead of brainstorm_components.
  const extractedEntities = (entitiesRes.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    private_description: string | null;
    extraction_kind: string | null;
    visibility: string;
    created_at: string;
  }>;
  let components: BrainstormComponent[] = extractedEntities.map((e) => ({
    id: e.id,
    kind: extractionKindToComponentKind(e.extraction_kind),
    subkind: null,
    label_public: e.name,
    description_public: e.description ?? "",
    description_private: e.private_description ?? "",
    visibility: e.visibility as ComponentVisibility,
    created_at: e.created_at,
  }));

  // Fallback: pre-migration legacy spaces (or sessions whose
  // entity-side write didn't take) — read directly from
  // brainstorm_components by the same UUID.
  if (components.length === 0) {
    const { data: legacyComponents } = await db
      .from("brainstorm_components")
      .select(
        "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
      )
      .eq("session_id", spaceId)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: true });
    components = (legacyComponents ?? []) as BrainstormComponent[];
  }

  // Blocks for the current generation.
  let blocks: SynergyStrategyBlock[] = [];
  if (strategy?.current_generation_id) {
    const { data } = await db
      .from("synergy_strategy_blocks")
      .select("id, block_type, body, sort_order, meta, created_at")
      .eq("strategy_id", strategy.id)
      .eq("generation_id", strategy.current_generation_id)
      .order("sort_order", { ascending: true });
    blocks = (data ?? []) as SynergyStrategyBlock[];
  }

  const bundle: StrategyBundle = { strategy, blocks, components };
  const currentNodes = entityCountRes.count ?? 0;

  return (
    <>
      <SynergySceneBackground
        preset={backgroundPreset}
        customUrl={backgroundCustomUrl}
      />
      <SynergyStrategy
        // Passing spaceId as sessionId — the IDs are the same UUID
        // post-migration, so downstream regenerate/edit calls that
        // hit /api/synergy/sessions/[id] still resolve correctly
        // against the brainstorm_nodes rows that weren't moved.
        sessionId={spaceId}
        sessionTitle={space.name}
        initialBundle={bundle}
        initialNodeCount={currentNodes}
      />
    </>
  );
}

// extraction_kind on the entities table mirrors brainstorm_components.kind
// except upstream/downstream got fuller names (see migration-helpers.ts).
// This maps back to the BrainstormComponent.kind enum the renderer expects.
function extractionKindToComponentKind(
  kind: string | null,
): ComponentKind {
  switch (kind) {
    case "core_idea":
      return "core_idea";
    case "upstream_dependency":
      return "upstream";
    case "downstream_output":
      return "downstream";
    case "polished_product":
      return "polished_product";
    default:
      return "core_idea";
  }
}
