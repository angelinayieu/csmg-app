// ── /app/synergy/[id]/strategy — Strategy Doc page ──
//
// Server component: pre-hydrates strategy + blocks + components +
// session-meta in parallel. Auth is enforced by the parent /app
// layout's redirect. If no strategy has been generated, the client
// renders an empty-state CTA.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SynergyStrategy } from "@/components/synergy/synergy-strategy";
import { SynergySceneBackground } from "@/components/synergy/synergy-scene-background";
import type { ScenePresetKey } from "@/lib/synergy/scene-presets";
import type {
  BrainstormComponent,
  StrategyBundle,
  SynergyStrategy as SynergyStrategyRow,
  SynergyStrategyBlock,
} from "@/lib/synergy/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SynergyStrategyPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── User's chosen scene background (Tier 3a) ──
  // Same query the Rooms page uses. Soft-fail if the column hasn't been
  // migrated yet (20260811) — falls back to the default 'mist' preset.
  // The strategy doc's frosted-glass panel (Tier 1) was specifically
  // designed to let backdrop bleed through; wiring the scene here is
  // what makes it actually feel translucent.
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
    // Migration 20260811 not applied — quietly default to mist
  }

  const [sessionRes, strategyRes, componentsRes, nodeCountRes] = await Promise.all([
    db
      .from("brainstorm_sessions")
      .select("id, title, last_extracted_at, last_extracted_node_count")
      .eq("id", id)
      .single(),
    db
      .from("synergy_strategies")
      .select(
        "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
      )
      .eq("session_id", id)
      .maybeSingle(),
    db
      .from("brainstorm_components")
      .select(
        "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
      )
      .eq("session_id", id)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: true }),
    db
      .from("brainstorm_nodes")
      .select("id", { count: "exact", head: true })
      .eq("session_id", id),
  ]);

  if (sessionRes.error || !sessionRes.data) {
    return (
      <>
        <SynergySceneBackground
          preset={backgroundPreset}
          customUrl={backgroundCustomUrl}
        />
        <div className="mx-auto max-w-4xl py-16">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
            Couldn&apos;t load this brainstorm.{" "}
            <Link href="/app/synergy" className="underline">
              Back to brainstorms
            </Link>
          </div>
        </div>
      </>
    );
  }

  const session = sessionRes.data as {
    id: string;
    title: string;
    last_extracted_at: string | null;
    last_extracted_node_count: number | null;
  };
  const strategy = (strategyRes.data ?? null) as SynergyStrategyRow | null;
  const components = (componentsRes.data ?? []) as BrainstormComponent[];

  // Pull blocks only when a current generation exists.
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

  // ── Re-extraction staleness signal ──
  // Surface a soft banner when the board has grown materially since
  // the last extraction, or when last_extracted_at is > 7 days old.
  const currentNodes = nodeCountRes.count ?? 0;
  const lastNodes = session.last_extracted_node_count ?? 0;
  const lastExtractedAt = session.last_extracted_at
    ? new Date(session.last_extracted_at).getTime()
    : 0;
  const growthRatio = lastNodes > 0 ? (currentNodes - lastNodes) / lastNodes : 0;
  const ageDays =
    lastExtractedAt > 0 ? (Date.now() - lastExtractedAt) / 86_400_000 : 0;
  const reextractAdvised =
    components.length > 0 && (growthRatio > 0.3 || ageDays > 7);

  return (
    <>
      {/* ── Tier 3a: scene-aware backdrop ──
          Renders the user's chosen atmosphere (one of 7 presets or a
          custom upload) as a fixed inset-0 -z-10 layer behind page
          content. The frosted-glass strategy panel built in Tier 1
          (bg-white/85 + backdrop-blur-2xl) was specifically designed
          to let this bleed through — the panel reads as a floating
          pane over the user's chosen scene rather than a solid card
          on an empty page. */}
      <SynergySceneBackground
        preset={backgroundPreset}
        customUrl={backgroundCustomUrl}
      />
      <SynergyStrategy
        sessionId={id}
        sessionTitle={session.title}
        initialBundle={bundle}
        initialNodeCount={currentNodes}
        reextractAdvised={reextractAdvised}
        lastExtractedNodeCount={lastNodes}
        lastExtractedAt={session.last_extracted_at}
      />
    </>
  );
}
