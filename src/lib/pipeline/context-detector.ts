import type { Entity, Edge } from "@/types";
import type { ContextDetection, ContextType } from "@/types/execution-brief";

// ── Helpers ──

/**
 * Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if `text` contains `term` as a word boundary match (not just a substring).
 * Avoids false positives like "strategy" matching inside "strategybuilder".
 */
function containsWord(text: string, term: string): boolean {
  if (term.length < 3) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return re.test(text);
}

/**
 * Fuzzy entity name match: returns true if the recommendation text plausibly
 * references this entity. Checks full name, first significant word (>3 chars),
 * and lowercase containment.
 */
function entityMatches(recText: string, entityName: string): boolean {
  const normRec = normalize(recText);
  const normName = normalize(entityName);

  // Exact full name containment
  if (normRec.includes(normName)) return true;

  // Word boundary match on full name
  if (containsWord(recText, entityName)) return true;

  // First significant word match (words > 3 chars, skip generic prefixes)
  const skipWords = new Set([
    "the",
    "this",
    "that",
    "with",
    "from",
    "into",
    "over",
    "your",
    "their",
    "each",
    "more",
    "most",
    "some",
    "many",
    "high",
    "low",
  ]);
  const words = normName.split(" ").filter((w) => w.length > 3 && !skipWords.has(w));
  if (words.length === 0) return false;

  // Require at least the first significant word to appear as a word boundary
  const firstWord = words[0];
  if (!containsWord(normRec, firstWord)) return false;

  // If entity name has multiple significant words, require at least 2 to appear
  // to reduce false positives on common single words
  if (words.length >= 2) {
    const matchCount = words.filter((w) => containsWord(normRec, w)).length;
    return matchCount >= 2;
  }

  return true;
}

// ── Prompt-related keywords ──

const PROMPT_KEYWORDS = [
  "prompt",
  "system prompt",
  "user prompt",
  "decomposition prompt",
  "synthesis prompt",
  "reasoning prompt",
  "critique prompt",
  "structuring prompt",
  "domain expert prompt",
  "instruction",
  "llm instruction",
];

const STRATEGY_KEYWORDS = [
  "strategy",
  "strategic approach",
  "macro strategy",
  "strategic direction",
  "strategic recommendation",
];

const RESEARCH_KEYWORDS = [
  "research",
  "investigate",
  "explore further",
  "deep dive",
  "look into",
  "study",
  "analyze further",
];

const PROCESS_KEYWORDS = [
  "pipeline",
  "workflow",
  "process",
  "analysis flow",
  "agent pipeline",
];

// ── Main Function ──

/**
 * Detect if a recommendation references something the system already has data about.
 * Returns null if no context detected. Conservative — only returns a detection
 * when there's a clear match. False positives are worse than false negatives.
 */
