# Prompt Reference & Deep Dive

## Quick Reference Table

| # | Agent | Prompt File | System Prompt Key | Model | Tiers | Purpose | Input | Output |
|---|-------|------------|-------------------|-------|-------|---------|-------|--------|
| 0 | Scope Mapper | `scope-mapper.ts` | `SCOPE_MAPPER_PROMPT` | gpt-4o-mini | deep, comp | Split input into 4-7 analytical areas | Full text | `ScopeResult[]` (4-7 spaces) |
| 1 | Decomposer | `decomposition.ts` + `tier-prompts.ts` | `DECOMPOSITION_SYSTEM_PROMPT` | gpt-4o | all | 6-tier decomposition framework | Text + scope + siblings | Raw text |
| 2 | Structurer | `structuring.ts` + `tier-prompts.ts` | `STRUCTURING_SYSTEM_PROMPT` | gpt-4o | all | Parse raw text into JSON | Decomposed text | `StructuredDecomposition` JSON |
| 3 | Critic | `critic.ts` | `CRITIC_SYSTEM_PROMPT` | gpt-4o-mini | std, deep, comp | Structural analysis of graph | Entity/edge summaries | `CritiqueResult` |
| 4 | Augmenter | `augmenter.ts` | `AUGMENTER_SYSTEM_PROMPT` | gpt-4o-mini | std, deep, comp | Add missing entities/edges | Original + critique | `StructuredDecomposition` v2 |
| 5 | Weaver | `weaving.ts` | `WEAVING_SYSTEM_PROMPT` | gpt-4o | deep, comp | Connect spaces via shared variables | Entity summaries (2+) | Bridges + contradictions |
| 6 | Meta-Synthesizer | `meta-synthesizer.ts` | `META_SYNTHESIZER_PROMPT` | gpt-4o | deep, comp | Cross-space strategic analysis | Meta-graph summary | Strategic findings |
| 7 | Domain Expert | `domain-expert.ts` | `DOMAIN_EXPERT_PROMPT` | gpt-4o-mini | std, deep, comp | External knowledge subgraph | Scope + domains + input | `DomainExpertResult` |
| 8 | Bridge Discovery | `bridge-discovery.ts` | `BRIDGE_DISCOVERY_PROMPT` | gpt-4o-mini | std, deep, comp | Connect internal ↔ external | Internal + external entities | `BridgeDiscoveryResult` |
| 9-15 | Reasoning Suite | `reasoning.ts` | `REASONING_PROMPTS[op]` | gpt-4o | comp only | Advanced reasoning (16 ops) | Structured + context | Reasoning results |

---

## Prompt Deep Dive

### 1. SCOPE_MAPPER_PROMPT

**File**: `src/lib/prompts/scope-mapper.ts`  
**Used By**: Deep, Comprehensive tiers  
**Model**: gpt-4o-mini (fast, analytical)  
**Token Budget**: 2K max input  
**Temperature**: 0.3 (precise)

**Purpose**:
Splits complex input into 4-7 independent analytical areas that can be decomposed in parallel.

**Key Characteristics**:
- Identifies distinct domains/perspectives
- Each space should be analyzable independently
- Spaces should cover complete scope together
- Avoids overlapping areas
- Returns: `ScopeResult { spaces: [{ name, prefix, description, key_concepts, likely_connects_to, priority }] }`

**Input Format**:
```
User's full text (up to 50K chars)
```

**Output Format**:
```json
{
  "spaces": [
    {
      "name": "Market Dynamics",
      "prefix": "C",
      "description": "Competitive landscape, customer needs",
      "key_concepts": ["demand", "competition", "price"],
      "likely_connects_to": ["Product Strategy", "Financial Planning"],
      "priority": 1
    },
    {
      "name": "Product Strategy",
      "prefix": "A",
      "description": "Feature development, roadmap",
      "key_concepts": ["features", "development", "roadmap"],
      "likely_connects_to": ["Market Dynamics", "Ops"],
      "priority": 2
    }
  ]
}
```

---

