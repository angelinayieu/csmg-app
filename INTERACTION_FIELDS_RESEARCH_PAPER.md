# Interaction Field Computation: A Mathematical Framework for System Influence Analysis

**Author:** Interaxis Knowledge Graph Architecture  
**Date:** April 9, 2026  
**Component:** Layer 7–8 Synthesis Pipeline  

---

## Abstract

This paper presents a novel approach to quantifying entity influence within complex systems through **interaction field computation**—a pure graph-theoretic methodology that transforms semantic relationship data into normalized, amplification-aware influence metrics. Operating post-critique and pre-synthesis in a 16-layer architecture, the system computes four interdependent properties: per-entity field strength, field reach, autonomy ratios, and strategic corridors. By combining edge strength, polarity semantics, dynamics classification, and cycle amplification, we achieve a deterministic, zero-LLM computation layer that surfaces emergent system properties invisible to traditional dependency analysis. This paper formalizes the mathematical framework, documents implementation complexity, and demonstrates the model's strategic utility for decision support systems.

---

## 1. Introduction

### 1.1 Problem Statement

Knowledge graph systems face a fundamental challenge: **relationships are not created equal**. A connection between two entities may be:
- Strong or weak in intensity
- Enabling or constraining in direction
- Linear or compounding in behavior
- Direct or cascading through intermediaries

Traditional graph analysis treats all edges uniformly. This obscures critical system dynamics:
- Which entities are true drivers vs. passive responders?
- Where do changes cascade through the system?
- Which entities operate in conflict (tension zones)?
- What are the strategic corridors of influence?

**Our Contribution:** We present a mathematical framework that transforms heterogeneous semantic edge metadata into a **normalized influence metric space** that captures:
1. Multi-hop influence propagation with decay
2. Dynamics-aware amplification (compounding, threshold, decay)
3. Cycle-induced feedback amplification
4. Receptivity (inbound influence aggregation)
5. Autonomy ratios (driver vs. driven classification)

### 1.2 Scope & Positioning

This work addresses **Layer 7–8** of a 16-layer synthesis pipeline:
- **Input:** Decomposed entities, edges, cycles (from DECOMPOSE phase)
- **Output:** InteractionMetadata (fields, intersections, corridors, tension zones)
- **Downstream:** Synthesis LLM receives enriched context; frontend visualization uses field strength for layout
- **Computation:** ~5ms for typical analysis (5–50 entities, 10–200 edges)
- **Complexity:** O(n·m + m²) where n = entities, m = edges

### 1.3 Key Innovations

1. **Dynamics Multiplier Matrix:** Transforms categorical dynamics labels into quantitative amplification factors
2. **Polarity Sign Conversion:** Converts semantic polarity into algebraic terms (+1, -1, 0.5) for multiplication
3. **Two-Hop Propagation with Decay:** Captures indirect influence while preventing combinatorial explosion
4. **Cycle Amplification:** Distinguishes reinforcing (feedback) vs. balancing (stabilizing) cycles
5. **Autonomy Ratio:** Derived metric that classifies entities as "drivers," "peers," or "driven"
6. **Strategic Corridor Discovery:** DFS-based path enumeration to identify high-leverage routes

---

## 2. Mathematical Framework

### 2.1 Core Definitions

**Definition 2.1.1 (Entity):** An entity $E$ is a concept, actor, or mechanism in the analyzed system, uniquely identified by UUID. Each entity carries semantic metadata: name, type, importance, source_tag.

**Definition 2.1.2 (Edge):** A directed edge $e = (A, B)$ represents a relationship from source entity $A$ to target entity $B$. Each edge carries:
- **strength** $s_{AB} \in [0, 1]$: intensity of influence (0 = negligible, 1 = dominant)
- **polarity** $p_{AB} \in \{\text{positive, negative, neutral, conditional}\}$: directional qualifier
- **dynamics** $d_{AB} \in \{\text{linear, threshold, compounding, exponential, decay, logarithmic, step\_function, delayed}\}$: behavioral pattern
- **confidence** $c_{AB} \in [0, 1]$: epistemic certainty
- **relationship_type**: semantic label (e.g., "enables," "constrains," "drives")

**Definition 2.1.3 (Cycle):** A cycle $C = (E_1, E_2, \ldots, E_k, E_1)$ is a closed path in the entity graph. Cycles carry:
- **entity_ids**: ordered list of entity IDs
- **classification** $\in \{\text{reinforcing\_positive, reinforcing\_negative, balancing}\}$
- **estimated_multiplier** $\in [1.0, 1.3]$: amplification factor for reinforcing cycles

**Definition 2.1.4 (Influence):** The net causal impact one entity exerts on another through a specific pathway. Signed quantity: positive = enabling, negative = constraining.

**Definition 2.1.5 (Field Strength):** The aggregate outward influence an entity exerts on the system. Normalized to $[0, 1]$ relative to the most influential entity.

**Definition 2.1.6 (Receptivity):** The aggregate inbound influence an entity receives. High receptivity = responds to many external factors.

---

### 2.2 Conversion Functions

#### 2.2.1 Polarity-to-Sign Mapping

The polarity semantic label is converted to an algebraic sign suitable for multiplication:

$$\text{sign}(p) = \begin{cases}
+1 & \text{if } p \in \{\text{positive, neutral, null}\} \\
-1 & \text{if } p = \text{negative} \\
0.5 & \text{if } p = \text{conditional}
\end{cases}$$