export function detectExecutionContext(params: {
  recommendationText: string;
  entities: Entity[];
  edges: Edge[];
  synthesisSummary?: string;
  knownPrompts?: Record<string, string>;
}): ContextDetection | null {
  const { recommendationText, entities, edges, synthesisSummary, knownPrompts } =
    params;

  const normRec = normalize(recommendationText);

  // ── 1. Prompt references ──
  if (knownPrompts && Object.keys(knownPrompts).length > 0) {
    // Check for specific prompt name mentions
    for (const [promptName, promptText] of Object.entries(knownPrompts)) {
      if (containsWord(recommendationText, promptName) || containsWord(normRec, promptName)) {
        const relatedIds = entities
          .filter((e) => entityMatches(promptText, e.name))
          .map((e) => e.entity_id)
          .slice(0, 5);

        return {
          context_type: "prompt",
          detected_reference: promptName,
          current_state: truncate(promptText, 300),
          proposed_changes: extractProposedChange(recommendationText, promptName),
          related_entity_ids: relatedIds,
        };
      }
    }

    // Check for generic prompt keywords
    const matchedPromptKeyword = PROMPT_KEYWORDS.find((kw) =>
      containsWord(recommendationText, kw)
    );
    if (matchedPromptKeyword) {
      // Only fire if a specific prompt is named or "prompt" appears with enough specificity
      const promptNames = Object.keys(knownPrompts);
      const nearbyPrompt = promptNames.find((name) => {
        // Check if the prompt name appears within ~50 chars of "prompt" keyword
        const kwIdx = normRec.indexOf(normalize(matchedPromptKeyword));
        const nameIdx = normRec.indexOf(normalize(name));
        return nameIdx !== -1 && Math.abs(kwIdx - nameIdx) < 80;
      });

      if (nearbyPrompt) {
        const promptText = knownPrompts[nearbyPrompt];
        return {
          context_type: "prompt",
          detected_reference: nearbyPrompt,
          current_state: truncate(promptText, 300),
          proposed_changes: extractProposedChange(recommendationText, nearbyPrompt),
          related_entity_ids: [],
        };
      }
    }
  }

  // ── 2. Entity references ──
  const matchedEntities = entities.filter((e) =>
    entityMatches(recommendationText, e.name)
  );

  if (matchedEntities.length > 0) {
    // Pick the best match: prefer leverage/risk points, then by blast_radius
    const sorted = [...matchedEntities].sort((a, b) => {
      const aScore =
        (a.is_leverage_point ? 10 : 0) +
        (a.is_risk_point ? 8 : 0) +
        (a.is_master_bottleneck ? 12 : 0) +
        a.blast_radius;
      const bScore =
        (b.is_leverage_point ? 10 : 0) +
        (b.is_risk_point ? 8 : 0) +
        (b.is_master_bottleneck ? 12 : 0) +
        b.blast_radius;
      return bScore - aScore;
    });

    const primary = sorted[0];
    const relatedIds = matchedEntities.map((e) => e.entity_id);

    // Build current state from entity details + connected edges
    const connectedEdges = edges.filter(
      (edge) =>
        edge.source_entity_id === primary.entity_id ||
        edge.target_entity_id === primary.entity_id
    );
    const edgeSummary = connectedEdges
      .slice(0, 3)
      .map((edge) => {
        const srcName =
          entities.find((e) => e.entity_id === edge.source_entity_id)?.name ??
          edge.source_entity_id;
        const tgtName =
          entities.find((e) => e.entity_id === edge.target_entity_id)?.name ??
          edge.target_entity_id;
        return `${srcName} → ${tgtName} (${edge.relationship_type})`;
      })
      .join("; ");

    const flags: string[] = [];
    if (primary.is_leverage_point) flags.push("leverage point");
    if (primary.is_risk_point) flags.push("risk point");
    if (primary.is_master_bottleneck) flags.push("master bottleneck");
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

    const currentState = [
      `${primary.name}${flagStr}: ${primary.description ?? "no description"}`,
      edgeSummary ? `Connected: ${edgeSummary}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    return {
      context_type: "entity",
      detected_reference: primary.name,
      current_state: truncate(currentState, 400),
      proposed_changes: extractProposedChange(recommendationText, primary.name),
      related_entity_ids: relatedIds,
    };
  }

  // ── 3. Strategy references ──
  const matchedStrategyKw = STRATEGY_KEYWORDS.find((kw) =>
    containsWord(recommendationText, kw)
  );
  if (matchedStrategyKw && synthesisSummary) {
    // Only match when synthesis context exists and the recommendation is about changing strategy
    const changeVerbs = ["change", "shift", "pivot", "adjust", "revise", "update", "refine", "rethink"];
    const hasChangeIntent = changeVerbs.some((v) => containsWord(recommendationText, v));
    if (hasChangeIntent) {
      return {
        context_type: "strategy",
        detected_reference: matchedStrategyKw,
        current_state: truncate(synthesisSummary, 300),
        proposed_changes: extractProposedChange(recommendationText, matchedStrategyKw),
        related_entity_ids: [],
      };
    }
  }

  // ── 4. Research references ──
  const matchedResearchKw = RESEARCH_KEYWORDS.find((kw) =>
    containsWord(recommendationText, kw)
  );
  if (matchedResearchKw) {
    // Only return if a specific entity is also mentioned (research about what?)
    const entityMentions = entities.filter((e) =>
      entityMatches(recommendationText, e.name)
    );
    // This block only fires if no entity was matched above (step 2 already returned)
    // So this handles the case where research keywords + vague entity reference
    if (entityMentions.length > 0) {
      const target = entityMentions[0];
      return {
        context_type: "research",
        detected_reference: `${matchedResearchKw} — ${target.name}`,
        current_state: target.description ?? "No current research data available.",
        proposed_changes: extractProposedChange(recommendationText, matchedResearchKw),
        related_entity_ids: entityMentions.map((e) => e.entity_id),
      };
    }
  }

  // ── 5. Process references ──
  const matchedProcessKw = PROCESS_KEYWORDS.find((kw) =>
    containsWord(recommendationText, kw)
  );
  if (matchedProcessKw) {
    const changeVerbs = ["improve", "optimize", "change", "add", "remove", "restructure", "modify"];
    const hasChangeIntent = changeVerbs.some((v) => containsWord(recommendationText, v));
    if (hasChangeIntent) {
      return {
        context_type: "process",
        detected_reference: matchedProcessKw,
        current_state: "Current analysis pipeline: decomposition → structuring → critique → research → synthesis.",
        proposed_changes: extractProposedChange(recommendationText, matchedProcessKw),
        related_entity_ids: [],
      };
    }
  }

  return null;
}

// ── Utility ──

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

/**
 * Extract a rough summary of what the recommendation proposes to change,
 * based on text near the reference keyword.
 */
function extractProposedChange(text: string, reference: string): string {
  const normRef = reference.toLowerCase();
  const idx = text.toLowerCase().indexOf(normRef);
  if (idx === -1) return text.slice(0, 200);

  // Grab surrounding context: 20 chars before, 200 chars after
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + normRef.length + 200);
  const excerpt = text.slice(start, end).trim();
  return truncate(excerpt, 250);
}
