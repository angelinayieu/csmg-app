import type { AnalysisTier } from "@/lib/tiers";
import type { StructuredDecomposition } from "@/types/analysis";
import type { ScopeResult, DomainExpertResult } from "@/types/orchestration";
import {
  runScopeMapper,
  runDecomposer,
  runStructurer,
  runCritic,
  runAugmenter,
  runWeaver,
  runMetaSynthesizer,
  runDomainExpert,
  runBridgeDiscovery,
} from "./agents";
import type { BridgeDiscoveryResult } from "./agents";

export type EmitFn = (event: string, data: string) => void;

interface PipelineResult {
  spaceData: {
    scope: ScopeResult["spaces"][number];
    raw: string;
    structured: StructuredDecomposition;
  }[];
  weaveResult?: unknown;
  synthesisResult?: unknown;
  externalKnowledge?: DomainExpertResult;
  bridgeDiscovery?: BridgeDiscoveryResult;
}

// ─── Quick Tier: same as current single-pass ───
async function runQuick(
  input: string,
  emit: EmitFn
): Promise<PipelineResult> {
  emit("phase", JSON.stringify({ phase: "decomposing", status: "running" }));
  const raw = await runDecomposer(input);
  emit("phase", JSON.stringify({ phase: "structuring", status: "running" }));
  const structured = await runStructurer(raw);
  emit("phase", JSON.stringify({ phase: "structuring", status: "done" }));

  return {
    spaceData: [
      {
        scope: {
          name: structured.metadata?.name ?? "Analysis",
          prefix: structured.metadata?.space_prefix ?? "C",
          description: structured.metadata?.description ?? "",
          key_concepts: [],
          likely_connects_to: [],
          priority: 1,
        },
        raw,
        structured,
      },
    ],
  };
}

// ─── Standard Tier: decompose + structure + critique + augment ───
async function runStandard(
  input: string,
  emit: EmitFn
): Promise<PipelineResult> {
  // Decompose
  emit("phase", JSON.stringify({ phase: "decomposing", status: "running" }));
  const raw = await runDecomposer(input);

  // Structure
  emit("phase", JSON.stringify({ phase: "structuring", status: "running" }));
  const structured = await runStructurer(raw);
  emit(
    "space_progress",
    JSON.stringify({
      index: 0,
      name: structured.metadata?.name ?? "Analysis",
      phase: "structuring",
      status: "done",
      entityCount: structured.entities?.length ?? 0,
      edgeCount: structured.edges?.length ?? 0,
    })
  );

  // Critique
  emit("phase", JSON.stringify({ phase: "critiquing", status: "running" }));
  let finalStructured = structured;
  try {
    const critique = await runCritic(structured);
    emit("phase", JSON.stringify({ phase: "augmenting", status: "running" }));
    // Augment
    finalStructured = await runAugmenter(structured, critique);
    emit(
      "space_progress",
      JSON.stringify({
        index: 0,
        name: structured.metadata?.name ?? "Analysis",
        phase: "augmenting",
        status: "done",
        entityCount: finalStructured.entities?.length ?? 0,
        edgeCount: finalStructured.edges?.length ?? 0,
        addedEdges:
          (finalStructured.edges?.length ?? 0) -
          (structured.edges?.length ?? 0),
        addedCycles:
          (finalStructured.cycles?.length ?? 0) -
          (structured.cycles?.length ?? 0),
      })
    );
  } catch (err) {
    console.error("Critique/augment failed, using original:", err);
    // Graceful degradation: use original structured data
  }

  // Run Domain Expert in parallel (non-blocking — if it fails, we still return)
  let externalKnowledge: DomainExpertResult | undefined;
  try {
    emit("phase", JSON.stringify({ phase: "external_context", status: "running" }));
    const inputSummary = input.slice(0, 500);
    const domains = (finalStructured.entities ?? [])
      .map((e) => e.layer)
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .slice(0, 5) as string[];
    externalKnowledge = await runDomainExpert(
      `Single space: ${finalStructured.metadata?.name ?? "Analysis"}`,
      inputSummary,
      domains.length > 0 ? domains : ["general"]
    );
    emit("phase", JSON.stringify({ phase: "external_context", status: "done" }));
  } catch (err) {
    console.error("Domain Expert failed (non-critical):", err);
  }

  // Bridge discovery: connect internal ↔ external entities
  let bridgeDiscovery: BridgeDiscoveryResult | undefined;
  if (externalKnowledge && (externalKnowledge.external_entities?.length ?? 0) > 0) {
    try {
      emit("phase", JSON.stringify({ phase: "bridge_discovery", status: "running" }));
      const internalEnts = (finalStructured.entities ?? []).map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description ?? "",
      }));
      const externalEnts = (externalKnowledge.external_entities ?? []).map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description ?? "",
        category: e.category,
      }));
      bridgeDiscovery = await runBridgeDiscovery(internalEnts, externalEnts);
      emit("phase", JSON.stringify({
        phase: "bridge_discovery",
        status: "done",
        bridges: bridgeDiscovery.bridges?.length ?? 0,
      }));
    } catch (err) {
      console.error("Bridge discovery failed (non-critical):", err);
    }
  }

  return {
    spaceData: [
      {
        scope: {
          name: finalStructured.metadata?.name ?? "Analysis",
          prefix: finalStructured.metadata?.space_prefix ?? "C",
          description: finalStructured.metadata?.description ?? "",
          key_concepts: [],
          likely_connects_to: [],
          priority: 1,
        },
        raw,
        structured: finalStructured,
      },
    ],
    externalKnowledge,
    bridgeDiscovery,
  };
}

