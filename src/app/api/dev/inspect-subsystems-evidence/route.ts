import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import {
  buildSkeletons,
  mergeOverlapping,
  rankAndCap,
  enrichWithLLM,
} from "@/lib/subsystems/extract";
import {
  loadChainEvidenceBundles,
  collectChainEntityIds,
} from "@/lib/causal-chains/evidence-bundles";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { Subsystem } from "@/types/subsystems";
import type { ChainEvidenceBundles } from "@/types/evidence-bundles";

export const maxDuration = 120;

interface RequestBody {
  spaceId?: string;
  /** Skip the LLM naming pass — returns deterministic-only subsystems with stub names. Cheaper. */
  skipLlmEnrichment?: boolean;
  /** Restrict bundle inspection to one chain. When omitted, processes all causal chains. */
  chainId?: string;
}

interface InspectionMeta {
  has_synthesis_data: boolean;
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  causal_chain_count: number;
  evidence_row_count_total: number;
  evidence_row_count_eligible: number;
  evidence_with_attached_entity: number;
}

interface SubsystemInspection {
  skeleton_count: number;
  after_merge_count: number;
  after_cap_count: number;
  skipped_llm_enrichment: boolean;
  final: Subsystem[];
}

interface ChainBundleInspection {
  chain_id: string;
  chain_name: string;
  chain_entity_ids: string[];
  bundle: ChainEvidenceBundles;
}

export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const parsed = await safeJsonParse<RequestBody>(request);
  if (parsed.error) return parsed.error;
  const { spaceId, skipLlmEnrichment = false, chainId } = parsed.data ?? {};
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  if (!(await verifySpaceOwnership(db, spaceId, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const [
      { data: spaceRow },
      { data: entityRows },
      { data: edgeRows },
      { data: cycleRows },
      { data: evidenceRows },
    ] = await Promise.all([
      db.from("spaces").select("synthesis_data").eq("id", spaceId).single(),
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db
        .from("evidence_registries")
        .select("id, status, attached_entity_id")
        .eq("space_id", spaceId),
    ]);

    const synthData =
      typeof spaceRow?.synthesis_data === "string"
        ? (JSON.parse(spaceRow.synthesis_data) as SynthesisData)
        : (spaceRow?.synthesis_data as SynthesisData | null);

    const entities = (entityRows ?? []) as Entity[];
    const edges = (edgeRows ?? []) as Edge[];
    const cycles = (cycleRows ?? []) as Cycle[];
    const evidence =
      (evidenceRows ?? []) as Array<{
        id: string;
        status: string;
        attached_entity_id: string | null;
      }>;

    const meta: InspectionMeta = {
      has_synthesis_data: synthData !== null,
      entity_count: entities.length,
      edge_count: edges.length,
      cycle_count: cycles.length,
      causal_chain_count: synthData?.causal_chains?.length ?? 0,
      evidence_row_count_total: evidence.length,
      evidence_row_count_eligible: evidence.filter(
        (r) => r.status === "extracted" || r.status === "reviewed",
      ).length,
      evidence_with_attached_entity: evidence.filter(
        (r) =>
          r.attached_entity_id !== null &&
          (r.status === "extracted" || r.status === "reviewed"),
      ).length,
    };

    let subsystems: SubsystemInspection | { skipped: string };
    if (!synthData) {
      subsystems = { skipped: "no_synthesis_data" };
    } else {
      const skeletons = buildSkeletons({
        synthesis: synthData,
        entities,
        edges,
        cycles,
      });
      const merged = mergeOverlapping(skeletons);
      const capped = rankAndCap(merged);
      const final = skipLlmEnrichment
        ? capped.map((skel, i) => ({
            id: `sub_${skel.kind}_${i + 1}`,
            kind: skel.kind,
            name: `${skel.kind.replace("_", " ")} ${i + 1}`,
            level: skel.level,
            constituent_entities: skel.constituent_entities,
            constituent_edges: skel.constituent_edges,
            constituent_cycles: skel.constituent_cycles,
            constituent_axioms: skel.constituent_axioms,
            evidence_links: [],
            seed: skel.seed,
            composition_confidence: skel.structural_value,
            structural_value: skel.structural_value,
            contracts: { does: "", needs: "", produces: "" },
            rationale: "(LLM enrichment skipped)",
            generated_at: new Date().toISOString(),
          }))
        : await enrichWithLLM(capped, entities);
      subsystems = {
        skeleton_count: skeletons.length,
        after_merge_count: merged.length,
        after_cap_count: capped.length,
        skipped_llm_enrichment: skipLlmEnrichment,
        final,
      };
    }

    const chainsToInspect = (synthData?.causal_chains ?? []).filter(
      (c) => !chainId || c.id === chainId,
    );
    const evidence_bundles_per_chain: ChainBundleInspection[] = [];
    for (const chain of chainsToInspect) {
      const bundle = await loadChainEvidenceBundles(db, spaceId, chain);
      evidence_bundles_per_chain.push({
        chain_id: chain.id,
        chain_name: chain.name,
        chain_entity_ids: collectChainEntityIds(chain),
        bundle,
      });
    }

    return NextResponse.json({
      spaceId,
      meta,
      subsystems,
      evidence_bundles_per_chain,
      summary: buildHumanSummary(meta, subsystems, evidence_bundles_per_chain),
    });
  } catch (err) {
    console.error("[dev/inspect-subsystems-evidence] failed:", err);
    return NextResponse.json(
      { error: `Inspection failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

function buildHumanSummary(
  meta: InspectionMeta,
  subsystems: SubsystemInspection | { skipped: string },
  bundles: ChainBundleInspection[],
): string[] {
  const lines: string[] = [];
  lines.push(
    `Space: ${meta.entity_count} entities, ${meta.edge_count} edges, ${meta.cycle_count} cycles, ${meta.causal_chain_count} causal chains.`,
  );
  lines.push(
    `Evidence: ${meta.evidence_row_count_total} total rows, ${meta.evidence_row_count_eligible} eligible (extracted|reviewed), ${meta.evidence_with_attached_entity} attached to an entity.`,
  );

  if ("skipped" in subsystems) {
    lines.push(`Subsystems: skipped — ${subsystems.skipped}.`);
  } else {
    lines.push(
      `Subsystems pipeline: ${subsystems.skeleton_count} skeletons → ${subsystems.after_merge_count} after merge → ${subsystems.after_cap_count} after cap → ${subsystems.final.length} final${subsystems.skipped_llm_enrichment ? " (LLM enrichment skipped)" : ""}.`,
    );
    const byKind = new Map<string, number>();
    for (const s of subsystems.final) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    if (byKind.size > 0) {
      lines.push(
        `  by kind: ${[...byKind.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
      );
    }
  }

  if (bundles.length === 0) {
    lines.push(`Evidence bundles: no causal chains to inspect.`);
  } else {
    let chainsWithAnyEvidence = 0;
    let totalBundles = 0;
    let totalUncovered = 0;
    for (const c of bundles) {
      if (c.bundle.bundles.length > 0) chainsWithAnyEvidence++;
      totalBundles += c.bundle.bundles.length;
      totalUncovered += c.bundle.uncovered_entity_ids.length;
    }
    lines.push(
      `Evidence bundles: ${bundles.length} chain(s) inspected, ${chainsWithAnyEvidence} have ≥1 bundle. Total bundles: ${totalBundles}. Uncovered entity references: ${totalUncovered}.`,
    );
  }

  return lines;
}
