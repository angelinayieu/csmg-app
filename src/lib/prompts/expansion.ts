import type { Entity, Edge } from "@/types";
import type { SubComponent } from "@/types/expansion";

interface ExpansionPromptInput {
  /** The entity being expanded */
  entity: Entity;
  /** All edges connected to this entity */
  connectedEdges: Edge[];
  /** Names of entities connected to this entity (for context) */
  connectedEntityNames: Map<string, string>;
  /** Parent space name and description */
  spaceName: string;
  spaceDescription: string;
  /** User's original input text (for grounding) */
  userInputText?: string;
  /** Depth level (1-5) */
  depthLevel: number;
  /** If depth > 1: the parent expansion's components and which one we're drilling into */
  parentContext?: {
    parentEntityName: string;
    parentSubComponents: SubComponent[];
    drillingIntoComponent: SubComponent;
  };
}

// ── Depth-level guidance ──

const DEPTH_RULES: Record<number, string> = {
  1: "Level 1: Major sub-processes, phases, or capabilities (8-15 components). These are the FUNDAMENTAL building blocks inside this entity. Think microscopically — what are ALL the operative parts? Don't just name 3 obvious ones. Decompose until you've captured every significant sub-process, variable, mechanism, and condition that makes this entity work. MORE COMPONENTS = RICHER GRAPH.",
  2: "Level 2: Specific mechanisms, conditions, and variables within a sub-process (6-12 components). Show HOW a parent component actually works internally. Each mechanism should be decomposed into its atomic parts.",
  3: "Level 3: Atomic variables, measurements, and edge conditions (6-10 components). These are the dials and switches — things you can measure or tune.",
  4: "Level 4: Second-order effects, failure cascades, and timing dependencies (6-10 components). Reveal what happens when atomic variables interact unexpectedly.",
  5: "Level 5: Boundary conditions and phase transitions (5-8 components). Show where the system's behavior changes qualitatively — thresholds, tipping points, regime shifts.",
};

function getDepthRule(level: number): string {
  return DEPTH_RULES[Math.min(level, 5)] ?? DEPTH_RULES[5]!;
}

// ── Truncation helper ──

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

// ── System prompt ──