### 2. DECOMPOSITION_SYSTEM_PROMPT

**File**: `src/lib/prompts/decomposition.ts`  
**Tier Variants**: `getDecompositionPrompt(depth)` in `tier-prompts.ts`  
**Used By**: All tiers  
**Model**: gpt-4o (full reasoning)  
**Token Budget**: 8K (quick) / 8.2K (standard) / 16K (deep)  
**Temperature**: 0.5 (balanced)

**Purpose**:
Implements the 6-tier decomposition framework that is the core of the system.

**The 6 Tiers of Decomposition**:

```
TIER 1: SURFACE PARSE
  ├─ What is this input? (type, goal, domain)
  ├─ What assumptions does it carry?
  └─ What ambiguities exist?

TIER 2: CONCEPT EXTRACTION  
  ├─ Pull out every distinct concept
  ├─ Assign unique IDs (C1, C2, ...)
  ├─ Type each concept (Concrete/Abstract/Process/Relational/Epistemic)
  ├─ Assign to layers (Product/Growth/Ops/etc)
  └─ Target: 15-50 entities

TIER 3: RELATIONSHIP MAPPING
  ├─ Define relationships between all concept pairs
  ├─ Classify into 9 dimensions (Structural/Functional/Temporal/etc)
  ├─ Add source tags ([STATED]/[INFERRED]/[PREDICTED])
  └─ Target: edge_count >= 1.5 × entity_count

TIER 4: CONSTRAINT & CYCLE FINDING
  ├─ Identify feedback loops (reinforcing/balancing)
  ├─ Find cycles and their properties
  ├─ Identify constraints that bound the system
  └─ Target: 3-8 cycles

TIER 5: LEVERAGE POINT & RISK IDENTIFICATION
  ├─ Where are intervention points?
  ├─ What fails catastrophically if removed?
  ├─ What has outsized impact?
  └─ Rank by blast radius

TIER 6: SYNTHESIS
  ├─ Consolidate findings
  ├─ State core logic
  ├─ Identify what's missing
  └─ Recommend next questions
```

**Key Constraints in Prompt**:
- MANDATORY deduplication check (no semantic duplicates)
- MANDATORY quality check on entity names
- MANDATORY entity precision check (scope, abstraction, reference)
- MANDATORY completeness sweep for relationships
- MANDATORY cross-layer edge check
- MANDATORY orphan detection (every entity must have ≥2 edges)

**Input Format**:
```
text: "User's input text"
spaceScope (optional): { name, description, key_concepts }
siblingContext (optional): "Other areas being analyzed:\n- Area 1: ...\n- Area 2: ..."
reasoningDepth: "quick" | "standard" | "deep"
```

**Output Format**:
Raw markdown text with all 6 tiers explicitly shown.

**Modulation by Tier**:
```
quick:       8-15 entities, 1.2× edge multiplier
standard:    15-25 entities, 2.0× edge multiplier
deep:        20-40 entities, 2.5× edge multiplier
```

---

### 3. STRUCTURING_SYSTEM_PROMPT

**File**: `src/lib/prompts/structuring.ts`  
**Tier Variants**: `getStructuringPrompt(depth)` in `tier-prompts.ts`  
**Used By**: All tiers  
**Model**: gpt-4o (full context)  
**Token Budget**: 16K max  
**Temperature**: 0.3 (precise, JSON)

**Purpose**:
Convert raw decomposition text into strict JSON schema with validation.

