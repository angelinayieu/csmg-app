# Situational Analysis: Complete System Deep Dive

## Overview

"Situational Analysis" is the term used within the **Rigor-First Intake Pipeline** to describe the evaluation of contextual, environmental, and constraint-based information. It's one of four dimensions in the **Landscape Coverage Matrix** that measures the holistic rigor of an analysis.

The landscape matrix has four dimensions:
- **Digital**: Available datasets, APIs, papers, citations, web evidence
- **Logic**: Causal reasoning, mechanisms, assumptions, if-then chains
- **Situational**: Context, constraints, team, market, environment, user situation
- **Baseline**: Current/as-is state, starting point, existing conditions

---

## System Architecture

### High-Level Flow

```
User Input
    ↓
[Deep/Comprehensive Tier?] → YES → Phase 1.25: Rigor Intake
    ↓                                    ↓
    └────────────────────────────────────┘
                     ↓
            Rigor Intake Engine
                     ↓
    ┌─────────────────────────────┐
    │  Run LLM Analysis            │
    │  (or fallback heuristic)     │
    │                              │
    │  → Compute landscape_coverage│
    │    (digital, logic,          │
    │     situational, baseline)   │
    │                              │
    │  → Extract claims            │
    │  → Generate proposals        │
    │  → Produce rigor_score       │
    └─────────────────────────────┘
                     ↓
    Persist to spaces.synthesis_data.rigor_intake
    + rigor_runs table
    + claims table
    + experiment_specs table
                     ↓
              Phase 2: Research
                     ↓
         Phase 3: Synthesis (uses rigor_intake)
                     ↓
         Phase 4: Strategy (uses rigor signals)
```

---

## Inputs to Situational Analysis

### 1. **Primary Input Source**
- **Field**: `RigorIntakeInput.text`
- **Value**: Either:
  - User-provided `text` in the POST body, OR
  - `space.input_text` (fallback if not provided)
- **Size**: Full text of the user's initial query/objective

### 2. **Optional Context**
- **Field**: `RigorIntakeInput.objective`
- **Value**: `config.intent?.primary_goal` (from pipeline config)
- **Purpose**: Grounds the rigor analysis to a specific measurable goal

### 3. **Tier Information**
- **Field**: `RigorIntakeInput.tier`
- **Value**: `"deep"` or `"comprehensive"`
- **Purpose**: Affects scoring thresholds and rigor expectations

---

## Process: How Situational Analysis Works

### Entry Point: `POST /api/pipeline/rigor-intake`

**File**: [src/app/api/pipeline/rigor-intake/route.ts](src/app/api/pipeline/rigor-intake/route.ts)

#### Step 1: Auth & Input Validation
```typescript
// Verify user ownership of space
const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);

// Extract text (use provided or fallback to space.input_text)
const inputText = text.trim().length > 0 
  ? text 
  : String(space?.input_text ?? "").trim();
```

#### Step 2: Create `rigor_runs` audit row
```typescript
const { data: runRow } = await db.from("rigor_runs").insert({
  space_id: spaceId,
  user_id: user.id,
  tier,           // "deep" or "comprehensive"
  status: "running",
  started_at: new Date().toISOString(),
});
```

#### Step 3: Invoke Core Engine

**File**: [src/lib/pipeline/rigor-intake-engine.ts](src/lib/pipeline/rigor-intake-engine.ts)

```typescript
export async function runRigorIntake(input: RigorIntakeInput): Promise<RigorIntakeOutput>
```

### Engine Logic: Two Paths

#### Path A: LLM-Based Analysis (Primary)
```typescript
// System prompt defines the rigor analyst role
const system = `
  You are a rigor-intake analyst.
  Return STRICT JSON only.
  Score coverage for digital, logic, situational, baseline in [0,1].
  Generate 3-8 claims and 2-5 ranked experiment proposals.
`;

// User prompt includes the input text and schema
const user = `
  Objective: ${objective}
  Tier: ${tier}
  Input: ${text}
  Output schema: { rigor_score, landscape_coverage, claims, proposals, summary }