// ─── Deep Tier: scope + parallel decompose + structure + weave + meta-synth ───
// Optimized for Vercel's 120s timeout:
// - Cap at 3 spaces (not 5-7) to stay within time budget
// - Skip critique/augment (that's Comprehensive tier)
// - Parallel decompose+structure per space
// - Weave + meta-synth at the end
// Time budget: scope(3s) + decompose+structure(30s parallel) + weave(10s) + synth(15s) = ~58s
async function runDeep(
  input: string,
  emit: EmitFn
): Promise<PipelineResult> {
  // Phase 0: Scope mapping — ask for 3-4 spaces max
  emit("phase", JSON.stringify({ phase: "scope", status: "running" }));
  const scope = await runScopeMapper(input);
  // Cap at 3 spaces to stay within time budget
  const spaces = scope.spaces.slice(0, 3);
  emit("phase", JSON.stringify({ phase: "scope", status: "done" }));
  emit(
    "scope_done",
    JSON.stringify({
      spaces: spaces.map((s) => ({ name: s.name, prefix: s.prefix })),
    })
  );

  // Build sibling context for each space
  const siblingContexts = spaces.map((space, i) => {
    const others = spaces
      .filter((_, j) => j !== i)
      .map((s) => `- Space ${s.prefix} "${s.name}": covers ${s.key_concepts.join(", ")}`)
      .join("\n");
    return others;
  });

  // Phase 1: Parallel decompose + structure per space + Domain Expert
  emit("phase", JSON.stringify({ phase: "decomposing", status: "running" }));

  // Agent 7 runs in parallel with decomposition
  const domainExpertPromise = (async (): Promise<DomainExpertResult | undefined> => {
    try {
      emit("phase", JSON.stringify({ phase: "external_context", status: "running" }));
      const inputSummary = input.slice(0, 500);
      const domains = spaces.flatMap((s) => s.key_concepts).slice(0, 8);
      const scopeSummary = spaces.map((s) => `${s.prefix} "${s.name}": ${s.description}`).join("; ");
      const result = await runDomainExpert(scopeSummary, inputSummary, domains);
      emit("phase", JSON.stringify({ phase: "external_context", status: "done" }));
      return result;
    } catch (err) {
      console.error("Domain Expert failed (non-critical):", err);
      return undefined;
    }
  })();

  const spaceResults = await Promise.all(
    spaces.map(async (space, i) => {
      emit(
        "space_progress",
        JSON.stringify({ index: i, name: space.name, prefix: space.prefix, phase: "decomposing", status: "running" })
      );

      try {
        const raw = await runDecomposer(input, space, siblingContexts[i]);
        emit(
          "space_progress",
          JSON.stringify({ index: i, name: space.name, prefix: space.prefix, phase: "structuring", status: "running" })
        );
        const structured = await runStructurer(raw);

        emit(
          "space_progress",
          JSON.stringify({
            index: i,
            name: space.name,
            prefix: space.prefix,
            phase: "done",
            status: "done",
            entityCount: structured.entities?.length ?? 0,
            edgeCount: structured.edges?.length ?? 0,
          })
        );

        return { scope: space, raw, structured };
      } catch (err) {
        console.error(`Space ${i} (${space.name}) failed:`, err);
        emit(
          "space_progress",
          JSON.stringify({ index: i, name: space.name, prefix: space.prefix, phase: "error", status: "done" })
        );
        return null;
      }
    })
  );

  // Filter out failed spaces
  const validResults = spaceResults.filter((r): r is NonNullable<typeof r> => r !== null);

  if (validResults.length === 0) {
    throw new Error("All space decompositions failed");
  }

  // Phase 2: Weave (skip critique/augment — that's Comprehensive tier)
  let weaveResult;
  if (validResults.length > 1) {
    emit("phase", JSON.stringify({ phase: "weaving", status: "running" }));
    try {
      const entitySummaries = validResults.map((r) => ({
        prefix: r.scope.prefix,
        name: r.scope.name,
        entities: (r.structured.entities ?? []).map((e) => ({
          id: e.entity_id,
          name: e.name,
          description: e.description ?? "",
          is_shared_variable: e.is_shared_variable ?? false,
        })),
      }));
      weaveResult = await runWeaver(entitySummaries);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wr = weaveResult as any;
      emit(
        "weave_done",
        JSON.stringify({
          bridges: wr?.bridges?.length ?? 0,
          contradictions: wr?.contradictions?.length ?? 0,
        })
      );
    } catch (err) {
      console.error("Weaving failed:", err);
    }
  }

  // Phase 3: Meta-synthesis
  emit("phase", JSON.stringify({ phase: "synthesizing", status: "running" }));
  let synthesisResult;
  try {
    const metaSummary = buildMetaGraphSummary(validResults, weaveResult);
    synthesisResult = await runMetaSynthesizer(metaSummary);
  } catch (err) {
    console.error("Meta-synthesis failed:", err);
  }
  emit("phase", JSON.stringify({ phase: "synthesizing", status: "done" }));

  // Collect Domain Expert result (should be done by now since it ran in parallel)
  const externalKnowledge = await domainExpertPromise;

  // Bridge discovery between internal and external
  let bridgeDiscovery: BridgeDiscoveryResult | undefined;
  if (externalKnowledge && validResults.length > 0) {
    try {
      emit("phase", JSON.stringify({ phase: "bridge_discovery", status: "running" }));
      const allInternalEntities = validResults.flatMap((r) =>
        (r.structured.entities ?? []).map((e) => ({
          entity_id: `${r.scope.prefix}:${e.entity_id}`,
          name: e.name,
          description: e.description ?? "",
        }))
      );
      const externalEnts = (externalKnowledge.external_entities ?? []).map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description ?? "",
        category: e.category,
      }));
      bridgeDiscovery = await runBridgeDiscovery(allInternalEntities, externalEnts);
      emit("phase", JSON.stringify({
        phase: "bridge_discovery",
        status: "done",
        bridges: bridgeDiscovery.bridges?.length ?? 0,
      }));
    } catch (err) {
      console.error("Bridge discovery failed (non-critical):", err);
    }
  }

  return {
    spaceData: validResults,
    weaveResult,
    synthesisResult,
    externalKnowledge,
    bridgeDiscovery,
  };
}