**Output Schema** (`StructuredDecomposition`):
```typescript
{
  metadata: {
    name: string;
    space_prefix: string;
    description: string;
    maturity: "ideation" | "concept" | "developed" | "actionable_now";
    estimated_scope: "narrow" | "medium" | "broad";
  };
  
  entities: {
    entity_id: string;              // C1, C2, etc
    name: string;
    description: string;
    entity_category: string;        // Type from taxonomy
    layer: string;                  // Functional group
    source_tag: "[EXPLICIT]" | "[IMPLICIT]" | "[ASSUMED]";
    confidence: number;             // 0-1
    importance: "high" | "medium" | "low";
    is_shared_variable: boolean;    // For weaving
  }[];
  
  edges: {
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;      // "enables", "constrains", etc
    dimension: string;              // "Structural", "Functional", etc
    source_tag: "[STATED]" | "[INFERRED]" | "[PREDICTED]";
    confidence: number;             // 0-1
    dynamics: string;               // Optional: "reinforcing", "delaying", etc
  }[];
  
  cycles: {
    cycle_id: string;
    name: string;
    entity_ids: string[];           // The cycle path
    classification: "reinforcing" | "balancing";
    growth_type: string;            // Optional: "exponential", "polynomial"
    cycle_time: string;             // Optional: "fast", "slow", "24 hours"
  }[];
  
  leverage_points: {
    entity_id: string;
    reason: string;
    intervention_type: string;
    impact_estimate: "high" | "medium" | "low";
    feasibility: "easy" | "moderate" | "hard";
  }[];
  
  risk_points: {
    entity_id: string;
    threat: string;
    blast_radius: "local" | "domain" | "system";
    mitigation: string;
  }[];
}
```

**Validation**:
- All entity_ids are unique
- All source/target_entity_ids reference existing entities
- No self-loops (source ≠ target)
- Entity counts match declared values
- Cycles form valid paths

---

### 4. CRITIC_SYSTEM_PROMPT

**File**: `src/lib/prompts/critic.ts`  
**Used By**: Standard, Deep, Comprehensive  
**Model**: gpt-4o-mini (cheap analytical)  
**Token Budget**: 4K max  
**Temperature**: 0.3 (precise)

**Purpose**:
Analyze the STRUCTURE of the decomposition to find gaps, inconsistencies, and missing relationships.

**What It Looks For**:
1. **Missing relationships**: Entities that should connect but don't
2. **Weak connections**: Entities with <3 edges (likely incomplete)
3. **Missing entities**: Concepts mentioned but not captured
4. **Inconsistent typing**: Entities misclassified
5. **Dead concepts**: Entities with no functional role
6. **Edge density**: Too sparse (< 1.5× entity count) or unbalanced
7. **Cross-layer gaps**: Missing inter-layer relationships
8. **Cycle incompleteness**: Cycles that aren't properly closed

**Input Format**:
```
Entities: C1: Entity Name [type, importance, confidence]
Edges: C1 → C2 [dimension, type, confidence]
Cycles: C1→C2→C3→C1 [classification]
Leverage/Risk points identified
Edge density
```

**Output Format** (`CritiqueResult`):
```typescript
{
  issues: string[];              // List of found issues
  suggestions: string[];         // How to fix them
  missing_entities: string[];    // Concepts to add
  missing_edges: { source: string; target: string; type: string }[];
  structural_notes: string;      // Overall assessment
  confidence: number;            // 0-1, how confident in critique
}
```

---

### 5. AUGMENTER_SYSTEM_PROMPT

**File**: `src/lib/prompts/augmenter.ts`  
**Used By**: Standard, Deep, Comprehensive  
**Model**: gpt-4o-mini (cheap improvement)  
**Token Budget**: 16K max  
**Temperature**: 0.4 (balanced)

**Purpose**:
Apply the critique's suggestions to improve the original decomposition.

**What It Does**:
1. Add missing entities identified by critic
2. Add missing edges identified by critic
3. Strengthen weak entities (add edges)
4. Improve entity descriptions/types based on feedback
5. Validate new structure still makes sense
6. Return updated `StructuredDecomposition`

**Input Format**:
```
ORIGINAL DECOMPOSITION: [full JSON]

STRUCTURAL CRITIQUE: [CritiqueResult]
- Issues found
- Suggested improvements
- Missing entities/edges
```

**Output Format**:
Updated `StructuredDecomposition` (same schema as original, but enhanced)

**Fallback**:
If augmentation fails (LLM error, timeout), returns original structure unchanged.

---

### 6. WEAVING_SYSTEM_PROMPT