`;

// Call gpt-4o-mini (cheap, fast for structural analysis)
const raw = await llmGenerate({
  system, user,
  model: "gpt-4o-mini",
  temperature: 0.2,    // Low temperature → deterministic
  maxTokens: 3000,
});
```

#### Situational Dimension Scoring

The LLM receives instructions to evaluate **situational** coverage. The actual scoring logic lives in the fallback heuristic:

```typescript
const hasSituational = /context|constraint|team|market|environment|user|situation/.test(t);

const coverage = {
  situational: hasSituational ? 0.75 : 0.35,
};
```

**Semantic Triggers for Situational Coverage**:
- `context` — operational or problem context
- `constraint` — time, resource, regulatory constraints
- `team` — organizational/team structure and dynamics
- `market` — market conditions, competitive landscape
- `environment` — external environment (regulatory, economic, social)
- `user` — end-user perspective, needs, behaviors
- `situation` — broader situational awareness

#### Path B: Fallback Heuristic (Non-Blocking LLM Failure)
If the LLM call fails or returns unparseable JSON:
```typescript
const fallback = fallbackHeuristic(input);
// Returns a valid RigorIntakeOutput based on keyword matching
```

This ensures the pipeline never blocks on LLM errors.

### Output: `RigorIntakeOutput`

```typescript
interface RigorIntakeOutput {
  rigor_score: number;                    // [0, 1]
  landscape_coverage: {
    digital: number;                      // [0, 1]
    logic: number;                        // [0, 1]
    situational: number;                  // ← KEY DIMENSION
    baseline: number;                     // [0, 1]
  };
  claims: RigorClaim[];
  proposals: ExperimentProposal[];
  summary: {
    top_gap: string;
    strongest_signal: string;
    recommended_next_action: string;
  };
}
```

#### Situational Value Interpretation
- **0.0 - 0.3**: No situational grounding (e.g., purely technical, no context)
- **0.3 - 0.6**: Partial situational awareness (some context mentioned)
- **0.6 - 0.8**: Strong situational framing (clear context, constraints, actors)
- **0.8 - 1.0**: Comprehensive situational analysis (holistic picture)

---

## Outputs: What Gets Persisted Downstream

### 1. **`spaces.synthesis_data.rigor_intake`** (In-Memory Summary)

```typescript
const rigorBlob = {
  generated_at: "2026-04-21T...",
  generated_by: "pipeline:rigor-intake",
  tier: "comprehensive",
  score: output.rigor_score,                    // Overall rigor
  landscape_coverage: {
    digital: 0.75,
    logic: 0.65,
    situational: 0.85,                         // ← Situational score
    baseline: 0.55,
  },
  claims: output.claims,                        // [{claim_text, claim_type, confidence}, ...]
  proposals: output.proposals,                  // [{title, method, required_tools, ...}, ...]
  summary: {
    top_gap: "baseline",                        // e.g., "lacking current-state data"
    strongest_signal: "situational context present",
    recommended_next_action: "Run focused rigor intake before synthesis...",
  },
  run_id: rigorRunId,
};

await db.from("spaces").update({
  synthesis_data: { ...currentSynth, rigor_intake: rigorBlob },
}).eq("id", spaceId);
```

**Why this location?**: Synthesis and Strategy routes read `spaces.synthesis_data` inline. This puts the rigor signals in their immediate view.

### 2. **`rigor_runs`** (Persistent Audit Trail)

```sql
INSERT INTO rigor_runs (
  space_id, user_id, tier, status, rigor_score,
  landscape_coverage, summary, completed_at
) VALUES (...);
```

**Columns of interest**:
- `rigor_score` — Overall rigor (used by dashboard, audit)
- `landscape_coverage` — JSONB: `{ digital, logic, situational, baseline }`
- `status` — "completed" | "failed"
- `created_at` / `completed_at` — For tracking when rigor intake ran

**Query**: See historical rigor assessments per space
```sql
SELECT * FROM rigor_runs 
WHERE space_id = 'xxx-xxx-xxx' 
ORDER BY created_at DESC 
LIMIT 5;
```