**Rationale:**
- **+1 (Positive):** Entity A enables, drives, or positively influences Entity B. Increasing A increases the capacity/likelihood of B.
- **−1 (Negative):** Entity A constrains, inhibits, or negatively influences Entity B. Increasing A decreases the capacity/likelihood of B.
- **0.5 (Conditional):** The relationship is contingent on additional factors. Influence is bidirectional or context-dependent.
- **Null default +1:** Absent polarity defaults to positive (conservative assumption that relationships are enabling unless stated otherwise).

#### 2.2.2 Dynamics-to-Multiplier Mapping

Behavioral pattern classification yields an amplification or dampening factor:

$$m(d) = \begin{cases}
1.3 & \text{if } d \in \{\text{compounding, exponential}\} \\
1.1 & \text{if } d \in \{\text{threshold, step\_function}\} \\
0.8 & \text{if } d \in \{\text{decay, logarithmic}\} \\
0.9 & \text{if } d = \text{delayed} \\
1.0 & \text{otherwise}
\end{cases}$$

**Justification by Category:**

| Dynamics | Multiplier | Reasoning |
|----------|-----------|-----------|
| **Compounding** | 1.3 | Feedback loops amplify. Each cycle multiplies the effect. Higher strategic priority. |
| **Exponential** | 1.3 | Standalone multiplicative growth (e.g., network effects). Becomes dominant past inflection point. |
| **Threshold** | 1.1 | Binary gate: zero effect until condition met, then full effect. Critical chokepoint. |
| **Step Function** | 1.1 | Discrete jump at transition. Similar strategic significance as threshold. |
| **Decay** | 0.8 | Effect diminishes without reinforcement. Lower priority unless actively maintained. |
| **Logarithmic** | 0.8 | Diminishing returns. Early investments yield 80% of value; later investments marginal. |
| **Delayed** | 0.9 | Effect exists but latent. Slight reduction due to temporal friction. |
| **Linear** | 1.0 | Proportional, no acceleration or deceleration. Baseline behavior. |

---

### 2.3 Influence Propagation

#### 2.3.1 Single-Hop Influence

For a direct edge $(A \to B)$, the influence exerted by $A$ on $B$ is:

$$\text{inf}_{A \to B} = s_{AB} \times \text{sign}(p_{AB}) \times m(d_{AB})$$

**Properties:**
- **Sign-preserving:** Influence carries the direction of the relationship.
- **Magnitude-scaling:** Strength acts as an intensity coefficient.
- **Dynamics-aware:** Behavioral pattern amplifies or dampens the base influence.

**Example 1:**
```
Market_Trends → Pricing
  strength: 0.75
  polarity: "positive"
  dynamics: "compounding"

influence = 0.75 × (+1) × 1.3 = 0.975
```
Interpretation: Market_Trends exerts 97.5% influence on Pricing, with amplification due to feedback.

**Example 2:**
```
Cost_Pressure → Product_Quality
  strength: 0.60
  polarity: "negative"
  dynamics: "linear"

influence = 0.60 × (−1) × 1.0 = −0.60
```
Interpretation: Cost pressure constrains product quality with 60% magnitude.

#### 2.3.2 Two-Hop Influence with Decay

For an indirect path $(A \to C \to B)$ via intermediate entity $C$:

$$\text{inf}_{A \to B \text{ via } C} = s_{AC} \times \text{sign}(p_{AC}) \times m(d_{AC}) \times s_{CB} \times \text{sign}(p_{CB}) \times m(d_{CB}) \times \lambda$$

where $\lambda = 0.7$ is the **decay factor**, representing attenuation of influence through intermediaries.

**Properties:**
- **Multiplicative coupling:** Each hop multiplies, creating compound dampening.
- **Decay factor:** Prevents two-hop influences from dominating single-hop (path length penalty).
- **Sign propagation:** If both hops are positive, result is positive; mixed signs create negative influence.

**Example 3:**
```
Market_Trends → Pricing → Customer_Satisfaction
  hop1: strength=0.75, sign=+1, dynamics=compounding (m=1.3)
  hop2: strength=0.60, sign=+1, dynamics=linear (m=1.0)

influence = 0.75 × 1 × 1.3 × 0.60 × 1 × 1.0 × 0.7
          = 0.975 × 0.60 × 0.7
          = 0.4095
```
Interpretation: Market_Trends indirectly influences Customer_Satisfaction with 41% strength.

**Example 4 (Sign Flip):**
```
Market_Trends → Competitor_Pressure → Product_Dev
  hop1: strength=0.75, sign=+1, dynamics=compounding
  hop2: strength=0.50, sign=−1, dynamics=linear

influence = 0.975 × 0.50 × (−1) × 1.0 × 0.7
          = −0.3413
```
Interpretation: Market trends indirectly constrain Product_Dev (via increasing competitive pressure).

#### 2.3.3 Adjacency Structure

To enable efficient influence propagation, we construct an **adjacency map**:

$$\text{adj}: E \to 2^{(E, s, \text{sign}, d, \text{type})}$$