**File**: `src/lib/prompts/weaving.ts`  
**Used By**: Deep, Comprehensive  
**Model**: gpt-4o (full reasoning for complex connections)  
**Token Budget**: 5K max  
**Temperature**: 0.3 (precise identification)

**Purpose**:
Discover shared variables and inter-space connections across 2+ independently decomposed spaces.

**Bridge Types**:
1. **Identity bridges**: Same real-world concept in both spaces (different names)
   - Example: "market demand" (Space A) = "customer need" (Space B)
2. **Influence bridges**: Entity in one space affects entity in other
   - Example: Space A's "funding runway" constrains Space B's "hiring plan"
3. **Structural bridges**: Both spaces share identical structural pattern
   - Example: Both have "resource constraint" functioning the same way

**Input Format**:
```
Space C "Market Dynamics":
  - C1: Competition
  - C2: Customer Need
  - C3: Price Point

Space A "Product Strategy":
  - A1: Feature Set
  - A2: Development Speed
  - A3: Market Positioning
```

**Output Format** (`WeavingResult`):
```typescript
{
  bridges: [
    {
      source_space_prefix: "C";
      source_entity_id: "C2";
      source_entity_name: "Customer Need";
      target_space_prefix: "A";
      target_entity_id: "A1";
      target_entity_name: "Feature Set";
      bridge_type: "influence";
      coupling_strength: "strong";
      coupling_direction: "source_to_target";
      shared_variable_name: "Market Demand Definition";
      description: "Customer needs directly determine which features to build";
    }
  ];
  
  contradictions: [
    {
      assumption_text: "Space C assumes steady market demand";
      conclusion_text: "Space A concludes demand is highly volatile";
      severity: "moderate";
      description: "Conflicting assumptions about market volatility";
    }
  ];
}
```

---

### 7. META_SYNTHESIZER_PROMPT

**File**: `src/lib/prompts/meta-synthesizer.ts`  
**Used By**: Deep, Comprehensive  
**Model**: gpt-4o (full reasoning)  
**Token Budget**: 16K max  
**Temperature**: 0.5 (creative synthesis)

**Purpose**:
Produce strategic findings and insights from the complete multi-space analysis.

**Input Summary Includes**:
- All spaces with entity/edge/cycle counts
- Top leverage points per space
- Top risk points per space
- Space maturity estimates
- Inter-space bridges (shared variables)
- Contradictions discovered

**Produces**:
- Cross-space strategic recommendations
- Identified tensions and their implications
- Opportunity areas emerging from connections
- Risk patterns across spaces
- System-level observations

---

### 8. DOMAIN_EXPERT_PROMPT

**File**: `src/lib/prompts/domain-expert.ts`  
**Used By**: Standard, Deep, Comprehensive (non-blocking, optional)  
**Model**: gpt-4o-mini (fast knowledge retrieval)  
**Token Budget**: 6K max  
**Temperature**: 0.4 (balanced)

**Purpose**:
Inject domain-specific external knowledge relevant to the analysis.

**Input**:
- Situation summary (first 500 chars of input)
- Scope summary (space names/descriptions)
- Domains involved (extracted from entity layers, up to 8)

**Output** (`DomainExpertResult`):
```typescript
{
  domain: string;
  key_concepts: string[];
  external_entities: [
    {
      entity_id: string;
      name: string;
      description: string;
      category: string;
      relevance_score: number;
    }
  ];
  frameworks: string[];              // Relevant frameworks/theories
  best_practices: string[];
  common_pitfalls: string[];
  recent_developments: string[];
}
```

---

### 9. BRIDGE_DISCOVERY_PROMPT

**File**: `src/lib/prompts/bridge-discovery.ts`  
**Used By**: Standard, Deep, Comprehensive (optional)  
**Model**: gpt-4o-mini (analytical matching)  
**Token Budget**: 3K max  
**Temperature**: 0.3 (precise)

**Purpose**:
Connect entities from the user's internal analysis to external domain knowledge.

**Input**:
- Internal entities (from all spaces)
- External entities (from Domain Expert)

