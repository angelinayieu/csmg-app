import type { AnalysisTier } from "@/lib/tiers";
import type { StructuredDecomposition } from "@/types/analysis";
import type { ScopeResult } from "@/types/orchestration";
import {
  runScopeMapper,
  runDecomposer,
  runStructurer,
  runCritic,
  runAugmenter,
  runWeaver,
  runMetaSynthesizer,
} from "./agents";

export type EmitFn = (event: string, data: string) => void;

interface PipelineResult {
  spaceData: {
    scope: ScopeResult["spaces"][number];
    raw: string;
    structured: StructuredDecomposition;
  }[];
  weaveResult?: unknown;
  synthesisResult?: unknown;
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
  };
}

// ─── Deep Tier: scope + parallel decompose + critique/augment + weave + meta-synth ───
async function runDeep(
  input: string,
  emit: EmitFn
): Promise<PipelineResult> {
  // Phase 0: Scope mapping
  emit("phase", JSON.stringify({ phase: "scope", status: "running" }));
  const scope = await runScopeMapper(input);
  emit("phase", JSON.stringify({ phase: "scope", status: "done" }));
  emit(
    "scope_done",
    JSON.stringify({
      spaces: scope.spaces.map((s) => ({ name: s.name, prefix: s.prefix })),
    })
  );

  // Build sibling context for each space
  const siblingContexts = scope.spaces.map((space, i) => {
    const others = scope.spaces
      .filter((_, j) => j !== i)
      .map((s) => `- Space ${s.prefix} "${s.name}": covers ${s.key_concepts.join(", ")}`)
      .join("\n");
    return others;
  });

  // Phase 1+2: Parallel decompose + structure per space
  emit("phase", JSON.stringify({ phase: "decomposing", status: "running" }));
  const spaceResults = await Promise.all(
    scope.spaces.map(async (space, i) => {
      emit(
        "space_progress",
        JSON.stringify({ index: i, name: space.name, prefix: space.prefix, phase: "decomposing", status: "running" })
      );

      const raw = await runDecomposer(input, space, siblingContexts[i]);
      const structured = await runStructurer(raw);

      emit(
        "space_progress",
        JSON.stringify({
          index: i,
          name: space.name,
          prefix: space.prefix,
          phase: "structuring",
          status: "done",
          entityCount: structured.entities?.length ?? 0,
          edgeCount: structured.edges?.length ?? 0,
        })
      );

      return { scope: space, raw, structured };
    })
  );

  // Phase 3: Parallel critique + augment
  emit("phase", JSON.stringify({ phase: "critiquing", status: "running" }));
  const augmentedResults = await Promise.all(
    spaceResults.map(async (result, i) => {
      try {
        const critique = await runCritic(result.structured);
        const augmented = await runAugmenter(result.structured, critique);

        emit(
          "space_progress",
          JSON.stringify({
            index: i,
            name: result.scope.name,
            prefix: result.scope.prefix,
            phase: "augmenting",
            status: "done",
            entityCount: augmented.entities?.length ?? 0,
            edgeCount: augmented.edges?.length ?? 0,
            addedEdges:
              (augmented.edges?.length ?? 0) -
              (result.structured.edges?.length ?? 0),
            addedCycles:
              (augmented.cycles?.length ?? 0) -
              (result.structured.cycles?.length ?? 0),
          })
        );

        return { ...result, structured: augmented };
      } catch (err) {
        console.error(`Critique/augment failed for space ${i}:`, err);
        emit(
          "space_progress",
          JSON.stringify({
            index: i,
            name: result.scope.name,
            prefix: result.scope.prefix,
            phase: "done",
            status: "done",
            entityCount: result.structured.entities?.length ?? 0,
            edgeCount: result.structured.edges?.length ?? 0,
          })
        );
        return result; // Graceful degradation
      }
    })
  );

  // Phase 4: Weave
  emit("phase", JSON.stringify({ phase: "weaving", status: "running" }));
  let weaveResult;
  try {
    const entitySummaries = augmentedResults.map((r) => ({
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

  // Phase 5: Meta-synthesis
  emit("phase", JSON.stringify({ phase: "synthesizing", status: "running" }));
  let synthesisResult;
  try {
    const metaSummary = buildMetaGraphSummary(augmentedResults, weaveResult);
    synthesisResult = await runMetaSynthesizer(metaSummary);
  } catch (err) {
    console.error("Meta-synthesis failed:", err);
  }
  emit("phase", JSON.stringify({ phase: "synthesizing", status: "done" }));

  return {
    spaceData: augmentedResults,
    weaveResult,
    synthesisResult,
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