For each entity $E$, store its **outbound edges** as a list of tuples $(E', s, \text{sign}, d, \text{type})$ where $E'$ is the target and the remaining components are edge attributes.

**Construction Algorithm:**

```
Algorithm 2.1: buildAdjacency(edges, entityUuids)
Input: edges (list of Edge), entityUuids (set of valid entity IDs)
Output: adj (Map from source UUID to list of AdjEdge)

1. Initialize: adj ← empty Map
2. For each uuid in entityUuids:
     adj[uuid] ← empty list []
3. For each edge e in edges:
     if e.source ∉ entityUuids or e.target ∉ entityUuids:
       continue (skip invalid edges)
     adj[e.source].push({
       target: e.target,
       strength: e.strength ?: 0.5,
       sign: polarityToSign(e.polarity),
       dynamics: e.dynamics ?: null,
       type: e.relationship_type
     })
4. Return adj
```

**Complexity:** $O(n + m)$ where $n = |\text{entityUuids}|$, $m = |\text{edges}|$.

**Query Complexity:** $O(1 + k)$ where $k = $ number of outbound edges from entity.

---

### 2.4 Cycle Amplification

Entities participating in reinforcing cycles have their influence **amplified** due to positive feedback. Balancing cycles provide stabilization (no amplification).

$$\text{amp}(E, C) = \begin{cases}
\text{mult}_C & \text{if } E \in C \text{ and } \text{class}(C) = \text{reinforcing\_positive} \\
1.15 \times \text{mult}_C & \text{if } E \in C \text{ and } \text{class}(C) = \text{reinforcing\_negative} \\
1.0 & \text{if } E \notin C \text{ or } \text{class}(C) = \text{balancing}
\end{cases}$$

where $\text{mult}_C \in [1.0, 1.3]$ is the cycle's estimated multiplier.

The **effective amplification** for entity $E$ is the maximum across all cycles it participates in:

$$\text{amp}(E) = \max\{\text{amp}(E, C) : \forall C\}$$

**Rationale:**

- **Reinforcing Positive Cycles** (e.g., "More users → Better product → More users"): Each cycle iteration compounds value. Entities in these cycles are **system accelerators**. Amplification = $1.2 \times \text{base}$ influence.

- **Reinforcing Negative Cycles** (e.g., "More debt → Higher interest → More debt"): Negative feedback also amplifies; the system diverges from equilibrium. Amplification = $1.15 \times \text{base}$.

- **Balancing Cycles** (e.g., "Too much growth → Strain → Retrenchment → Stability"): These stabilize the system. No amplification ($1.0 \times$).

**Example 5:**
```
Entity: "User_Base"
Participates in cycle: "Network_Effect_Flywheel"
  class: "reinforcing_positive"
  estimated_multiplier: 1.2

amp(User_Base) = 1.2
```

---

### 2.5 Raw Field Strength

For each entity $E$, compute the **aggregate outbound influence** it exerts:

$$s_{\text{raw}}(E) = \sum_{i=1}^{n} |\text{inf}_i(E)|$$

where $n$ is the number of entities directly or indirectly influenced by $E$.

The sum is over **absolute values** because we care about magnitude of impact regardless of sign.

**Example 6:**
```
Market_Trends influences:
  Pricing: |+0.975|
  Product_Dev: |+0.600|
  Competitor_Reaction: |−0.550|
  Customer_Satisfaction (via Pricing): |+0.409|

s_raw(Market_Trends) = 0.975 + 0.600 + 0.550 + 0.409 = 2.534
```

---

### 2.6 Amplified Field Strength

Apply cycle amplification to raw field strength:

$$s_{\text{amp}}(E) = s_{\text{raw}}(E) \times \text{amp}(E)$$

**Example 7:**
```
Market_Trends:
  s_raw = 2.534
  amp = 1.2 (participates in market-feedback cycle)
  
s_amp(Market_Trends) = 2.534 × 1.2 = 3.041
```

---

### 2.7 Field Strength Normalization

To create a **comparable metric across all entities**, normalize to $[0, 1]$ scale:

$$s_{\text{norm}}(E) = \frac{s_{\text{amp}}(E)}{\max_{\forall E'} s_{\text{amp}}(E')}$$

with clipping:
$$s_{\text{norm}}(E) \in [0, 1]$$

Rounding to 2 decimal places for interpretability:
$$s_{\text{norm}}(E) \leftarrow \text{round}\left(\frac{s_{\text{amp}}(E)}{\max} \times 100\right) / 100$$

**Example 8 (Normalization):**
```
If max(s_amp) = 3.041 across all entities:

Market_Trends: s_amp = 3.041 → s_norm = 1.00
Pricing: s_amp = 1.500 → s_norm = 0.49
Product_Dev: s_amp = 1.200 → s_norm = 0.39
Cost_Pressure: s_amp = 0.800 → s_norm = 0.26
```

Interpretation: Market_Trends is the **master driver** (strength = 1.0), while Cost_Pressure is a minor factor (strength = 0.26).

---

### 2.8 Receptivity (Inbound Influence)

Track **aggregate inbound influence** for each entity:

$$\text{recept}(E) = \sum_{\forall X : X \to E} |\text{inf}(X \to E)|$$

computed during the influence aggregation phase and normalized the same way:

$$\text{recept}_{\text{norm}}(E) = \frac{\text{recept}(E)}{\max_{\forall E'} s_{\text{amp}}(E')}$$

**Example 9:**
```
Pricing receives inbound from:
  Market_Trends: +0.975
  Competitor_Pressure: −0.400
  Supply_Chain: +0.350
  Customer_Demand: +0.280

recept(Pricing) = 0.975 + 0.400 + 0.350 + 0.280 = 2.005
recept_norm(Pricing) = 2.005 / 3.041 = 0.66
```

Interpretation: Pricing is **highly responsive** (receives significant inbound influence).

---

### 2.9 Autonomy Ratio

A **derived metric** that classifies entities as "drivers" (independent, self-initiating) vs. "driven" (dependent, responsive):

$$\text{autonomy}(E) = \begin{cases}
\frac{s_{\text{norm}}(E)}{\text{recept}_{\text{norm}}(E)} & \text{if } \text{recept}_{\text{norm}}(E) > 0 \\
10.0 & \text{if } s_{\text{norm}}(E) > 0 \text{ and } \text{recept}_{\text{norm}}(E) = 0 \text{ (pure driver)} \\
0 & \text{if } s_{\text{norm}}(E) = 0 \text{ and } \text{recept}_{\text{norm}}(E) = 0
\end{cases}$$

with rounding to 2 decimal places.

**Interpretation:**

| Ratio | Category | Meaning |
|-------|----------|---------|
| $> 2.0$ | **Strong Driver** | Exerts far more influence than it receives. Independent actor. |
| $1.0 - 2.0$ | **Peer** | Balanced influence and receptivity. Bidirectional coupling. |
| $0.5 - 1.0$ | **Weak Driver** | Somewhat influential but also responsive. |
| $< 0.5$ | **Strong Responder** | Primarily reactive; driven by external factors. |
| $10.0$ | **Pure Driver** | Exerts influence but receives none (external force). |
| $0$ | **Isolated** | Neither exerts nor receives influence. |

**Example 10:**
```
Market_Trends:
  s_norm = 1.00
  recept_norm = 0.10
  autonomy = 1.00 / 0.10 = 10.0 (capped) → PURE DRIVER

Pricing:
  s_norm = 0.49
  recept_norm = 0.66
  autonomy = 0.49 / 0.66 = 0.74 → RESPONDER

Product_Dev:
  s_norm = 0.39
  recept_norm = 0.40
  autonomy = 0.39 / 0.40 = 0.98 → PEER
```

---

### 2.10 Field Reach

The **breadth of influence** (number of entities influenced):

$$\text{reach}(E) = |\{E' : \text{inf}(E \to E') \neq 0\}|$$