**Finds**:
- Matches between internal and external
- Categories of connections
- Relevance ratings

**Output** (`BridgeDiscoveryResult`):
```typescript
{
  bridges: [
    {
      internal_entity_id: string;
      internal_entity_name: string;
      external_entity_id: string;
      external_entity_name: string;
      match_type: "exact" | "conceptual" | "related";
      relevance: number;              // 0-1
      reasoning: string;
    }
  ];
}
```

---

### 10. REASONING_PROMPTS (Comprehensive Only)

**File**: `src/lib/prompts/reasoning.ts`  
**Used By**: Comprehensive tier only (16 operations)  
**Model**: gpt-4o (full reasoning)  
**Temperature**: 0.5-0.7 (creative reasoning)

**Available Operations**:
```typescript
REASONING_PROMPTS = {
  system_dynamics: "Analyze feedback loops, delays, accumulations",
  leverage_analysis: "Identify intervention points with outsized impact",
  second_order: "2nd and 3rd order consequences",
  scenario_testing: "Plausible future scenarios and their drivers",
  assumption_audit: "Examine stated vs unstated assumptions vs reality",
  boundary_crossing: "What's outside the model? What connects to it?",
  resilience_check: "Where is system brittle? What causes collapse?",
  mental_model_gaps: "Paradigm blindness, unstated mental models",
  network_analysis: "Key connectors, bottlenecks, hubs in network",
  time_dynamics: "Accelerants, decelerants, temporal patterns",
  stakeholder_mapping: "Power, interest, influence of stakeholders",
  decision_structure: "Decision points, who decides, incentives",
  information_flow: "What info travels where? What's hidden?",
  resource_flow: "Money, energy, attention, talent allocation",
  threshold_identification: "Tipping points, critical thresholds",
  paradox_resolution: "Apparent contradictions and their meaning",
}
```

Each operation is a specialized prompt that applies advanced reasoning to the analysis.

---

## Prompt Execution Sequences

### Quick Tier: Minimal Sequence

```
INPUT
  ↓
runDecomposer(input, undefined, undefined, "quick")
  ├─ System: DECOMPOSITION_SYSTEM_PROMPT (quick variant)
  ├─ Tokens: 8K max
  └─ Output: raw string
  ↓
runStructurer(raw, "quick")
  ├─ System: STRUCTURING_SYSTEM_PROMPT (quick variant)
  ├─ Validator: validateStructuredDecomposition
  └─ Output: StructuredDecomposition
  ↓
OUTPUT: PipelineResult { spaceData: [{ raw, structured }] }
```

### Standard Tier: Single-Space Enriched

```
INPUT
  ↓
runDecomposer(input, undefined, undefined, "standard")
  └─ Output: raw string
  ↓
runStructurer(raw, "standard")
  └─ Output: StructuredDecomposition v1
  ↓
runCritic(v1)  ⏱️ 20s timeout
  ├─ System: CRITIC_SYSTEM_PROMPT
  └─ Output: CritiqueResult
  ↓
runAugmenter(v1, critique)  ⏱️ 15s timeout
  ├─ System: AUGMENTER_SYSTEM_PROMPT
  └─ Output: StructuredDecomposition v2
  ↓
runDomainExpert(scope, domains) [ASYNC]
  ├─ System: DOMAIN_EXPERT_PROMPT
  ├─ Doesn't block main flow
  └─ Output: DomainExpertResult (or undefined)
  ↓
runBridgeDiscovery(internalEnts, externalEnts) [if Domain Expert succeeded]
  ├─ System: BRIDGE_DISCOVERY_PROMPT
  └─ Output: BridgeDiscoveryResult
  ↓
OUTPUT: PipelineResult { 
    spaceData: [{ raw, structured: v2 }],
    externalKnowledge,
    bridgeDiscovery
}
```

### Deep Tier: Multi-Space with Cross-Connection

