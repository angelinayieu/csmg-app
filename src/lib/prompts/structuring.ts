export const STRUCTURING_SYSTEM_PROMPT = `You are a parser. Convert the analysis below into a JSON object matching this exact schema. Return ONLY valid JSON with no markdown fencing, no explanation, no preamble.

Schema:
{
  "metadata": {
    "name": "string — a concise name for this analysis space (3-8 words)",
    "description": "string — one sentence describing the space",
    "space_prefix": "string — single uppercase letter (A, B, C, etc.)",
    "entity_count": number,
    "edge_count": number,
    "orphan_count": number,
    "cycle_count": number,
    "maturity": "actionable_now | waiting_on_dependency | theoretical | blocked",
    "activation_dependencies": ["string — what must be true before this is actionable"],
    "synthesis_text": "string — the full synthesis section text"
  },
  "entities": [
    {
      "entity_id": "C1",
      "name": "string — MUST be specific and semantically distinct from every other entity (e.g. 'Product quality flywheel' not just 'Quality'). Merge near-duplicates into one entity.",
      "description": "string — one sentence",
      "source_tag": "explicit | implicit | assumed",
      "entity_type": "string — e.g. capability, constraint, product, person, metric",
      "entity_category": "concrete | abstract | process | relational | epistemic",
      "layer": "string — e.g. core_entities, capabilities, constraints, dynamics, epistemic",
      "importance": "fundamental | critical | important | moderate",
      "confidence": 0.0-1.0,
      "is_leverage_point": boolean,
      "is_risk_point": boolean,
      "is_master_bottleneck": boolean,
      "blast_radius": number,
      "centrality_rank": number or null,
      "is_shared_variable": boolean,
      "is_decomposable": boolean,
      "ambiguity_type": "harmful | premature | strategic | null — classify any uncertain entity. harmful = must resolve before acting (blocking decision). premature = can't resolve yet, need more data (park it). strategic = keep ambiguous on purpose (optionality, negotiation leverage, exploration space). null = entity is well-understood, not ambiguous.",
      "epistemic_status": "observed | inferred | theorized | speculated | contested (optional — if epistemic classification is active, assign formal status to every entity based on evidence quality)",
      "toulmin_role": "claim | ground | warrant | backing | qualifier | rebuttal (optional — only if input has argument structure, tag entities by their role in the argument)",
      "marr_level": "computational | algorithmic | implementational (optional — only for system/product inputs, tag entities by their level of analysis)",
      "temporal_validity": {
        "valid_from": "string or null — when this entity becomes relevant (e.g. 'after Series A', 'Q3 2026', 'when prototype ships'). null if always relevant.",
        "valid_until": "string or null — when this entity expires or becomes irrelevant (e.g. 'until runway exhausted', '2027', 'until competitor launches'). null if indefinitely valid.",
        "decay_rate": "none | slow | moderate | fast | immediate — how quickly this entity's relevance degrades. 'none' = stable indefinitely. 'slow' = years. 'moderate' = months. 'fast' = weeks. 'immediate' = days.",
        "temporal_scope": "string or null — brief description of the time context (e.g. 'pre-product-market-fit window', 'current regulatory regime', 'while team is <5 people')"
      },
      "manifold": {
        "strategic": {
          "alignment_to_goal": "high | moderate | low | unknown — how directly this entity serves the user's primary objective",
          "optionality_value": "high | moderate | low — does this entity preserve future options (high) or lock in a path (low)?",
          "reversibility": "easily_reversible | costly_to_reverse | irreversible — can the user undo or change course on this?"
        },
        "operational": {
          "maturity": "proven | experimental | theoretical | unknown — how battle-tested is this?",
          "resource_intensity": "high | moderate | low — how much effort/money/time does this require?",
          "dependency_count": number,
          "controllability": {
            "kind": "fully_controllable | partially_controllable | gated | observable_only | null — D3: can the user pull this lever directly? Mirrors edge-level utility.actionability but answers it at the entity level. null when not applicable (epistemic entities, etc.)",
            "intervention_cost": {
              "estimate": "number — USD-equivalent DIRECT cost to MOVE the lever. Distinct from measurement_cost_estimate (cost to OBSERVE) AND from opportunity_cost (foregone alternatives). 0 = already paid / sunk cost (set is_sunk: true). OMIT the entire intervention_cost object if unknown — do NOT fabricate.",
              "confidence": "high | moderate | low",
              "recurrence": "one_time | recurring_monthly | recurring_yearly | recurring_continuous — strategically critical to disambiguate; a $10k one-time fix vs $1k/month recurring have radically different NPVs",
              "is_sunk": "boolean — true iff this cost is already paid. Ranker discounts sunk-cost framings to counter the sunk-cost fallacy.",
              "notes": "string — optional caveat"
            },
            "opportunity_cost": {
              "estimate": "number — USD-equivalent value of next-best alternative foregone. May exceed intervention_cost.estimate; that's normal and meaningful. Set when resource is fungible AND alternatives are abundant; OMIT when no good alternatives exist or the resource has no other use.",
              "confidence": "high | moderate | low",
              "alternative": "string — optional, what's being foregone (surfaces in UI as \"if you pull this, you can't pursue X\")",
              "notes": "string — optional caveat"
            },
            "cost_kind": "direct | opportunity_dominated | coordination_dominated | risk_adjusted_dominated | switching_dominated | hidden_externalities — which cost type DOMINATES this lever. Default to 'direct' only when you've genuinely considered the others and dollars dominate.",
            "time_to_effect": {
              "lag": "string — median lag between intervention and observable change. Use buckets (immediate, days, weeks, months, years) or a specific phrase (\"1-2 weeks\", \"end of Q3\")",
              "confidence": "high | moderate | low",
              "notes": "string — optional caveat"
            },
            "modulation_range": {
              "min": "number — only set when the lever is genuinely continuous",
              "max": "number",
              "unit": "string — mirrors measurement_unit when applicable"
            }
          }
        },
        "epistemic": {
          "evidence_strength": "empirical | theoretical | anecdotal | assumed — what supports this entity's existence/importance?",
          "consensus_level": "established | emerging | contested | unknown — do experts agree on this?",
          "falsifiability": "testable | partially_testable | unfalsifiable — can we verify if this entity matters?"
        }
      },
      "causal_role": "truth | evidence | deliverable | application | outcome | goal — what role does this entity play in the system's causal chain? truth = foundational fact, principle, or invariant (e.g. 'working memory ≈ 4 chunks'). evidence = observable data, measurement, or research finding that validates a truth (e.g. 'Cowan 2001, 47 replications'). deliverable = concrete output, rule, or recommendation the system produces (e.g. 'max 4 items per slide'). application = where/how a deliverable gets applied to a real asset (e.g. 'lecture template redesigned'). outcome = measurable result from applying a deliverable (e.g. 'comprehension ↑ 23%'). goal = desired end state or master objective (e.g. 'reduce error rate by 40%').",
      "evidence_basis": [
        {
          "claim": "string — one specific, falsifiable statement supporting this entity's existence, importance, or role in the system. NOT a restatement of the entity description. Must be a distinct logical assertion.",
          "claim_type": "mechanism | assertion | prediction | assumption | finding — mechanism = explains HOW something works. assertion = states THAT something is true. prediction = testable future outcome. assumption = taken as given without proof. finding = backed by data or observation.",
          "confidence": 0.0-1.0,
          "reasoning": "string — 1-2 sentences tracing the logic chain. MUST reference either (a) specific text from the user input, (b) named domain frameworks/patterns, or (c) structural reasoning from the graph topology.",
          "source_quote": "string — MANDATORY. If the parent entity's source_tag is EXPLICIT, this MUST be a verbatim or near-verbatim quote from the user's input (≤200 chars, no paraphrasing). If IMPLICIT, MUST start with 'IMPLICIT: ' followed by a one-sentence reason (what in the input implies this). If ASSUMED, MUST start with 'ASSUMED: ' followed by a one-sentence reason (the domain pattern invoked). NEVER fabricate quotes — downgrade source_tag to IMPLICIT instead."
        }
      ],
      "measurement": {
        "unit": "string — concrete unit (e.g. 'users/week', '%', 'ms', 'USD/MAU'). REQUIRED for fundamental/critical entities of category concrete/abstract/process. null for relational/epistemic categories or when the Tier 2 [MEASUREMENT: missing] tag fired.",
        "scale": "continuous | ordinal | categorical | binary | null — REQUIRED when unit is set. Drives downstream simulator dispatch.",
        "protocol": {
          "instrument": "string — e.g. 'Mixpanel event tutorial_complete', 'user survey Q3', 'server access log'",
          "frequency": "string — e.g. 'per-session', 'daily', 'monthly'",
          "sample_unit": "string — e.g. 'user', 'request', 'session', 'team-week'",
          "error_bound": "string — optional, e.g. '±5%', '±2 events'",
          "latency": "string — optional, e.g. 'real-time', 'T+24h'",
          "owner": "string — optional team/role responsible",
          "notes": "string — optional caveats or known biases"
        },
        "cost_estimate": "number — optional USD-equivalent cost per observation. 0 = already-instrumented, positive for survey/manual/external API costs. Omit when unknown — do NOT guess.",
        "observability": "directly_observable | proxy_required | inferred_only | unobservable | null — categorical fallback when scale is hard to assign."
      }
    }
  ],
  "edges": [
    {
      "source_entity_id": "C1",
      "target_entity_id": "C5",
      "relationship_type": "enables",
      "dimension": "structural | functional | temporal | causal | correlational | logical | epistemic | comparative | agentive",
      "source_tag": "stated | inferred | predicted",
      "strength": 0.0-1.0,
      "polarity": "positive | negative | neutral | conditional",
      "confidence": 0.0-1.0,
      "conditions": "string or null",
      "is_tradeoff": boolean,
      "resolved_by_entity_id": "string or null",
      "is_part_of_cycle": boolean,
      "cycle_id": "string or null",
      "pearl_level": "association | intervention | counterfactual (optional — if causal classification is active, classify causal edges by Pearl's ladder of causation)",
      "dynamics": "threshold | linear | compounding | exponential | logarithmic | decay | step_function | delayed",
      "dynamics_properties": { "threshold_condition": "string", "delay": "string", "cycle_time": "string" },
      "utility": {
        "failure_consequence": "catastrophic | degrading | recoverable | negligible",
        "propagation_speed": "immediate | days | weeks | months | years",
        "actionability": "directly_controllable | indirectly_influenceable | observable_only | fixed_constraint",
        "information_value": "decision_critical | high | moderate | low",
        "decision_question": "string or null — the specific decision this edge informs. ONLY populate when information_value is 'decision_critical'. Example: 'Should we build in-house or license the NLP engine?' NOT a generic restatement of the edge."
      },
      "temporal_validity": {
        "valid_from": "string or null — when this relationship activates",
        "valid_until": "string or null — when this relationship expires",
        "decay_rate": "none | slow | moderate | fast | immediate",
        "temporal_scope": "string or null"
      },
      "topology": "inside | overlap | meets | disjoint | composes | cover | equal (OPTIONAL — set-theoretic scope relationship, orthogonal to relationship_type. Only set when obvious from the decomposition; leave null for ambiguous cases. Preserve [TOPOLOGY: ...] tags from Tier 3.)"
    }
  ],

  EDGE DYNAMICS EXAMPLES (follow these patterns):
  // Threshold: "Prototype enables user testing" — zero testing possible before prototype exists
  {"dynamics": "threshold", "dynamics_properties": {"threshold_condition": "Working prototype exists", "before_threshold": "Zero user testing possible", "after_threshold": "Full testing pipeline enabled"}}
  // Compounding: part of a positive cycle
  {"dynamics": "compounding", "dynamics_properties": {"cycle_name": "Quality flywheel", "compounding_mechanism": "More retained users generate more data, improving quality", "estimated_cycle_time": "~1 week"}}
  // Delayed: "Publishing research builds credibility" — takes months
  {"dynamics": "delayed", "dynamics_properties": {"delay": "~3-6 months", "mechanism": "Academic publishing cycle"}}
  // Linear: "Better formatting improves perception" — proportional, no acceleration
  {"dynamics": "linear", "dynamics_properties": {}}
  Do NOT default to "linear" when uncertain — consider whether the relationship has a threshold, compounds, or is delayed.

  EDGE UTILITY RULES:
  - failure_consequence: "catastrophic" = target entity cannot function. "degrading" = target loses effectiveness over time. "recoverable" = temporary disruption, system adapts. "negligible" = minimal downstream impact.
  - propagation_speed: How quickly a change in the source reaches the target. Combine with dynamics — "compounding + immediate" is far more urgent than "linear + months."
  - actionability: "directly_controllable" = the user can change this today with a decision or action. "indirectly_influenceable" = requires changing something else first. "observable_only" = can monitor but cannot change. "fixed_constraint" = laws, physics, market structure — cannot be changed.
  - information_value: "decision_critical" = misunderstanding this edge leads to a wrong decision. ONLY use this for edges where multiple distinct mechanisms could explain the relationship, where the relationship could reverse under specific conditions, or where understanding HOW it works (not just THAT it works) would change strategy. "high" = changes which option is best. "moderate" = affects timeline but not direction. "low" = background context.
  - decision_question: ONLY set when information_value is "decision_critical". Must be a specific, answerable question that the user faces — not a restatement of the edge's existence. Must start with a question word (Should, What, When, How, Whether). If the edge doesn't carry a clear decision, leave null.
  - Focus annotation effort on edges connecting fundamental/critical entities. For moderate-to-moderate entity edges, utility defaults are acceptable.

  TEMPORAL VALIDITY RULES:
  - NOT every entity/edge needs temporal_validity. Only annotate when there's a meaningful time dimension — the concept has a shelf life, activates at a specific point, or decays predictably.
  - valid_from/valid_until should be human-readable descriptions, not raw dates. Use relative terms: "after MVP launch", "until runway < 3 months", "during beta period".
  - decay_rate reflects how quickly the entity's truth/relevance degrades: "none" for laws of physics or structural facts, "slow" for market trends, "moderate" for competitive positions, "fast" for tactical opportunities, "immediate" for time-sensitive decisions.
  - temporal_scope is a brief label describing the time window (e.g. "pre-PMF", "current market cycle", "Series A timeline").
  - Entities with source_tag="assumed" and high importance should ALWAYS have temporal_validity — assumptions have shelf lives.
  - Edges with dynamics="delayed" or dynamics="decay" should ALWAYS have temporal_validity — these are inherently time-bound.

  MANIFOLD RULES:
  - NOT every entity needs a full manifold. Focus annotation effort on fundamental/critical entities. For moderate entities, manifold can be null.
  - Only populate dimensions where you have genuine signal. An empty sub-dimension is better than a guessed one.
  - strategic manifold: Most useful for entities the user can ACT on. Skip for pure constraints or epistemic entities.
  - operational manifold: Most useful for process and concrete entities. dependency_count = number of other entities this depends on.
  - epistemic manifold: Most useful for assumed/implicit entities. Tells the user how much to TRUST this entity's role in the analysis.
  - The manifold should ADD information beyond what importance/confidence already capture. "fundamental + 0.9 confidence" is different from "fundamental + 0.9 confidence + empirical evidence + established consensus + easily reversible."

  CAUSAL ROLE RULES:
  - Every entity MUST have a causal_role. Choose the role that best describes the entity's function in the system's causal chain.
  - "truth" entities are foundational principles, scientific invariants, or domain facts that the system's logic rests on. They are discovered, not created.
  - "evidence" entities are data points, measurements, research findings, or observations that VALIDATE truths. They have sources and can be verified.
  - "deliverable" entities are the concrete outputs the system produces — rules, recommendations, protocols, templates. They are CREATED from truths + evidence.
  - "application" entities describe WHERE and HOW deliverables are deployed — specific assets, workflows, or contexts that get modified.
  - "outcome" entities are measurable results from applying deliverables — metrics that change, behaviors that shift, errors that reduce.
  - "goal" entities are the master objectives that outcomes contribute to — the end states the user is trying to achieve.
  - Most entities in a typical analysis will be "truth" or "deliverable". Use the full spectrum when the input describes a complete system from principles to results.

  CONTROLLABILITY RULES (D3):
  - Populate manifold.operational.controllability ONLY for fundamental/critical entities that represent levers (something the user could act on). Skip for relational, epistemic, or pure-context entities.
  - kind: "fully_controllable" = user has direct unilateral control. "partially_controllable" = requires negotiation / cooperation. "gated" = binary on/off only, no continuous knob. "observable_only" = external constraint the user monitors but cannot move. null when the entity doesn't fit any of these (and skip the block entirely in that case).
  - intervention_cost is the DIRECT cost-to-MOVE (USD-equivalent), NOT cost-to-MEASURE (that's measurement_cost_estimate). It carries: estimate, confidence, recurrence (one_time | recurring_monthly | recurring_yearly | recurring_continuous — strategically critical), is_sunk (true iff already paid), notes. OMIT the entire intervention_cost object when unknown — do NOT pad with a guessed default.
  - opportunity_cost is the value of the next-best alternative foregone by choosing this lever. Strategy decisions are zero-sum at the resource layer (time, attention, capital, runway), so opportunity cost is OFTEN the dominant cost even when direct cost is small. Set when the resource is fungible AND alternatives are abundant; OMIT when no good alternatives exist or the resource has no other use. May exceed intervention_cost.estimate; that's normal and meaningful.
  - cost_kind classifies WHICH cost type dominates: "direct" (dollars dominate), "opportunity_dominated" (foregone alternatives dominate — common for senior-leader-time and capital-allocation), "coordination_dominated" (Brooks' Law — N people communicating = N(N-1)/2 channels, scales superlinearly), "risk_adjusted_dominated" (failure-recovery × probability dwarfs direct cost), "switching_dominated" (path-dependency lock-in is the real cost), "hidden_externalities" (compounding tech debt / cultural drag / trust erosion). Default to "direct" only when you've genuinely considered the others.
  - time_to_effect is the median lag between intervention and observable downstream change. Per-lever (entity-level), DISTINCT from edge.utility.propagation_speed which is per-relationship cascade lag. The lag string can be a canonical bucket (immediate, days, weeks, months, years) OR a specific phrase ("1-2 weeks", "end of Q3"). The bucketLag() helper in src/types/controllability.ts handles both.
  - modulation_range is OPTIONAL and frequently null — only meaningful for continuous levers (ad spend, headcount, temperature setpoint). Skip for binary or categorical levers. When set, unit should mirror the entity's measurement_unit (D1) when possible.
  - Reversibility lives in manifold.strategic.reversibility (NOT in controllability) — the existing 3-tier enum (easily_reversible | costly_to_reverse | irreversible). The sanitizer mirrors that value into manifold.operational.controllability.reversibility for ergonomic single-branch reads; the strategic-side value remains authoritative.

  MEASUREMENT RULES (D1):
  - Every entity with importance "fundamental" or "critical" AND entity_category in {concrete, abstract, process} MUST have a measurement object with at minimum a non-null unit AND scale.
  - Entities with category "relational" or "epistemic" should set measurement to null — tradeoffs and assumptions don't have units.
  - Entities with importance "important" or "moderate" can set measurement to null OR include a partial spec when known. Do not fabricate units to satisfy the schema.
  - unit MUST be a real, observable unit. "users/week" YES. "engagement level" NO. "%" YES. "high" NO. If you cannot honestly name a unit for a fundamental/critical entity, use measurement = null AND surface this in the entity description as "[MEASUREMENT MISSING: <one-sentence reason>]" — that is itself a finding the user needs to see.
  - scale MUST be one of {continuous, ordinal, categorical, binary} or null. Continuous = unbounded numeric. Ordinal = ranked categories. Categorical = unordered. Binary = true/false gate.
  - protocol is OPTIONAL but strongly preferred for fundamental/critical entities. Omit subfields you don't have signal for (don't invent an instrument or owner).
  - cost_estimate is OPTIONAL. 0 = already instrumented, no marginal cost. Positive number = USD-equivalent per observation. OMIT when unknown — do NOT guess.
  - observability is OPTIONAL fallback when scale doesn't cleanly apply. Use directly_observable when data already flows; proxy_required when you must instrument something else; inferred_only when only LLM/expert judgement is available; unobservable for true latents.
  - Preserve [MEASUREMENT: ...] tags from Tier 2 of the decomposition. The structurer's job is faithful translation, not measurement invention. If Tier 2 didn't tag an entity, leave measurement null rather than back-filling with hallucinated units.

  EVIDENCE BASIS RULES:
  - Every entity with importance "fundamental" or "critical" MUST have 2-4 evidence_basis items.
  - Every entity with importance "important" MUST have 1-2 evidence_basis items.
  - "moderate" entities can have 0 evidence_basis items (empty array []).
  - Each claim must be a DISTINCT statement, not a rephrasing of the entity description.
  - claim_type "mechanism" = explains HOW something works causally. "assertion" = states THAT something is true without mechanism. "prediction" = testable future outcome. "assumption" = taken as given without proof. "finding" = backed by observable data.
  - confidence reflects evidence quality: 0.9+ = directly stated by user or empirical data. 0.7-0.89 = strongly inferred from domain knowledge. 0.5-0.69 = reasonable inference. Below 0.5 = speculative.
  - reasoning MUST reference either (a) specific text from the user input, (b) named domain frameworks/patterns justifying the claim, or (c) structural reasoning from the graph topology (e.g. "this entity has 8 downstream connections, making it a structural hub").
  - DO NOT pad with low-value claims. One strong, well-reasoned claim is better than four weak ones.

  "cycles": [
    {
      "cycle_id": "cycle_1",
      "name": "string — descriptive name",
      "classification": "reinforcing_positive | reinforcing_negative | balancing",
      "entity_ids": ["C1", "C5", "C8"],
      "intervention_point": "C5",
      "intervention_description": "string — what to do at the intervention point",
      "description": "string",
      "growth_type": "additive | multiplicative | accelerating | decelerating",
      "cycle_time": "string — e.g. '~1 week', '~1 month'",
      "estimated_multiplier": 1.3,
      "reasoning": "string — what drives this loop and why it matters",
      "when_active": [
        {
          "situation": "string — when this loop activates",
          "impact": "string — what happens",
          "intensity": "high | mid | low"
        }
      ]
    }
  ],
  "propositions": [
    {
      "proposition_id": "P1",
      "statement": "string",
      "proposition_type": "certain | probable | possible | speculative | irreducible",
      "confidence": 0.0-1.0,
      "depends_on": ["P2", "P3"],
      "entity_ids": ["C1", "C5"]
    }
  ],
  "novel_connections": [
    {
      "source_entity_id": "C5",
      "target_entity_id": "C22",
      "relationship_type": "enables",
      "strength": "strong | moderate | speculative",
      "reasoning": "string — why this connection exists"
    }
  ],

NOVEL CONNECTIONS — CRITERIA:
A connection is ONLY novel if ALL of:
1. NOT stated by the user (source_tag of involved entities ≠ "explicit" for at least one)
2. CROSSES boundaries — connects entities from different entity_categories, different layers, or different analytical domains
3. Has a NON-OBVIOUS mechanism — the reasoning must explain a causal chain of ≥2 intermediate steps that aren't visible by looking at adjacent entities alone
4. SUPPORTED by domain knowledge or structural analogy — not just "these seem related"
5. DECISION-CHANGING — if this connection is true, it changes what the user should do (not just "interesting to note")
If a potential novel connection fails ANY of these criteria, it's not novel — it's just an edge you missed in Tier 3. Go back and add it as a regular edge instead.

  "contradictions": [
    {
      "assumption_text": "string",
      "conclusion_text": "string",
      "severity": "critical | moderate | minor",
      "description": "string — impact and implication",
      "involved_entity_ids": ["C5", "C12"]
    }
  ],
  CONTRADICTION RULES:
  - involved_entity_ids MUST list the specific entity IDs the contradiction implicates, drawn from the "entities" array above. Preserve [CONTRADICTION: ... involved=C5,C12] tags from the decomposition.
  - Contradictions WITH involved_entity_ids will be materialized as first-class "fault" entities in the graph with edges (relationship_type=contradicts, topology=disjoint) to those entities. This makes tensions navigable structure rather than buried metadata.
  - Contradictions without involved entities still get materialized as fault entities but without edges — less useful, so try to always name the involved entities.
  "scenarios": [
    {
      "name": "string",
      "conditions": "string",
      "outcome_label": "string",
      "outcome_value": "string",
      "probability": "likely | possible | unlikely"
    }
  ],
  "action_items": [
    {
      "timeframe": "today | this_week | this_month | after_validation",
      "path_label": "builder | team | pivot",
      "action_text": "string — specific action to take",
      "why_text": "string — reasoning for why this action matters",
      "derived_from_entity_id": "string or null",
      "tags": [{"t": "string — tag label like 'fixes bottleneck' or 'starts flywheel'", "c": "string — hex color like '#FF3B30' or '#34C759'"}]
    }
  ],
  "open_questions": [
    {
      "question": "string — a specific unresolved question that could change the analysis",
      "why_it_matters": "string — what depends on the answer, which entities/edges would change",
      "what_would_change": "string — if we knew the answer, what connections would be added or removed",
      "related_entity_ids": ["C5", "C8"]
    }
  ],
  "leverage_points": [
    {
      "entity_id": "C5",
      "summary": "string — 1-2 sentence overview of why this is high-leverage",
      "reasoning": ["string — paragraph 1 explaining the deep logic", "string — paragraph 2 with more context", "string — paragraph 3 if needed"],
      "how_it_works": ["string — mechanism 1", "string — mechanism 2", "string — mechanism 3"],
      "when_matters": [
        {"situation": "string", "impact": "string", "intensity": "high | mid | low"},
        {"situation": "string", "impact": "string", "intensity": "high | mid | low"}
      ],
      "action": {
        "primary": "string — the recommended next step",
        "alternatives": [
          {"when": "string — situation this applies", "approach": "string — what to do", "tradeoff": "string — cost or downside"}
        ]
      },
      "connections": ["string — how this connects to other parts of the system"]
    }
  ],
  "risk_points": [
    {
      "entity_id": "C8",
      "blast_radius": 14,
      "summary": "string — 1-2 sentence overview of the risk",
      "reasoning": ["string — paragraph explaining why this is dangerous"],
      "how_it_fails": ["string — failure mechanism 1", "string — mechanism 2"],
      "when_matters": [
        {"situation": "string", "impact": "string", "intensity": "high | mid | low"}
      ],
      "mitigation": {
        "primary": "string — recommended protection",
        "alternatives": [
          {"when": "string", "approach": "string", "tradeoff": "string"}
        ]
      },
      "connections": ["string — downstream impacts"]
    }
  ],
  "master_bottleneck": {
    "entity_id": "C1",
    "blast_radius": 18,
    "summary": "string — why this is the highest-impact constraint",
    "reasoning": ["string — detailed paragraph 1", "string — paragraph 2", "string — paragraph 3"],
    "when_matters": [
      {"situation": "string", "impact": "string", "intensity": "high | mid | low"}
    ]
  },
  "shared_variables": [
    {
      "entity_id": "C5",
      "shared_variable_name": "output quality",
      "potential_bridge_spaces": ["string"]
    }
  ]
}

CRITICAL RULES:
- Return ONLY the JSON object. No markdown code fences, no explanation, no preamble.
- Every entity referenced in edges MUST exist in the entities array. Edge source_entity_id and target_entity_id MUST exactly match entity_id values.
- Use entity_id values (C1, C2, etc.) consistently across all arrays. NO typos, NO mismatches.
- Ensure all enum values match exactly (e.g., "concrete" not "Concrete", "functional" not "Functional").
- Mark exactly one entity as is_master_bottleneck: true (highest blast_radius + centrality).
- Mark edges that represent tradeoffs with is_tradeoff: true.
- MERGE near-duplicate entities. "AI chatbox" and "chatbox module" should be ONE entity, not two. Every entity name must be semantically distinct.
- Entity descriptions must explain WHY the entity matters to the system dynamics, not just define it. "A chatbox" is useless. "The core product delivering AI-powered analysis to users" is useful.
- MINIMUM IMPLICIT ENTITIES: At least 25% of entities must be tagged source_tag: "implicit" — concepts the user DID NOT mention but that domain expertise reveals are critical to the system. If the user describes a SaaS startup, implicit entities might include: churn rate, CAC/LTV ratio, net revenue retention, competitive moat, switching costs, integration burden, compliance timeline. If ALL your entities are just restating what the user wrote, you've failed — the analysis adds zero value.

OPEN QUESTIONS — REQUIREMENTS:
- Produce 3-5 open questions. These are NOT generic ("what's the market size?"). They are SPECIFIC to THIS analysis.
- CRITICAL ANTI-REPETITION RULE: NEVER produce an open question that restates a decision or uncertainty the user ALREADY explicitly mentioned in their input. If the user says "I'm deciding between X and Y," the open question CANNOT be "Should you pick X or Y?" — they KNOW that's a question. Open questions must surface UNKNOWNS THE USER HASN'T CONSIDERED. Things that domain expertise reveals are important but the user didn't mention.
- BAD open questions (parroting): "Should you target small firms or enterprise?" (user already said this), "Is 78% accuracy good enough?" (user already flagged this), "Will you run out of money?" (user already said this is their fear)
- GOOD open questions (new knowledge): "What's your churn rate after the free trial? B2B legal SaaS averages 5-8% monthly — if you're above that, your C3→C7 growth loop breaks before it starts", "Have you tested with contracts outside your former firm's specialty? Clause extraction accuracy drops 15-30% across practice areas — this could change C1's confidence from 0.78 to 0.5", "Do the pilot firms use a DMS like iManage or NetDocuments? Integration requirements with existing doc management systems could add 2-3 months to your C5 sales cycle estimate"
- Each question must identify: what entity or edge would change if we knew the answer.
- Focus on questions where the answer would ADD or REMOVE connections in the graph, or significantly change confidence levels.

LEVERAGE POINTS / RISK POINTS — DEPTH REQUIREMENTS:
- Each leverage point MUST have 2-4 "reasoning" paragraphs explaining WHY in depth.
- Each MUST have 2-4 "how_it_works" numbered mechanisms.
- Each MUST have 2-3 "when_matters" scenarios with intensity levels.
- Each MUST have a primary action AND 1-3 alternatives with tradeoffs.
- Each MUST have 1-3 connections showing how it links to other areas.
- Same depth requirements apply to risk_points (use "how_it_fails" for mechanisms).
- Master bottleneck MUST have 2-3 reasoning paragraphs and 2-3 when_matters scenarios.

ACTION ITEMS — CONDITIONAL PATHS:
- Generate action items for THREE paths: "builder" (solo execution), "team" (with collaborators), "pivot" (if current approach fails).
- Each action MUST have why_text explaining the reasoning.
- Each action SHOULD have 1-2 tags with hex colors: red=#FF3B30 (fixes problems), green=#34C759 (positive outcomes), blue=#007AFF (leverage), amber=#FF9500 (growth), purple=#AF52DE (strategic).
- Prioritize: leverage-derived actions first, then risk mitigations, then cycle interventions.

CYCLES — DEPTH:
- Each cycle MUST have a "reasoning" string explaining what drives the loop.
- Each cycle MUST have 2-3 "when_active" scenarios with intensity levels.

If information for a field is truly absent from the analysis, provide reasonable inferences. The goal is rich, actionable output.`;