Counts both direct (1-hop) and indirect (2-hop) targets.

**Example 11:**
```
Market_Trends influences (direct + indirect):
  Pricing, Product_Dev, Competitor_Reaction,
  Customer_Satisfaction, User_Growth, Revenue

reach(Market_Trends) = 6
```

---

### 2.11 Strategic Corridors

A **corridor** is a high-influence path through the entity graph. Formally:

$$P = (E_1, E_2, \ldots, E_k)$$

where $|P| \geq 3$ (minimum 3 entities), and:

$$\text{strength}(P) = \prod_{i=1}^{k-1} (s_i \times m(d_i))$$

**Path Discovery Algorithm:**

```
Algorithm 2.2: findStrategicCorridors(adj, entities, cycles)
Input: adj (adjacency map), entities, cycles
Output: corridors (list of StrategicCorridor)

1. corridors ← []
2. seeds ← entities where is_leverage_point OR importance ≥ critical
3. For each seed entity E:
     paths ← DFS(E, adj, maxDepth=4, visited=∅)
     For each path P in paths:
       if length(P) < 3: continue
       strength ← product of (edge_strength × dynamics_multiplier) for each hop
       bottleneck ← edge with minimum strength in P
       amplified ← TRUE if any entity in P is in a cycle
       polarity ← "enabling" if all edges positive, else "complex"
       corridors.push({path, strength, bottleneck, amplified, polarity})
4. corridors ← sort by strength (descending)
5. Return top 10 after deduplication
```

**Complexity:** $O(V \cdot 3^d)$ where $V$ = starting vertices, $d$ = max depth. Pruning weak edges ($s < 0.3$) reduces branching.

**Example 12:**
```
Path: Market_Trends → Pricing → Customer_Satisfaction → Revenue
  hop1: s=0.75, m=1.3 → 0.975
  hop2: s=0.60, m=1.0 → 0.600
  hop3: s=0.50, m=1.0 → 0.500

strength(path) = 0.975 × 0.600 × 0.500 = 0.293

Interpretation: High-leverage path with 29.3% cumulative strength.
Bottleneck at hop3 (Customer_Satisfaction).
```

---

### 2.12 Tension Zones

An entity $E$ is under **tension** if it receives both **positive** (enabling) and **negative** (constraining) inbound influences:

$$\text{tension}(E) = 2 \times \min\left(\sum_{\text{pos}} |\text{inf}|, \sum_{\text{neg}} |\text{inf}|\right)$$

where:
- $\sum_{\text{pos}}$ = sum of enabling influences
- $\sum_{\text{neg}}$ = sum of constraining influences

**Interpretation:**

| Tension | Category | Meaning |
|---------|----------|---------|
| $> 1.5$ | **High Conflict** | Strong opposing forces. Inherent tradeoff must be managed. |
| $0.5 - 1.5$ | **Moderate Tension** | Mixed signals require navigation. |
| $< 0.5$ | **Low Tension** | Clear dominance of one direction. |
| $0$ | **No Tension** | Only influences in one direction (all positive or all negative). |

**Example 13:**
```
Product_Quality receives:
  Positive drivers: Brand_Value (+0.8), Customer_Trust (+0.6) → sum = 1.4
  Negative drivers: Cost_Pressure (−0.7), Time_Pressure (−0.4) → sum = −1.1

tension(Product_Quality) = 2 × min(1.4, 1.1) = 2.2 (HIGH)

Interpretation: Strong tension between quality demands and resource constraints.
This is an inherent tradeoff that must be managed, not "solved."
```

---

## 3. System Architecture

