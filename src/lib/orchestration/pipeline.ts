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
import { withTimeout, logTimeoutEvent } from "./timeouts";
import { buildAllCappedSiblingContexts } from "./context-capping";

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
  const raw = await runDecomposer(input, undefined, undefined, "quick");
  emit("phase", JSON.stringify({ phase: "structuring", status: "running" }));
  const structured = await runStructurer(raw, "quick");
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
  const raw = await runDecomposer(input, undefined, undefined, "standard");

  // Structure
  emit("phase", JSON.stringify({ phase: "structuring", status: "running" }));
  const structured = await runStructurer(raw, "standard");
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
    // ✅ PHASE 2.3: Add timeout for critique phase
    const critiqueResult = await withTimeout(
      runCritic(structured),
      20000, // 20s for critique
      "Critique phase"
    );

    if (critiqueResult.success) {
      const critique = critiqueResult.data;
      emit("phase", JSON.stringify({ phase: "augmenting", status: "running" }));

      // ✅ PHASE 2.3: Add timeout for augment phase
      const augmentResult = await withTimeout(
        runAugmenter(structured, critique),
        15000, // 15s for augment
        "Augment phase"
      );

      if (augmentResult.success) {
        finalStructured = augmentResult.data;
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
      } else {
        console.warn(`Augment phase timeout/error: ${augmentResult.error}, using original structured`);
      }
    } else {
      console.warn(`Critique phase timeout/error: ${critiqueResult.error}, skipping augment`);
    }
  } catch (err) {
    console.error("Critique/augment exception, using original:", err);
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

  // ✅ PHASE 2.5: Build sibling context with size capping (max 50KB per space)
  // Previous: Unbounded concatenation up to 270KB+
  // Now: Relevance-based filtering + size cap prevents token inflation
  const siblingContextResults = buildAllCappedSiblingContexts(spaces);
  const siblingContexts = siblingContextResults.map((r) => r.context);

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
        // ✅ PHASE 2.3: Add per-space timeout (prevent cascading failure)
        // Each space gets 25s max (3 spaces × 25s = 75s within 120s Vercel limit)
        const spaceTimeout = 25000;

        // Decompose with timeout
        const decomposeResult = await withTimeout(
          runDecomposer(input, space, siblingContexts[i], "deep"),
          20000, // 20s for decomposition phase
          `Space ${i} decomposition`
        );

        if (!decomposeResult.success) {
          logTimeoutEvent(i, space.name, "decomposition", decomposeResult);
          emit(
            "space_progress",
            JSON.stringify({
              index: i,
              name: space.name,
              prefix: space.prefix,
              phase: "error",
              status: "failed",
              error: decomposeResult.error,
            })
          );
          return null;
        }

        const raw = decomposeResult.data;

        emit(
          "space_progress",
          JSON.stringify({ index: i, name: space.name, prefix: space.prefix, phase: "structuring", status: "running" })
        );

        // Structure with timeout
        const structureResult = await withTimeout(
          runStructurer(raw, "deep"),
          10000, // 10s for structuring phase
          `Space ${i} structuring`
        );

        if (!structureResult.success) {
          logTimeoutEvent(i, space.name, "structuring", structureResult);
          emit(
            "space_progress",
            JSON.stringify({
              index: i,
              name: space.name,
              prefix: space.prefix,
              phase: "error",
              status: "failed",
              error: structureResult.error,
            })
          );
          return null;
        }

        const structured = structureResult.data;

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

  // ✅ PHASE 2.4: Parallel critique + augment phase (40s sequential → 20s parallel)
  // Each space runs its critique/augment concurrently with per-space timeouts
  const critiquedResults = await Promise.all(
    validResults.map(async (result, i) => {
      try {
        emit(
          "space_progress",
          JSON.stringify({
            index: i,
            name: result.scope.name,
            prefix: result.scope.prefix,
            phase: "critiquing",
            status: "running",
          })
        );

        // Critique with timeout (20s per space)
        const critiqueResult = await withTimeout(
          runCritic(result.structured),
          20000,
          `Space ${i} critique`
        );

        if (!critiqueResult.success) {
          console.warn(
            `Space ${i} (${result.scope.name}) critique timeout/error: ${critiqueResult.error}`
          );
          emit(
            "space_progress",
            JSON.stringify({
              index: i,
              name: result.scope.name,
              prefix: result.scope.prefix,
              phase: "critiquing",
              status: "degraded",
              error: "Critique timeout - using original",
            })
          );
          // Return original structured data if critique fails
          return result;
        }

        const critique = critiqueResult.data;

        emit(
          "space_progress",
          JSON.stringify({
            index: i,
            name: result.scope.name,
            prefix: result.scope.prefix,
            phase: "augmenting",
            status: "running",
          })
        );

        // Augment with timeout (10s per space)
        const augmentResult = await withTimeout(
          runAugmenter(result.structured, critique),
          10000,
          `Space ${i} augment`
        );

        if (augmentResult.success) {
          emit(
            "space_progress",
            JSON.stringify({
              index: i,
              name: result.scope.name,
              prefix: result.scope.prefix,
              phase: "augmenting",
              status: "done",
              entityCount: augmentResult.data.entities?.length ?? 0,
              edgeCount: augmentResult.data.edges?.length ?? 0,
              addedEdges:
                (augmentResult.data.edges?.length ?? 0) -
                (result.structured.edges?.length ?? 0),
              addedCycles:
                (augmentResult.data.cycles?.length ?? 0) -
                (result.structured.cycles?.length ?? 0),
            })
          );
          // Return augmented structure
          return { ...result, structured: augmentResult.data };
        } else {
          console.warn(
            `Space ${i} (${result.scope.name}) augment timeout/error: ${augmentResult.error}`
          );
          emit(
            "space_progress",
            JSON.stringify({
              index: i,
              name: result.scope.name,
              prefix: result.scope.prefix,
              phase: "augmenting",
              status: "degraded",
              error: "Augment timeout - using original",
            })
          );
          // Return original if augment fails
          return result;
        }
      } catch (err) {
        console.error(`Space ${i} (${result.scope.name}) critique/augment exception:`, err);
        emit(
          "space_progress",
          JSON.stringify({
            index: i,
            name: result.scope.name,
            prefix: result.scope.prefix,
            phase: "error",
            status: "degraded",
            error: "Critique/augment exception",
          })
        );
        return result;
      }
    })
  );

  // Phase 2: Weave (connects spaces after critique/augment)
  let weaveResult;
  if (critiquedResults.length > 1) {
    emit("phase", JSON.stringify({ phase: "weaving", status: "running" }));
    try {
      const entitySummaries = critiquedResults.map((r) => ({
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
    const metaSummary = buildMetaGraphSummary(critiquedResults, weaveResult);
    synthesisResult = await runMetaSynthesizer(metaSummary);
  } catch (err) {
    console.error("Meta-synthesis failed:", err);
  }
  emit("phase", JSON.stringify({ phase: "synthesizing", status: "done" }));

  // Collect Domain Expert result (should be done by now since it ran in parallel)
  const externalKnowledge = await domainExpertPromise;

  // Bridge discovery between internal and external
  let bridgeDiscovery: BridgeDiscoveryResult | undefined;
  if (externalKnowledge && critiquedResults.length > 0) {
    try {
      emit("phase", JSON.stringify({ phase: "bridge_discovery", status: "running" }));
      const allInternalEntities = critiquedResults.flatMap((r) =>
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
    spaceData: critiquedResults,
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