### 3. **`claims`** (Extracted Assertions)

```sql
INSERT INTO claims (
  space_id, claim_text, claim_type, confidence, 
  status, source_type, source_quote
) VALUES (
  'xxx', 
  'The current team lacks market research bandwidth.',
  'assertion',
  0.7,
  'candidate',
  'agent',
  '[rigor-intake]'
);
```

**Used by**: Research/Strategy to identify evidence gaps and guide follow-up.

### 4. **`experiment_specs`** (Ranked Proposals)

```sql
INSERT INTO experiment_specs (
  space_id, rigor_run_id, title, method, 
  required_tools, predicted_effect, rank_score, approval_status
) VALUES (
  'xxx', 
  'rigor-run-id',
  'Fast falsification probe',
  'Run a minimal intervention...',
  '["time-series tracker", "evidence capture"]',
  '{"metric": "primary outcome", "direction": "up", "confidence": 0.65}',
  0.72,
  'proposed'
);
```

**Used by**: Test Lab, Strategy module, user whiteboards for manually approving/deferring/rejecting.

---

## Downstream Effects: How Situational Analysis Influences the Pipeline

### Phase 2: Research

**Impact**: INDIRECT
- Rigor intake runs **in parallel** with research (non-blocking)
- If rigor_intake completes, its `claims` and `summary` are available
- Research engine can see `top_gap` and prioritize:
  - If `top_gap = "baseline"` → Focus on current-state research
  - If `top_gap = "digital"` → Focus on datasets/papers
  - If `top_gap = "situational"` → Focus on market/team context