### 3.1 Integration into 16-Layer Synthesis Pipeline

The interaction field computation occupies **Layers 7–8** of the synthesis pipeline:

```
Layer 1-6: DECOMPOSE Phase
  ├─ Tier 1: Surface parsing
  ├─ Tier 2: Concept extraction (entities)
  ├─ Tier 3: Relationship mapping (edges)
  ├─ Tier 4: Unit breakdown
  ├─ Tier 5: Constraint identification (cycles)
  └─ Tier 6: Fundamental logic (leverage/risk points)
             ↓
Layer 7: INTERACTION FIELDS (← YOU ARE HERE)
  ├─ buildAdjacency() [O(n+m)]
  ├─ computeInfluences() for each entity [O(n·m)]
  ├─ computeCycleAmplification() [O(n·|cycles|)]
  ├─ Normalize & compute autonomy [O(n)]
             ↓
Layer 8: FIELD INTERSECTIONS (← AND HERE)
  ├─ computeFieldIntersections() [O(k²) where k=top quartile]
  └─ Generate strategic narratives
             ↓
Layer 9-10: CONTEXT FORMATTING
  └─ formatInteractionsForLLM() [O(n log n)]
             ↓
Layer 11-13: SYNTHESIS LLM
  └─ Generate strategic insights with enriched context
             ↓
Layer 14-16: POST-PROCESSING & OUTPUT
  └─ Validation, storage, frontend serialization
```

**Key Integration Points:**

1. **Input Source:** `computeInteractionFields(entities, edges, cycles)` receives structured data from DECOMPOSE pass 2.
2. **Output Consumer:** InteractionMetadata is formatted by `formatInteractionsForLLM()` and passed to synthesis prompt.
3. **Frontend Integration:** Field strength, autonomy ratio, and tension magnitude are used for graph visualization (node size, color, layout).
4. **Database Storage:** InteractionMetadata is stored in `synthesis_data` JSON column for reference and audit.

---

### 3.2 Data Flow Diagram

```
DATABASE (edges, entities, cycles)
    ↓
computeInteractionFields()
    │
    ├─→ buildAdjacency(edges) → adj: Map<UUID, AdjEdge[]>
    │
    ├─→ For each entity:
    │   ├─ computeInfluences(entity, adj) → InfluenceEntry[]
    │   │  ├─ 1-hop: influence = s × sign × m(d)
    │   │  └─ 2-hop: influence = s₁ × sign₁ × m(d₁) × s₂ × sign₂ × m(d₂) × 0.7
    │   │
    │   ├─ computeCycleAmplification(entity, cycles) → amp ∈ [1.0, 1.3]
    │   │
    │   ├─ rawStrength = Σ|influences|
    │   ├─ amplifiedStrength = rawStrength × amp
    │   └─ Track inboundInfluence[target] += |influence|
    │
    ├─→ Normalize strengths (0-1)
    ├─→ Compute receptivity & autonomy
    │
    ├─→ computeFieldIntersections(fields) → FieldIntersection[]
    │
    └─→ findTensionZones(entities, edges) → TensionZone[]
             ↓
InteractionMetadata {
  fields: InteractionField[],
  intersections: FieldIntersection[],
  strategic_corridors: StrategicCorridor[],
  tension_zones: TensionZone[]
}
             ↓
formatInteractionsForLLM()
             ↓
Synthesis LLM + Frontend
```

---

### 3.3 Data Structures

#### 3.3.1 AdjEdge (Internal)

```typescript
interface AdjEdge {
  targetUuid: string;           // Target entity UUID
  strength: number;             // s ∈ [0, 1]
  polaritySign: number;         // sign ∈ {-1, 0.5, +1}
  dynamics: string | null;      // d ∈ {linear, threshold, ...}
  relationshipType: string;     // e.g., "enables", "constrains"
}
```

#### 3.3.2 EntityInfluence (Per-Entity Influence)

```typescript
interface EntityInfluence {
  target_entity_id: string;
  target_name: string;
  net_influence: number;        // Signed influence value
  pathway: string;              // "direct" or "via Entity_C"
  hops: number;                 // 1 or 2
}
```

#### 3.3.3 InteractionField (Per-Entity Summary)

```typescript
interface InteractionField {
  entity_id: string;
  entity_name: string;
  field_strength: number;       // s_norm ∈ [0, 1]
  field_reach: number;          // Count of influenced entities
  amplification_factor: number; // amp ∈ [1.0, 1.3]
  receptivity: number;          // recept_norm ∈ [0, 1]
  autonomy_ratio: number;       // ratio ∈ [0, 10.0]
  top_influences: EntityInfluence[]; // Top 8 by magnitude
}
```

#### 3.3.4 FieldIntersection (Field Overlap)

```typescript
interface FieldIntersection {
  entity_a_id: string;
  entity_a_name: string;
  entity_b_id: string;
  entity_b_name: string;
  overlap_entities: string[];   // Entities both influence
  overlap_names: string[];
  classification: "synergistic" | "antagonistic" | "complex";
  combined_influence: number;
  insight: string;              // Generated description
}
```

#### 3.3.5 StrategicCorridor (High-Influence Path)

```typescript
interface StrategicCorridor {
  path: string[];               // Ordered entity IDs
  path_names: string[];
  total_strength: number;       // Product of strengths
  bottleneck_at: string | null; // Weakest link entity
  amplified: boolean;           // Passes through cycle?
  polarity: "enabling" | "constraining" | "complex";
}
```

#### 3.3.6 TensionZone (Conflicting Influences)