```
INPUT
  ↓
runScopeMapper(input)
  ├─ System: SCOPE_MAPPER_PROMPT
  ├─ Model: gpt-4o-mini
  └─ Output: ScopeResult { spaces: [space0, space1, space2] }
  ↓
buildAllCappedSiblingContexts(spaces)  [PHASE 2.5]
  ├─ Algorithm: Relevance scoring + truncation to 50KB per space
  └─ Output: siblingContexts[]
  ↓
┌─ runDomainExpert(...) [ASYNC, in background]
│  └─ Doesn't block: Continues during phases below
│
├─ PARALLEL: For each space (Promise.all)
│  │
│  ├─ runDecomposer(input, space, siblingContext[i], "deep")  ⏱️ 20s timeout
│  │  └─ Output: raw[i]
│  │
│  ├─ runStructurer(raw[i], "deep")  ⏱️ 10s timeout
│  │  └─ Output: structured[i] v1
│  │
│  └─ Return: { scope, raw, structured } or null
│
└─ Results: [space0_result, space1_result, space2_result] (successful ones only)
  ↓
PARALLEL: For each successful space (Promise.all)
  │
  ├─ runCritic(structured[i])  ⏱️ 20s timeout
  │  └─ Output: CritiqueResult[i]
  │
  ├─ runAugmenter(structured[i], critique[i])  ⏱️ 10s timeout
  │  └─ Output: structured[i] v2
  │
  └─ Return: { structured: v2 } or { structured: v1 } (if augment failed)
  ↓
Results: [space0_augmented, space1_augmented, space2_augmented]
  ↓
IF multiple spaces:
  └─ runWeaver(entity_summaries)
     ├─ System: WEAVING_SYSTEM_PROMPT
     └─ Output: WeavingResult { bridges, contradictions }
  ↓
runMetaSynthesizer(metaSummary)
  ├─ System: META_SYNTHESIZER_PROMPT
  ├─ Input: All spaces + bridges + contradictions
  └─ Output: Strategic findings
  ↓
AWAIT domainExpertPromise [if not already done]
  └─ Output: DomainExpertResult
  ↓
IF Domain Expert succeeded:
  └─ runBridgeDiscovery(all_internal_entities, external_entities)
     ├─ System: BRIDGE_DISCOVERY_PROMPT
     └─ Output: BridgeDiscoveryResult
  ↓
OUTPUT: PipelineResult {
    spaceData: [space0_augmented, space1_augmented, space2_augmented],
    weaveResult,
    synthesisResult,
    externalKnowledge,
    bridgeDiscovery
}
```

---

## Token Accounting

### Quick Tier
```
Decompose:
  Input:  2K (user text) + 2.5K (system) = 4.5K
  Output: 4K (average decomposition)
  Total:  8.5K
  Max:    8K ← Under limit ✓

Structure:
  Input:  4K (decomposition) + 2K (system) = 6K
  Output: 8K (JSON structure)
  Total:  14K
  Max:    16K ← Under limit ✓

TIER TOTAL: ~22K tokens
```

### Standard Tier
```
Decompose:     6K (same as quick)
Structure:     14K (same as quick)
Critique:      4K in + 2K out = 6K
Augment:       18K in + 8K out = 26K
Domain Expert: 2K in + 4K out = 6K
Bridge Disc:   4K in + 2K out = 6K

TIER TOTAL: ~64K tokens
```

### Deep Tier (3 spaces)
```
Scope:         3K in + 1K out = 4K
Decompose×3:   (6K in + 4K out) × 3 = 30K
Structure×3:   (6K in + 8K out) × 3 = 42K
Critique×3:    (4K in + 2K out) × 3 = 18K
Augment×3:     (18K in + 8K out) × 3 = 78K
Weave:         10K in + 4K out = 14K
Meta-synth:    15K in + 12K out = 27K
Domain Expert: 2K in + 4K out = 6K
Bridge Disc:   12K in + 2K out = 14K

TIER TOTAL: ~233K tokens (but uses gpt-4o-mini for cheap operations)
```

---

## Configuration & Customization Points

### Modulating Decomposition Depth