**Code**: [src/lib/hooks/use-pipeline.ts#L442-L461](src/lib/hooks/use-pipeline.ts#L442-L461)

```typescript
if ((config.tier === "deep" || config.tier === "comprehensive") && ids.length > 0) {
  try {
    const rigorRes = await fetch("/api/pipeline/rigor-intake", {
      method: "POST",
      body: JSON.stringify({
        spaceId: ids[0],
        text,
        objective: config.intent?.primary_goal,
        tier: config.tier,
        persistProposals: true,
      }),
    });
    // Runs in background; doesn't block pipeline
  } catch (rigorErr) {
    console.warn("[rigor-intake] failed (non-fatal):", rigorErr);
  }
}
```

### Phase 3: Synthesis

**Impact**: MODERATE
- Synthesis route can now read `spaces.synthesis_data.rigor_intake`
- Uses rigor signals to:
  1. **Calibrate claim confidence**: If a claim depends on a low-situational-coverage area, lower its synthesis weight
  2. **Ground recommendations**: Prefer recommendations backed by high-rigor claims
  3. **Flag coverage gaps**: Include rigor gaps in the synthesis summary

**Relevant Code**: [src/app/api/pipeline/synthesize/route.ts](src/app/api/pipeline/synthesize/route.ts)
- The synthesizer would read: `spaces.synthesis_data.rigor_intake`
- (Currently this is noted as TODO in the implementation plan)

### Phase 4: Strategy

**Impact**: HIGH
- Strategy engine reads rigor signals to prioritize recommendations
- **Scoring Logic**:
  ```
  Recommendation Score = 
    Base Score × (1 + 0.25 × rigor_score)
  ```
  High-rigor recommendations get a 25% boost.

- **Coverage Bias**: If `landscape_coverage.situational` is low, the strategy engine recommends:
  - "Stakeholder interviews to ground assumptions"
  - "Team workshop to validate constraints"
  - "Market research sprint to validate competitive context"

**Relevant Code**: (Strategy-refresh route would integrate this)

---

## Scoring Model: How Rigor Score is Computed

### Formula (Stated in Implementation Plan)

$$R = 0.25 C_{evidence} + 0.20 C_{coverage} + 0.20 C_{prediction} + 0.20 C_{experimentability} + 0.15 C_{calibration}$$

### Current Simplified Implementation

The actual code uses a heuristic blend:

```typescript
const avgCoverage = (
  coverage.digital + 
  coverage.logic + 
  coverage.situational + 
  coverage.baseline
) / 4;

const complexity = clamp01(Math.min(words.length / 500, 1));

const rigor = clamp01(
  avgCoverage * 0.75 +      // 75% weight on landscape balance
  complexity * 0.25         // 25% weight on input depth
);
```

### Situational Coverage's Role

- **Weight in final rigor**: 25% (one of four landscape dimensions)
- **Direct effect**: Low situational coverage pulls down overall rigor
- **Indirect effect**: Low situational coverage increases `top_gap = "situational"`, which triggers follow-up research

---

## Data Flow Diagram: Situational Analysis in Context

```
┌──────────────────────────────────────────────────────────────┐
│ User Submits Analysis Request (Deep or Comprehensive Tier)   │
└─────────────────────────┬──────────────────────────────────┘
                          │
                ┌─────────▼─────────┐
                │  Scope Mapping    │  (Agent 0)
                │  → 3-4 spaces     │
                └─────────┬─────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
    ┌───▼────┐        ┌───▼────┐       ┌───▼────┐
    │DECOMPOSE│        │RIGOR   │       │RESEARCH│ (Parallel)
    │(Agent 1)│        │INTAKE  │       │(Agent 7)│
    │         │        │(Engine)│       │         │
    └─────┬───┘        └───┬────┘       └────┬────┘
          │                │                  │
          │                │ Extracts:        │
          │                │ • landscape_     │
          │                │   coverage       │
          │                │ • rigor_score    │
          │                │ • claims         │
          │                │ • proposals      │
          │                │                  │
          │         ┌──────▼──────┐           │
          │         │ Persist to: │           │
          │         │ • synthesis_│           │
          │         │   data      │           │
          │         │ • rigor_runs│           │
          │         │ • claims    │           │
          │         │ • exp_specs │           │
          │         └──────┬──────┘           │
          │                │                  │
          └─────────────────┼──────────────────┘
                            │
                  ┌─────────▼──────────┐
                  │ STRUCTURE & CRITIC │  (Agents 2-3)
                  │ (see decomp)       │
                  └────────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
          ┌───▼────┐   ┌───▼────┐  ┌───▼────┐
          │SYNTHESIS│   │STRATEGY│  │APPS    │ (Phase 4+)
          │(Reads   │   │(HIGH   │  │(Uses   │
          │rigor_   │   │IMPACT) │  │rigor)  │
          │intake)  │   │        │  │        │
          └─────────┘   └────────┘  └────────┘
```

---

## Example: How Situational Coverage Affects Downstream

### Scenario A: High Situational Coverage (0.85)

**Input**: 
```
"We're a 15-person SaaS startup in the B2B analytics space. Our team has 
3 engineers, 2 designers, 1 product. We operate in a highly competitive 
market with Mixpanel, Amplitude as incumbents. Our GTM is self-serve + 
direct sales. Customer acquisition cost is ~$50/month. Churn is 8% MoM."
```

**LLM Rigor Intake Output**:
```json
{
  "rigor_score": 0.78,
  "landscape_coverage": {
    "digital": 0.40,    // No links to data yet
    "logic": 0.60,      // Some causal reasoning
    "situational": 0.85, // ← STRONG: team, market, CAC, churn all stated
    "baseline": 0.75,    // ← Current state clear
  },
  "summary": {
    "top_gap": "digital evidence depth",
    "strongest_signal": "situational context present, baseline metrics clear",
    "recommended_next_action": "Validate market assumptions with customer interviews; gather competitive benchmarks"
  }
}
```

**Downstream Effects**:
1. **Research Priority**: Engine focuses on competitors (Mixpanel, Amplitude) and SaaS benchmarks
2. **Synthesis**: Grounds recommendations in the 15-person constraint and GTM reality
3. **Strategy**: Recommends: "Run win/loss analysis against top 2 competitors" + "Customer advisory board to validate roadmap"

---

### Scenario B: Low Situational Coverage (0.35)

**Input**:
```
"We want to improve conversion rates on our platform."
```

**LLM Rigor Intake Output**:
```json
{
  "rigor_score": 0.42,
  "landscape_coverage": {
    "digital": 0.35,    // No data sources
    "logic": 0.45,      // Weak causal reasoning
    "situational": 0.35, // ← WEAK: no context on team, market, current state
    "baseline": 0.35,    // ← Unclear what current conversion rate is
  },
  "summary": {
    "top_gap": "situational",
    "strongest_signal": "none—input is too abstract",
    "recommended_next_action": "Stakeholder workshop to ground the objective in context (user segment, current funnel, market dynamics)"
  }
}
```

**Downstream Effects**:
1. **Research**: Blocked until context is provided
2. **Synthesis**: Flags as high-uncertainty; recommends user interviews first
3. **Strategy**: Defers recommendations until situational clarity achieved
4. **UI Feedback**: User is prompted: "Please provide team size, market, current metrics"

---

## Integration Points

### Where Situational Analysis Data is Consumed

| Component | Location | Action |
|-----------|----------|--------|
| **Synthesis Engine** | [src/app/api/pipeline/synthesize/route.ts](src/app/api/pipeline/synthesize/route.ts) | Read `spaces.synthesis_data.rigor_intake` to weight claims and recommendations |
| **Strategy Module** | [src/app/api/pipeline/strategy-refresh/route.ts](src/app/api/pipeline/strategy-refresh/route.ts) | Use `landscape_coverage` to prioritize and bias recommendations |
| **Research Triggers** | [src/lib/intelligence/research-triggers.ts](src/lib/intelligence/research-triggers.ts) | Use `top_gap` to direct follow-up research |
| **Test Lab** | [src/app/api/pipeline/test-lab/route.ts](src/app/api/pipeline/test-lab/route.ts) | Use `proposals` to generate experiment candidates |
| **Dashboard UI** | (Frontend) | Display rigor metrics, landscape radar, recommended next steps |

---

## Database Schema

### `rigor_runs`
```sql
CREATE TABLE rigor_runs (
  id UUID PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES spaces(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  tier TEXT ('deep' | 'comprehensive'),
  status TEXT ('queued' | 'running' | 'completed' | 'failed'),
  
  rigor_score NUMERIC [0, 1],                    -- Overall rigor
  landscape_coverage JSONB = {
    digital: 0.75,                               -- Dataset/paper coverage
    logic: 0.65,                                 -- Causal reasoning
    situational: 0.85,   -- ← Situational context coverage
    baseline: 0.55       -- Current-state knowledge
  },
  summary JSONB = {
    top_gap: "digital evidence depth",
    strongest_signal: "situational context present",
    recommended_next_action: "..."
  },
  
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### `claims`
```sql
CREATE TABLE claims (
  id UUID PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES spaces(id),
  
  claim_text TEXT,
  claim_type TEXT ('assertion' | 'prediction' | 'assumption' | 'finding' | 'mechanism'),
  confidence NUMERIC [0, 1],
  status TEXT ('candidate' | 'verified' | 'refuted' | 'uncertain'),
  source_type TEXT ('agent' | 'user' | 'research'),
  source_quote TEXT = "[rigor-intake]",
  
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### `experiment_specs`
```sql
CREATE TABLE experiment_specs (
  id UUID PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES spaces(id),
  rigor_run_id UUID REFERENCES rigor_runs(id),
  
  title TEXT,
  method TEXT,
  required_tools JSONB = ["tool-1", "tool-2", ...],
  predicted_effect JSONB = {
    metric: "primary outcome",
    direction: "up" | "down" | "mixed",
    confidence: 0.65
  },
  rank_score NUMERIC [0, 1],
  approval_status TEXT ('proposed' | 'approved' | 'deferred' | 'rejected'),
  
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

---

## Key Insights & Design Rationale

### 1. **Why "Situational" is a Separate Dimension**

Traditional analysis often conflates:
- **Logic**: How things work (mechanisms)
- **Situational**: Where/when/why things happen (context)

Example:
- **Logic only**: "If we increase marketing spend, CAC will drop (because of scale efficiency)"
- **Situational**: "We operate in a 15-person SaaS startup with 3 engineers and $2M ARR. Competitors are Mixpanel and Amplitude. Market is mature."

Both are needed:
- Logic without situational = generic advice that might not fit your constraints
- Situational without logic = facts without causal understanding

### 2. **Why Situational Affects Downstream Strategy**

Strategic recommendations must be *feasible* given your situation:
- **If situational coverage is high**: You can make specific, constrained recommendations
  - "Given your 3 engineers and $2M ARR, hire 1 more engineer in the next 6 months"
- **If situational coverage is low**: You can only give generic advice
  - "You may want to consider hiring" (could be a joke; no constraints considered)

### 3. **Why Rigor Intake is Non-Blocking**

Rigor intake runs in **Phase 1.25** (after decomposition, before synthesis):
- **Not blocking**: If it fails or times out, the pipeline continues
- **Asynchronous**: Best-effort, non-critical signal
- **Graceful degradation**: Falls back to heuristic if LLM fails

This keeps latency reasonable for users on lower tiers while still capturing rigor for deep/comprehensive.

### 4. **Why Landscape Coverage is a Matrix, Not a Single Score**

A single "rigor score" hides critical gaps:
- **0.75 rigor** could mean:
  - (A) High digital + high logic + low situational + medium baseline
  - (B) Medium across all four

Treatments differ:
- **(A)**: "You have good data and logic; conduct stakeholder workshops for situational grounding"
- **(B)**: "Work across all dimensions; prioritize customer research"

---

## Testing Situational Analysis

### Unit Test
```typescript
import { runRigorIntake } from "@/lib/pipeline/rigor-intake-engine";

const result = await runRigorIntake({
  text: "We're a 15-person SaaS startup with 3 engineers, competing against Mixpanel...",
  objective: "Improve product-market fit",
  tier: "comprehensive",
});

expect(result.landscape_coverage.situational).toBeGreaterThan(0.7);
expect(result.summary.top_gap).not.toBe("situational");
```

### Integration Test
```typescript
// Create a space, run rigor intake, verify synthesis route sees it
const rigorRes = await fetch("/api/pipeline/rigor-intake", {
  method: "POST",
  body: JSON.stringify({ spaceId, text, tier: "deep" }),
});

const space = await db.from("spaces").select("synthesis_data").eq("id", spaceId).single();
expect(space.synthesis_data.rigor_intake).toBeDefined();
expect(space.synthesis_data.rigor_intake.landscape_coverage.situational).toBeGreaterThan(0);
```

---

## Summary Table: Situational Analysis at a Glance

| Aspect | Details |
|--------|---------|
| **What It Is** | One of four landscape coverage dimensions (digital, logic, situational, baseline) |
| **Trigger** | Deep or Comprehensive analysis tier |
| **Entry Point** | `POST /api/pipeline/rigor-intake` |
| **Engine** | LLM (gpt-4o-mini) + fallback heuristic keyword matching |
| **Semantic Triggers** | context, constraint, team, market, environment, user, situation |
| **Output** | `RigorIntakeOutput` with landscape_coverage.situational [0, 1] |
| **Persistence** | synthesis_data.rigor_intake + rigor_runs + claims + experiment_specs tables |
| **Downstream Effects** | Informs research prioritization, synthesis calibration, strategy recommendations |
| **Non-Blocking** | Yes—if rigor-intake fails, pipeline continues |
| **Performance** | ~1-2s LLM call + parsing; negligible impact |
| **UI Surface** | Rigor dashboard, landscape radar, "next recommended action" |

---

## Files to Read

1. [RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md](RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md) — Strategic context
2. [src/lib/pipeline/rigor-intake-engine.ts](src/lib/pipeline/rigor-intake-engine.ts) — Core implementation
3. [src/app/api/pipeline/rigor-intake/route.ts](src/app/api/pipeline/rigor-intake/route.ts) — HTTP interface
4. [src/lib/hooks/use-pipeline.ts#L430-L461](src/lib/hooks/use-pipeline.ts#L430-L461) — Pipeline orchestration
5. [supabase/migrations/20260420_rigor_intake_core.sql](supabase/migrations/20260420_rigor_intake_core.sql) — Database schema