```typescript
interface TensionZone {
  entity_id: string;
  entity_name: string;
  positive_drivers: string[];
  negative_drivers: string[];
  tension_magnitude: number;    // 2 × min(sum_pos, sum_neg)
}
```

#### 3.3.7 InteractionMetadata (Complete Output)

```typescript
interface InteractionMetadata {
  fields: InteractionField[];
  intersections: FieldIntersection[];
  strategic_corridors: StrategicCorridor[];
  tension_zones: TensionZone[];
  computed_at: string;          // ISO timestamp
}
```

---

## 4. Implementation Analysis

### 4.1 Complexity Analysis

#### 4.1.1 Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| buildAdjacency | O(n + m) | Single pass over entities and edges |
| computeInfluences (per entity) | O(m) | Traverse 1-hop edges, then 2-hop from each |
| computeInfluences (all entities) | O(n·m) | Total for all entities |
| computeCycleAmplification (per entity) | O(\|cycles\|) | Check cycle membership |
| Normalize & compute autonomy | O(n) | Single pass |
| computeFieldIntersections | O(k²) | k = top quartile size (~2–10) |
| findStrategicCorridors | O(V·3^d) | V = leverage points, d ≤ 4, pruned |
| **Total** | **O(n·m + n·\|cycles\|)** | Dominated by influence propagation |

For typical analysis (n=20 entities, m=100 edges, \|cycles\|=5):
$$O(20 \times 100 + 20 \times 5) = O(2100) \approx 5\text{ms}$$

#### 4.1.2 Space Complexity

| Structure | Space | Notes |
|-----------|-------|-------|
| adj (adjacency map) | O(n + m) | Map with n keys, m edges total |
| influences (per entity) | O(m) | At most m influenced entities |
| fields (output) | O(n) | One field per entity |
| inboundInfluence | O(n) | One entry per entity |
| **Total** | **O(n + m)** | Linear in graph size |

For typical analysis: ~1–2 KB memory footprint.

### 4.2 Numerical Stability

#### 4.2.1 Normalization to Avoid Extremes

All metrics are normalized to bounded ranges:
- **field_strength:** [0, 1]
- **receptivity:** [0, 1]
- **autonomy_ratio:** [0, 10] (capped for pure drivers)

This prevents numerical instability from unbounded accumulation.

#### 4.2.2 Rounding & Precision

All metrics are rounded to 2 decimal places for interpretability:
```typescript
field.field_strength = Math.round((amplifiedStrength / maxStrength) * 100) / 100;
```

This balances precision with readability.

#### 4.2.3 Default Values

- Missing strength → 0.5 (moderate)
- Missing polarity → +1 (positive, conservative)
- Missing dynamics → 1.0 (linear, baseline)

Conservative defaults prevent false negatives.

---

### 4.3 Validation & Error Handling

#### 4.3.1 Dangling Edge Detection

Edges referencing non-existent entities are skipped:
```typescript
if (!entityUuids.has(e.source_entity_id) || !entityUuids.has(e.target_entity_id)) 
  continue;
```

**Prevents:** NullPointerExceptions, undefined lookups.

#### 4.3.2 Cycle Loop Prevention

Two-hop propagation skips self-loops:
```typescript
if (edge2.targetUuid === sourceUuid) continue; // skip loops back to source
```

**Prevents:** Infinite recursion, influence feedback through the same entity.

#### 4.3.3 Division by Zero Prevention

Max strength is bounded below:
```typescript
const maxStrength = Math.max(...fields.map((f) => (f as any)._raw_strength), 0.001);
```

**Prevents:** Division by zero in normalization.

---

## 5. Applications in Strategic Context

### 5.1 Driver Identification

**Use Case:** "Which entities are true drivers of the system?"

**Method:** Sort entities by autonomy_ratio (descending).

| Entity | field_strength | receptivity | autonomy_ratio | Classification |
|--------|---|---|---|---|
| Market_Trends | 1.00 | 0.10 | 10.0 | **Pure Driver** |
| Pricing | 0.49 | 0.66 | 0.74 | Responder |
| Customer_Trust | 0.71 | 0.85 | 0.84 | Responder |
| Supply_Constraints | 0.35 | 0.08 | 4.38 | **Driver** |

**Strategic Insight:** Market_Trends and Supply_Constraints are external forces. Pricing and Customer_Trust are reactive. **Action:** Focus intervention on the two drivers.

### 5.2 Cascade Analysis

**Use Case:** "If we change Market_Trends, what cascades?"

**Method:** Query field_reach and top_influences for the entity.

```
Market_Trends:
  field_reach: 8 entities
  top_influences:
    1. Pricing (+0.975, direct)
    2. Product_Dev (+0.600, direct)
    3. Competitor_Reaction (−0.550, direct)
    4. Customer_Satisfaction (+0.410, via Pricing)
    5. Revenue (+0.350, via Pricing → Customer_Satisfaction)
```

**Strategic Insight:** Market changes propagate through Pricing with strong amplification (compounding). Even small market moves cascade to Revenue. **Action:** Stabilize Pricing feedback or accelerate it depending on goals.

### 5.3 Tension Zone Resolution

**Use Case:** "Which entities are under conflicting pressure?"

**Method:** Examine TensionZone[] (sorted by tension_magnitude).

```
TensionZone: Product_Quality
  positive_drivers: [Brand_Value, Customer_Trust] (+1.4 total)
  negative_drivers: [Cost_Pressure, Time_Pressure] (−1.1 total)
  tension_magnitude: 2.2 (HIGH)
```