In `tier-prompts.ts`:
```typescript
export function getDecompositionPrompt(depth: "quick" | "standard" | "deep"): string {
    const config = {
        quick: { entityTarget: "8-15", edgeDensity: "1.2x", template: "..." },
        standard: { entityTarget: "15-25", edgeDensity: "2.0x", template: "..." },
        deep: { entityTarget: "20-40", edgeDensity: "2.5x", template: "..." },
    };
    return config[depth].template;
}
```

To increase entity count in deep tier:
```typescript
deep: { entityTarget: "30-60", edgeDensity: "3.0x", ... }  // More granular
```

### Adding New Reasoning Operations

In `reasoning.ts`:
```typescript
export const REASONING_PROMPTS = {
    // ... existing 16 operations ...
    
    // New operation:
    causal_chain_mapping: `You are analyzing causal chains. Given the decomposition, trace:
      1. Root causes of key issues
      2. Intervention chains (pulling lever X leads to Y which leads to Z)
      3. Unintended consequences
      ...`,
};
```

Then in comprehensive tier execution, add logic to select and run it.

### Adjusting Timeout Budgets

In `timeouts.ts`:
```typescript
export const TIMEOUT_BUDGETS = {
    deep: {
        decompose: 20000,  // ← Change to 25000 for slower LLM
        structure: 10000,  // ← Change to 15000 for more time
        critique: 20000,   // ← Change based on critique complexity
        augment: 10000,
    },
};
```

### Changing Model Selection

In `agents.ts`:
```typescript
// Instead of gpt-4o-mini for critic:
return llmJSON<CritiqueResult>({
    system: CRITIC_SYSTEM_PROMPT,
    user: input,
    maxTokens: 4000,
    temperature: 0.3,
    model: "gpt-4o",  // ← Change from gpt-4o-mini for better quality
});
```

---

## Troubleshooting & Debugging

### Check Prompt Execution Order (Deep Tier)

Enable debug logging in pipeline.ts:
```typescript
emit("phase", JSON.stringify({ phase: "decomposing", status: "running" }));
// This should appear BEFORE structure phase
```

SSE event stream shows:
```
event: phase
data: {"phase": "decomposing", "status": "running"}

event: phase
data: {"phase": "structuring", "status": "running"}

event: space_progress
data: {"index": 0, "phase": "critiquing", "status": "running"}
```

### Validation Failures

Check `src/lib/validation.ts` for Zod schema:
```typescript
const ResultSchema = z.object({
    spaceData: z.array(SpaceSchema),
    weaveResult: z.optional(...),
    ...
});

// If validation fails:
// Error message shows: "LLM output validation failed: [errors list]"
```

### Timeout Issues

Check logs for:
```
"Space 0 decomposition" timeout after 20s
"Space 1 augment timeout - using original"
```

If frequent, increase timeouts in `timeouts.ts`.

### Context Window Exceeded

Check logs for:
```
"Context length exceeded: 165K / 128K"
```

Solution: Reduce sibling context cap from 50KB to 40KB in `context-capping.ts`.

---

## Summary: Prompt System as a Whole

The prompting system follows a **layered agent architecture**:

1. **Routing Layer**: `orchestrate/route.ts` → Tier dispatch
2. **Orchestration Layer**: `pipeline.ts` → Sequence and parallelize agents
3. **Agent Layer**: `agents.ts` → Wrap LLM calls with error handling
4. **Prompt Layer**: `prompts/*.ts` → Define system messages
5. **LLM Layer**: `llm.ts` → Interface to Anthropic API
6. **Validation Layer**: `validation.ts` → Zod schemas
7. **Timeout Layer**: `timeouts.ts` → Protect against hangs
8. **Credit Layer**: `credits.ts` → Atomic reservation

Each layer has a specific responsibility, and failures gracefully degrade to the layer above.

**Total prompt count**: 9-15 distinct prompts + 16 reasoning operations  
**Total LLM calls per analysis**: 2-12 depending on tier  
**Parallelization potential**: Up to 3 independent spaces  
**Estimated quality**: 70-95% depending on tier (quick < standard < deep < comprehensive)