function buildSystemPrompt(depthLevel: number): string {
  return `You are performing a recursive micro-decomposition of a single entity from a knowledge graph. Your task: reveal the INTERNAL probability space — the hidden sub-components, pathways, and dynamics that constitute this entity from the inside.

This is NOT a summary or description. It is a STRUCTURAL DECOMPOSITION showing:
- What sub-parts make up this entity (with probabilities)
- How those parts connect to each other (with mechanisms and failure modes)
- What internal dynamics (bottlenecks, gates, loops) exist

DEPTH LEVEL ${depthLevel} RULES:
${getDepthRule(depthLevel)}

CRITICAL CONSTRAINTS:
1. Each level MUST reveal information INVISIBLE from the level above.
   If your sub-components are just rephrasing the parent entity, you have FAILED.
2. Every pathway needs a MECHANISM — not just "A affects B" but HOW and WHY.
3. Probabilities must be DIFFERENTIATED — don't make everything 0.7.
   Some things are near-certain (0.9+), some are coin-flips (0.5), some are unlikely (0.2).
4. Failure modes are REQUIRED for critical pathways — what breaks?
5. At least one internal_dynamic must be identified (a bottleneck, gate, or feedback loop).
6. is_expandable should be true for components that have genuine internal complexity
   (not for simple variables or measurements).

MANIFOLD for each sub-component:
- controllability: "direct" (user can change it), "indirect" (user influences it), "uncontrollable" (external)
- visibility: "observable" (user can measure it), "latent" (user can infer it), "hidden" (user can't see it)
- volatility: "stable" (doesn't change fast), "fluctuating" (changes regularly), "chaotic" (unpredictable)

Return ONLY a JSON object with no markdown fencing, no explanation, no preamble:
{
  "summary": "One sentence describing the internal probability space",
  "sub_components": [
    {
      "id": "SC1",
      "name": "...",
      "description": "...",
      "component_type": "milestone|capability|condition|metric|process|variable|gate",
      "probability": 0.0-1.0,
      "importance": "critical|important|moderate|minor",
      "is_expandable": true/false,
      "manifold": { "controllability": "direct|indirect|uncontrollable", "visibility": "observable|latent|hidden", "volatility": "stable|fluctuating|chaotic" }
    }
  ],
  "internal_pathways": [
    {
      "source_id": "SC1",
      "target_id": "SC2",
      "mechanism": "HOW does SC1 lead to SC2?",
      "probability": 0.0-1.0,
      "conditions": "WHEN/IF condition or null",
      "dynamics": "sequential|parallel|conditional|probabilistic",
      "strength": 0.0-1.0,
      "failure_mode": "What breaks if this pathway fails? or null"
    }
  ],
  "internal_dynamics": [
    {
      "type": "bottleneck|feedback_loop|gate|amplifier|decay",
      "component_ids": ["SC1", "SC3"],
      "description": "...",
      "impact": "..."
    }
  ],
  "mini_axioms": [
    {
      "claim": "A single load-bearing assumption this expansion rests on — something that, if proven false, would invalidate the whole internal structure you just described. Prefer HIDDEN axioms the user/situation doesn't explicitly state.",
      "visibility": "EXPLICIT|IMPLICIT|HIDDEN",
      "load_bearing": "critical|important|moderate",
      "rests_on_components": ["SC1","SC2"],
      "if_false": "What specifically breaks — which sub-components / pathways / dynamics collapse?",
      "validation_path": "What cheap observation or experiment would confirm/refute this?"
    }
  ]
}

CRITICAL RULES:
- Return ONLY the JSON object. No markdown code fences, no explanation, no preamble.
- All sub-component IDs (SC1, SC2, etc.) must be used consistently across sub_components, internal_pathways, and internal_dynamics.
- Every source_id and target_id in internal_pathways MUST match an id in sub_components.
- Every component_ids entry in internal_dynamics MUST match an id in sub_components.
- Enum values must match exactly (e.g., "critical" not "Critical", "sequential" not "Sequential").
- At least ONE internal_dynamic is required.
- At least ONE internal_pathway must have a non-null failure_mode.
- MINI-AXIOMS: produce 1–3 only. Each axiom must be load-bearing for the EXPANSION you produced — not generic domain truisms. At least ONE should be HIDDEN (the user/situation didn't say it but the expansion depends on it). Common HIDDEN patterns at expansion scope: "this sub-process happens in the order described," "the user has the information needed to execute this," "these variables are independent," "this mechanism behaves linearly in the relevant range." If you cannot surface even one hidden axiom you haven't decomposed deeply enough.`;
}

// ── User prompt ──