// ─── Build meta-graph summary for Agent 6 ───
function buildMetaGraphSummary(
  spaces: { scope: ScopeResult["spaces"][number]; structured: StructuredDecomposition }[],
  weaveResult: unknown
): string {
  const spacesSummary = spaces
    .map((s) => {
      const lp = (s.structured.leverage_points ?? []).slice(0, 3);
      const rp = (s.structured.risk_points ?? []).slice(0, 3);
      const cycles = (s.structured.cycles ?? []).slice(0, 3);
      return `Space ${s.scope.prefix} "${s.scope.name}" (${s.structured.entities?.length ?? 0} entities, ${s.structured.edges?.length ?? 0} edges, ${s.structured.cycles?.length ?? 0} cycles)
  Top leverage: ${lp.map((l) => `${l.entity_id} ${(l as Record<string, string>).summary ?? (l as Record<string, string>).reason ?? ""}`).join("; ")}
  Top risk: ${rp.map((r) => `${r.entity_id} blast:${r.blast_radius}`).join("; ")}
  Cycles: ${cycles.map((c) => `${c.name} [${c.classification}]`).join("; ")}
  Maturity: ${s.structured.metadata?.maturity ?? "actionable_now"}`;
    })
    .join("\n\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wr = weaveResult as any;
  const bridgesSummary = wr?.bridges
    ? wr.bridges
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => `${b.source_entity_id ?? b.source_space} ↔ ${b.target_entity_id ?? b.target_space}: "${b.shared_variable_name ?? b.description ?? ""}"`)
        .join("\n  ")
    : "None discovered";

  const contradictionsSummary = wr?.contradictions
    ? wr.contradictions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => `${c.assumption ?? c.space_a_assumption} vs. ${c.conclusion ?? c.space_b_conclusion} [${c.severity}]`)
        .join("\n  ")
    : "None found";

  return `SPACES:\n${spacesSummary}\n\nBRIDGES:\n  ${bridgesSummary}\n\nCONTRADICTIONS:\n  ${contradictionsSummary}`;
}

// ─── Main Pipeline Entry Point ───
export async function runPipeline(
  input: string,
  tier: AnalysisTier,
  emit: EmitFn
): Promise<PipelineResult> {
  switch (tier) {
    case "quick":
      return runQuick(input, emit);
    case "standard":
      return runStandard(input, emit);
    case "deep":
    case "comprehensive":
      // Comprehensive = Deep + auto-reasoning (handled at API level after pipeline)
      return runDeep(input, emit);
    default:
      return runQuick(input, emit);
  }
}