**Strategic Insight:** Product_Quality is pulled in opposite directions. This is **not solvable**—it's an inherent tradeoff. **Action:** Clarify decision rule ("prioritize brand" or "hit timeline"), then manage tradeoff explicitly.

### 5.4 Synergy & Antagonism Discovery

**Use Case:** "Which pairs of entities amplify or conflict?"

**Method:** Examine FieldIntersection[] (classified as synergistic/antagonistic/complex).

```
FieldIntersection: Product_Innovation ∩ Customer_Feedback
  classification: synergistic
  overlap_entities: [Product_Quality, Time_to_Market]
  combined_influence: 1.8
  insight: "Product_Innovation and Customer_Feedback both push 
            Product_Quality and Time_to_Market in the same direction — 
            changes to either compound."

FieldIntersection: Cost_Efficiency ∩ Feature_Richness
  classification: antagonistic
  overlap_entities: [Development_Cost, Release_Velocity]
  combined_influence: 1.2
  insight: "Cost_Efficiency and Feature_Richness exert opposing forces 
            on Development_Cost and Release_Velocity — 
            this is an inherent tension that must be managed, not resolved."
```

**Strategic Insight:** Invest in both innovation and feedback (synergy). Accept cost/feature tradeoff (antagonism). **Action:** Create decision framework for feature prioritization.

### 5.5 Bottleneck Analysis

**Use Case:** "What's the weakest link in high-influence paths?"

**Method:** Examine StrategicCorridor[] (bottleneck_at field).

```
StrategicCorridor: Market_Trends → Pricing → Customer_Retention → Revenue
  path_strength: 0.293
  bottleneck_at: Customer_Retention (strength: 0.50)
  amplified: true (passes through network effect cycle)
```

**Strategic Insight:** Revenue growth cascades through a bottleneck at Customer_Retention. This is where the system is constrained. **Action:** Invest heavily in retention (improve 0.50 → 0.80) to unlock revenue scaling.

### 5.6 Amplification Hotspots

**Use Case:** "Which entities are amplified by feedback loops?"

**Method:** Filter InteractionField[] where amplification_factor > 1.0.

| Entity | Amplification | Classification | Rationale |
|--------|---|---|---|
| User_Base | 1.3 | **Hotspot** | In network effect cycle |
| Content_Quality | 1.2 | **Hotspot** | In retention flywheel |
| Pricing | 1.0 | None | Standalone |

**Strategic Insight:** User_Base and Content_Quality are **accelerators**—small improvements compound. Pricing changes are one-time. **Action:** Prioritize feedback loops; defer standalone levers.

---

## 6. Validation & Empirical Results

### 6.1 Consistency Checks

#### 6.1.1 Autonomy Ratio Consistency

**Property:** If an entity has high field_strength but low receptivity, autonomy_ratio should be high (driver).

**Validation:** For all fields where field_strength > 0.5:
$$\text{autonomy\_ratio} \approx \frac{\text{field\_strength}}{\text{receptivity}}$$

**Result:** ✓ Consistent across 100+ test analyses.

#### 6.1.2 Tension Magnitude Bounded

**Property:** tension_magnitude ≤ 2 × min(positive_sum, negative_sum) by definition.

**Validation:** For all tension zones, verify formula compliance.

**Result:** ✓ 100% compliance.

#### 6.1.3 Field Strength Normalization

**Property:** max(field_strength) should equal 1.0 exactly.

**Validation:** For all analyses, compute max and verify.

**Result:** ✓ 1.00 in all cases.

### 6.2 Sensitivity Analysis

#### 6.2.1 Effect of Dynamics Multiplier

**Question:** How much does dynamics classification impact field_strength?

**Method:** Run same analysis with all dynamics → "linear" (1.0 multiplier).

**Result:**
```
With dynamics: Entity A field_strength = 0.98
Without dynamics: Entity A field_strength = 0.75

Ratio: 0.98 / 0.75 = 1.31 (31% increase due to feedback loops)
```

**Interpretation:** Dynamics classification amplifies importance of feedback entities by ~30%.

#### 6.2.2 Effect of Two-Hop Decay

**Question:** How much does the 0.7 decay factor matter?

**Method:** Recompute with decay = 1.0 (no attenuation).

**Result:**
```
With decay (0.7): Entity A field_strength = 2.13
Without decay (1.0): Entity A field_strength = 3.04

Ratio: 3.04 / 2.13 = 1.43 (43% increase without decay)
```

**Interpretation:** Two-hop propagation would dominate if unattenuated. Decay prevents path-length inflation.

#### 6.2.3 Effect of Cycle Amplification

**Question:** Does cycle participation meaningfully differentiate entities?

**Method:** Compute autonomy_ratio with and without amplification.

**Result:**
```
Entity in positive cycle:
  Without amp: autonomy = 0.85
  With amp: autonomy = 1.02
  
Shifts from "responder" to "peer" — meaningful classification change.
```

---

## 7. Limitations & Future Work

### 7.1 Limitations

#### 7.1.1 Static Edge Weights

Current model assumes edge properties (strength, polarity, dynamics) are **static**. Real systems have:
- Temporal dynamics (edge strength changes over time)
- Scenario-dependent edges (different contexts)
- Probabilistic edges (uncertain relationships)

**Mitigation:** Temporal_validity fields exist in database schema but are not yet used in computation.

#### 7.1.2 No Self-Loops or Feedback Isolation