function buildUserPrompt(input: ExpansionPromptInput): string {
  const parts: string[] = [];

  // 1. Situational grounding block
  if (input.userInputText) {
    parts.push(`═══ THE USER'S ORIGINAL SITUATION ═══
This is what the user actually said. Ground your decomposition in THIS reality:

${truncate(input.userInputText, 3000)}

═══ END SITUATION ═══`);
  }

  // 2. Space context
  parts.push(`SPACE: "${input.spaceName}"${input.spaceDescription ? ` — ${truncate(input.spaceDescription, 300)}` : ""}`);

  // 3. Entity details
  const e = input.entity;
  const entityFlags: string[] = [];
  if (e.is_leverage_point) entityFlags.push("LEVERAGE POINT");
  if (e.is_risk_point) entityFlags.push("RISK POINT");
  if (e.is_master_bottleneck) entityFlags.push("MASTER BOTTLENECK");
  if (e.is_shared_variable) entityFlags.push("SHARED VARIABLE");

  const manifold = e.manifold as Record<string, Record<string, string>> | null;
  let manifoldStr = "";
  if (manifold) {
    const sections: string[] = [];
    if (manifold.strategic) {
      const s = manifold.strategic;
      sections.push(`  Strategic: alignment=${s.alignment_to_goal ?? "?"}, optionality=${s.optionality_value ?? "?"}, reversibility=${s.reversibility ?? "?"}`);
    }
    if (manifold.operational) {
      const o = manifold.operational;
      sections.push(`  Operational: maturity=${o.maturity ?? "?"}, resource_intensity=${o.resource_intensity ?? "?"}, dependencies=${o.dependency_count ?? "?"}`);
    }
    if (manifold.epistemic) {
      const ep = manifold.epistemic;
      sections.push(`  Epistemic: evidence=${ep.evidence_strength ?? "?"}, consensus=${ep.consensus_level ?? "?"}, falsifiability=${ep.falsifiability ?? "?"}`);
    }
    if (sections.length > 0) {
      manifoldStr = `\nManifold:\n${sections.join("\n")}`;
    }
  }

  parts.push(`═══ ENTITY TO DECOMPOSE ═══
Name: ${e.name}
Type: ${e.entity_type ?? "unknown"} | Category: ${e.entity_category ?? "unknown"}
Importance: ${e.importance ?? "unknown"} | Confidence: ${e.confidence ?? "?"}
Description: ${truncate(e.description, 500)}${entityFlags.length > 0 ? `\nFlags: ${entityFlags.join(", ")}` : ""}${manifoldStr}
═══ END ENTITY ═══`);

  // 4. Connected entities and relationship types
  if (input.connectedEdges.length > 0) {
    const edgeLines = input.connectedEdges.slice(0, 30).map((edge) => {
      const isSource = edge.source_entity_id === e.id;
      const otherId = isSource ? edge.target_entity_id : edge.source_entity_id;
      const otherName = input.connectedEntityNames.get(otherId ?? "") ?? otherId ?? "?";
      const direction = isSource ? "→" : "←";
      const relType = edge.relationship_type ?? "?";
      const strength = edge.strength != null ? ` str=${edge.strength}` : "";
      const polarity = edge.polarity ? ` [${edge.polarity}]` : "";
      return `  ${direction} ${otherName} (${relType}${polarity}${strength})`;
    });
    parts.push(`CONNECTED ENTITIES (${input.connectedEdges.length}):\n${edgeLines.join("\n")}`);
  }

  // 5. Parent context for depth > 1
  if (input.parentContext) {
    const pc = input.parentContext;
    const parentList = pc.parentSubComponents
      .map((sc) => `  - ${sc.id}: "${sc.name}" (${sc.component_type}, p=${sc.probability}, ${sc.importance})`)
      .join("\n");

    parts.push(`═══ DRILLING DEEPER — PARENT CONTEXT ═══
You are drilling into sub-component "${pc.drillingIntoComponent.name}" of "${pc.parentEntityName}".

The parent's sub-components were:
${parentList}

You MUST go deeper — reveal the internal structure of THIS specific sub-component ("${pc.drillingIntoComponent.name}") that was INVISIBLE at the parent level.

The sub-component you are expanding:
  Type: ${pc.drillingIntoComponent.component_type}
  Probability: ${pc.drillingIntoComponent.probability}
  Importance: ${pc.drillingIntoComponent.importance}
  Description: ${truncate(pc.drillingIntoComponent.description, 300)}
═══ END PARENT CONTEXT ═══`);
  }

  // 6. Final instruction
  parts.push(`Decompose the entity above into its internal probability space at depth level ${input.depthLevel}. Reveal sub-components, pathways, and dynamics that are NOT visible from the outside.`);

  return parts.join("\n\n");
}

// ── Exported builder ──

export function buildExpansionPrompt(input: ExpansionPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: buildSystemPrompt(input.depthLevel),
    userPrompt: buildUserPrompt(input),
  };
}