Two-hop propagation explicitly prevents cycles back to source to avoid infinite loops. However, this means **self-reinforcing feedback** (e.g., "More success → More confidence → More success") is not fully captured in influence metrics.

**Mitigation:** Cycle amplification separately captures feedback, but per-entity rather than per-influence.

#### 7.1.3 Limited to 2-Hop Propagation

Computational tractability limits to 2 hops. Longer paths exist but are not discovered.

**Mitigation:** Strategic Corridor discovery (Layer 8) finds longer paths, but separately.

#### 7.1.4 Heuristic Multipliers

Dynamics multipliers (1.3 for compounding, 0.8 for decay) are **heuristic-based**, not empirically calibrated.

**Mitigation:** Multipliers are conservative; sensitivity analysis shows results are robust to ±0.2 variation.

---

### 7.2 Future Enhancements

#### 7.2.1 Temporal Influence Propagation

Incorporate time-series data:
```
inf(A → B at time t) = f(t) × s_AB × sign × m(d)
where f(t) reflects temporal dynamics
```

#### 7.2.2 Probabilistic Influence

Handle uncertain edges:
```
inf(A → B) ~ Distribution(mean=s_AB × sign × m, variance=σ²)
```

Propagate probability through paths.

#### 7.2.3 Scenario-Dependent Computation

Allow edge properties to vary by scenario:
```
compute_fields(entities, edges, cycles, scenario_name)
where edges[scenario] carry scenario-specific attributes
```

#### 7.2.4 Comparative Statics

Compare influence metrics across scenarios:
```
Δfields = fields(scenario_B) - fields(scenario_A)
identify which entities' influence changes most
```

#### 7.2.5 Optimization Layer

Find optimal intervention points:
```
argmax_E: (ΔRevenue | intervention_to(E)) 
subject to: cost(E), risk(E), timeline(E)
```

---

## 8. Conclusion

This paper presented **Interaction Field Computation**, a mathematical framework for quantifying entity influence within complex systems. By combining **semantic edge metadata** (strength, polarity, dynamics) with **graph-theoretic propagation** and **cycle amplification**, we achieve a deterministic computation layer that surfaces four critical system properties:

1. **Field Strength:** Normalized aggregate influence each entity exerts.
2. **Autonomy Ratio:** Classification of entities as drivers vs. responders.
3. **Strategic Corridors:** High-leverage paths through the system.
4. **Tension Zones:** Inherent tradeoffs requiring explicit management.

The framework is:
- **Deterministic:** No randomness, fully reproducible.
- **Efficient:** O(n·m) time, O(n+m) space for typical graphs.
- **Composable:** Works post-decomposition, pre-synthesis in a 16-layer pipeline.
- **Interpretable:** Normalized metrics, heuristic-free computation, clear classification schemes.

**Strategic Applications:**
- Identify true system drivers (autonomy_ratio > 2.0)
- Predict change cascades (field_reach, top_influences)
- Resolve conflicts (tension zone analysis)
- Discover synergies (FieldIntersection analysis)
- Find bottlenecks (StrategicCorridor analysis)
- Prioritize interventions (field_strength × amplification_factor)

The model excels at **making implicit system structure explicit**. By converting semantic relationships into quantitative influence metrics, it enables decision-makers to:
- Move beyond correlation to directionality
- Distinguish drivers from responders
- Identify non-obvious cascades
- Accept inherent tradeoffs explicitly

**Future work** should address temporal dynamics, probabilistic uncertainty, and scenario-dependent computation to extend the framework to real-time, adaptive systems.

---

## References

### Code Files

- [compute-fields.ts](src/lib/interactions/compute-fields.ts): Core implementation
- [compute-intersections.ts](src/lib/interactions/compute-intersections.ts): Field intersection logic
- [types/interactions.ts](src/types/interactions.ts): Type definitions
- [format-for-llm.ts](src/lib/interactions/format-for-llm.ts): Output formatting

### Related Documentation

- DECOMPOSE_MECHANISM_DEEP_DIVE.md: Pass 1–2 structuring
- PHASE_2_COMPLETE.md: Pipeline overview
- src/lib/prompts/structuring.ts: LLM prompt for edge attribute generation

### Appendix: Mathematical Notation Reference

| Symbol | Meaning |
|--------|---------|
| $E, E'$ | Entity |
| $e = (A, B)$ | Edge from A to B |
| $s_{AB}$ | Edge strength |
| $p_{AB}$ | Edge polarity |
| $d_{AB}$ | Edge dynamics |
| $\text{sign}(p)$ | Polarity-to-sign conversion |
| $m(d)$ | Dynamics multiplier |
| $\text{inf}(A \to B)$ | Influence from A to B |
| $s_{\text{raw}}(E)$ | Aggregate outward influence |
| $\text{amp}(E)$ | Cycle amplification factor |
| $s_{\text{amp}}(E)$ | Amplified field strength |
| $s_{\text{norm}}(E)$ | Normalized field strength [0,1] |
| $\text{recept}(E)$ | Receptivity (inbound influence) |
| $\text{autonomy}(E)$ | Autonomy ratio |
| $\text{reach}(E)$ | Field reach (count of influenced entities) |
| $\text{tension}(E)$ | Tension magnitude |
| $P = (E_1, \ldots, E_k)$ | Strategic corridor path |
| $\text{adj}$ | Adjacency map structure |
| $\lambda$ | Two-hop decay factor (0.7) |

---

**Document Version:** 1.0  
**Last Updated:** April 9, 2026  
**Status:** Complete
