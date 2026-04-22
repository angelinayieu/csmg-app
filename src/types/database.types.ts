export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      reactions: {
        Row: {
          id: string;
          space_id: string;
          name: string;
          reaction_type: "emergent" | "reinforcing" | "tension" | "trivial";
          entity_ids: string[];
          canonical_key: string;
          probability: number;
          ci_low: number | null;
          ci_high: number | null;
          mechanism: string | null;
          implication: string | null;
          probes: Json | null;
          source_tag: "user" | "llm" | "inferred";
          provenance: Json | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          name: string;
          reaction_type: "emergent" | "reinforcing" | "tension" | "trivial";
          entity_ids: string[];
          canonical_key?: string;
          probability: number;
          ci_low?: number | null;
          ci_high?: number | null;
          mechanism?: string | null;
          implication?: string | null;
          probes?: Json | null;
          source_tag?: "user" | "llm" | "inferred";
          provenance?: Json | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          name?: string;
          reaction_type?: "emergent" | "reinforcing" | "tension" | "trivial";
          entity_ids?: string[];
          canonical_key?: string;
          probability?: number;
          ci_low?: number | null;
          ci_high?: number | null;
          mechanism?: string | null;
          implication?: string | null;
          probes?: Json | null;
          source_tag?: "user" | "llm" | "inferred";
          provenance?: Json | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          created_at: string;
          usage_count: number;
          tier: "free" | "pro" | "team";
          credit_balance: number;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          created_at?: string;
          usage_count?: number;
          tier?: "free" | "pro" | "team";
          credit_balance?: number;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          created_at?: string;
          usage_count?: number;
          tier?: "free" | "pro" | "team";
          credit_balance?: number;
        };
      };
      spaces: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          space_prefix: string;
          parent_space_id: string | null;
          originated_from_entity_id: string | null;
          depth_level: number;
          input_text: string;
          raw_decomposition: string | null;
          synthesis_text: string | null;
          entity_count: number;
          edge_count: number;
          orphan_count: number;
          cycle_count: number;
          maturity:
            | "actionable_now"
            | "waiting_on_dependency"
            | "theoretical"
            | "blocked";
          activation_dependencies: string[] | null;
          synthesis_data: Json | null;
          analysis_tier: string;
          user_role: string | null;
          primary_goal: string | null;
          context_type: string | null;
          credits_used: number;
          agent_count: number;
          strategy_committed_at: string | null;
          digital_twin_state: "not_started" | "ready" | "active" | "retired";
          twin_initialized_at: string | null;
          kind: "analysis" | "ask";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          space_prefix: string;
          parent_space_id?: string | null;
          originated_from_entity_id?: string | null;
          depth_level?: number;
          input_text: string;
          raw_decomposition?: string | null;
          synthesis_text?: string | null;
          entity_count?: number;
          edge_count?: number;
          orphan_count?: number;
          cycle_count?: number;
          maturity?:
            | "actionable_now"
            | "waiting_on_dependency"
            | "theoretical"
            | "blocked";
          activation_dependencies?: string[] | null;
          synthesis_data?: Json | null;
          analysis_tier?: string;
          user_role?: string | null;
          primary_goal?: string | null;
          context_type?: string | null;
          credits_used?: number;
          agent_count?: number;
          strategy_committed_at?: string | null;
          digital_twin_state?: "not_started" | "ready" | "active" | "retired";
          twin_initialized_at?: string | null;
          kind?: "analysis" | "ask";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          space_prefix?: string;
          parent_space_id?: string | null;
          originated_from_entity_id?: string | null;
          depth_level?: number;
          input_text?: string;
          raw_decomposition?: string | null;
          synthesis_text?: string | null;
          entity_count?: number;
          edge_count?: number;
          orphan_count?: number;
          cycle_count?: number;
          maturity?:
            | "actionable_now"
            | "waiting_on_dependency"
            | "theoretical"
            | "blocked";
          activation_dependencies?: string[] | null;
          synthesis_data?: Json | null;
          analysis_tier?: string;
          user_role?: string | null;
          primary_goal?: string | null;
          context_type?: string | null;
          credits_used?: number;
          agent_count?: number;
          strategy_committed_at?: string | null;
          digital_twin_state?: "not_started" | "ready" | "active" | "retired";
          twin_initialized_at?: string | null;
          kind?: "analysis" | "ask";
          created_at?: string;
          updated_at?: string;
        };
      };
      metric_trackers: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          source_kind:
            | "goal"
            | "target_objective"
            | "perspective_key_metric"
            | "micro_tactic_metric"
            | "leading_indicator"
            | "lagging_indicator";
          source_key: string;
          source_id: string | null;
          label: string;
          measurement_method: string | null;
          unit: string | null;
          cadence: "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
          baseline_value: number | null;
          current_value: number | null;
          target_value: number | null;
          baseline_text: string | null;
          current_text: string | null;
          target_text: string | null;
          green_reading: string | null;
          yellow_reading: string | null;
          red_reading: string | null;
          user_confirmed: boolean;
          measurability: "easy" | "medium" | "hard" | "impossible" | null;
          strategy_generated_at: string | null;
          supersedes_tracker_id: string | null;
          status: "active" | "superseded" | "archived";
          metric_definition: Json | null;
          depth_tier: "light" | "mid" | "heavy" | null;
          friction_cost: number | null;
          data_category: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          source_kind:
            | "goal"
            | "target_objective"
            | "perspective_key_metric"
            | "micro_tactic_metric"
            | "leading_indicator"
            | "lagging_indicator";
          source_key: string;
          source_id?: string | null;
          label: string;
          measurement_method?: string | null;
          unit?: string | null;
          cadence?: "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
          baseline_value?: number | null;
          current_value?: number | null;
          target_value?: number | null;
          baseline_text?: string | null;
          current_text?: string | null;
          target_text?: string | null;
          green_reading?: string | null;
          yellow_reading?: string | null;
          red_reading?: string | null;
          user_confirmed?: boolean;
          measurability?: "easy" | "medium" | "hard" | "impossible" | null;
          strategy_generated_at?: string | null;
          supersedes_tracker_id?: string | null;
          status?: "active" | "superseded" | "archived";
          metric_definition?: Json | null;
          depth_tier?: "light" | "mid" | "heavy" | null;
          friction_cost?: number | null;
          data_category?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          source_kind?:
            | "goal"
            | "target_objective"
            | "perspective_key_metric"
            | "micro_tactic_metric"
            | "leading_indicator"
            | "lagging_indicator";
          source_key?: string;
          source_id?: string | null;
          label?: string;
          measurement_method?: string | null;
          unit?: string | null;
          cadence?: "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
          baseline_value?: number | null;
          current_value?: number | null;
          target_value?: number | null;
          baseline_text?: string | null;
          current_text?: string | null;
          target_text?: string | null;
          green_reading?: string | null;
          yellow_reading?: string | null;
          red_reading?: string | null;
          user_confirmed?: boolean;
          measurability?: "easy" | "medium" | "hard" | "impossible" | null;
          strategy_generated_at?: string | null;
          supersedes_tracker_id?: string | null;
          status?: "active" | "superseded" | "archived";
          metric_definition?: Json | null;
          depth_tier?: "light" | "mid" | "heavy" | null;
          friction_cost?: number | null;
          data_category?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      user_consent_manifest: {
        Row: {
          user_id: string;
          consent_map: Json;
          friction_budget: number;
          escalation_policy: "ask_each_time" | "auto_if_value_above_x" | "never_escalate";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          consent_map?: Json;
          friction_budget?: number;
          escalation_policy?: "ask_each_time" | "auto_if_value_above_x" | "never_escalate";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          consent_map?: Json;
          friction_budget?: number;
          escalation_policy?: "ask_each_time" | "auto_if_value_above_x" | "never_escalate";
          created_at?: string;
          updated_at?: string;
        };
      };
      metric_observations: {
        Row: {
          id: string;
          tracker_id: string;
          recorded_at: string;
          value: number | null;
          value_text: string | null;
          note: string | null;
          source: "manual" | "ai_estimated" | "integration" | "seed";
          created_at: string;
        };
        Insert: {
          id?: string;
          tracker_id: string;
          recorded_at?: string;
          value?: number | null;
          value_text?: string | null;
          note?: string | null;
          source?: "manual" | "ai_estimated" | "integration" | "seed";
          created_at?: string;
        };
        Update: {
          id?: string;
          tracker_id?: string;
          recorded_at?: string;
          value?: number | null;
          value_text?: string | null;
          note?: string | null;
          source?: "manual" | "ai_estimated" | "integration" | "seed";
          created_at?: string;
        };
      };
      credit_ledger: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          reason: string;
          space_id: string | null;
          balance_after: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          reason: string;
          space_id?: string | null;
          balance_after: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          amount?: number;
          reason?: string;
          space_id?: string | null;
          balance_after?: number;
          created_at?: string;
        };
      };
      entities: {
        Row: {
          id: string;
          space_id: string;
          entity_id: string;
          name: string;
          description: string | null;
          source_tag: "explicit" | "implicit" | "assumed";
          entity_type: string;
          entity_category:
            | "concrete"
            | "abstract"
            | "process"
            | "relational"
            | "epistemic";
          layer: string | null;
          depth: number;
          parameters: Json | null;
          importance:
            | "fundamental"
            | "critical"
            | "important"
            | "moderate"
            | null;
          confidence: number;
          is_leverage_point: boolean;
          is_risk_point: boolean;
          blast_radius: number;
          centrality_rank: number | null;
          is_shared_variable: boolean;
          is_decomposable: boolean;
          is_master_bottleneck: boolean;
          has_sub_space: boolean;
          sub_space_id: string | null;
          graph_x: number | null;
          graph_y: number | null;
          knowledge_layer: "internal" | "conceptual" | "external" | "bridge";
          provenance: Json;
          authority_level: "high" | "moderate" | "low" | "unverified";
          ambiguity_type: "harmful" | "premature" | "strategic" | null;
          temporal_validity: Json | null;
          manifold: Json | null;
          expansion_id: string | null;
          is_expanded: boolean;
          causal_role: string | null;
          theory_type: string | null;
          falsifiability_score: number | null;
          evidence_strength: number | null;
          analysis_count: number;
          last_analyzed_at: string | null;
          connection_search_count: number;
          last_connection_search_at: string | null;
          decomposition_probed_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          entity_id: string;
          name: string;
          description?: string | null;
          source_tag: "explicit" | "implicit" | "assumed";
          entity_type: string;
          entity_category:
            | "concrete"
            | "abstract"
            | "process"
            | "relational"
            | "epistemic";
          layer?: string | null;
          depth?: number;
          parameters?: Json | null;
          importance?:
            | "fundamental"
            | "critical"
            | "important"
            | "moderate"
            | null;
          confidence?: number;
          is_leverage_point?: boolean;
          is_risk_point?: boolean;
          blast_radius?: number;
          centrality_rank?: number | null;
          is_shared_variable?: boolean;
          is_decomposable?: boolean;
          is_master_bottleneck?: boolean;
          has_sub_space?: boolean;
          sub_space_id?: string | null;
          graph_x?: number | null;
          graph_y?: number | null;
          knowledge_layer?: "internal" | "conceptual" | "external" | "bridge";
          provenance?: Json;
          authority_level?: "high" | "moderate" | "low" | "unverified";
          ambiguity_type?: "harmful" | "premature" | "strategic" | null;
          temporal_validity?: Json | null;
          manifold?: Json | null;
          expansion_id?: string | null;
          is_expanded?: boolean;
          causal_role?: string | null;
          theory_type?: string | null;
          falsifiability_score?: number | null;
          evidence_strength?: number | null;
          analysis_count?: number;
          last_analyzed_at?: string | null;
          connection_search_count?: number;
          last_connection_search_at?: string | null;
          decomposition_probed_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          entity_id?: string;
          name?: string;
          description?: string | null;
          source_tag?: "explicit" | "implicit" | "assumed";
          entity_type?: string;
          entity_category?:
            | "concrete"
            | "abstract"
            | "process"
            | "relational"
            | "epistemic";
          layer?: string | null;
          depth?: number;
          parameters?: Json | null;
          importance?:
            | "fundamental"
            | "critical"
            | "important"
            | "moderate"
            | null;
          confidence?: number;
          is_leverage_point?: boolean;
          is_risk_point?: boolean;
          blast_radius?: number;
          centrality_rank?: number | null;
          is_shared_variable?: boolean;
          is_decomposable?: boolean;
          is_master_bottleneck?: boolean;
          has_sub_space?: boolean;
          sub_space_id?: string | null;
          graph_x?: number | null;
          graph_y?: number | null;
          knowledge_layer?: "internal" | "conceptual" | "external" | "bridge";
          provenance?: Json;
          authority_level?: "high" | "moderate" | "low" | "unverified";
          ambiguity_type?: "harmful" | "premature" | "strategic" | null;
          temporal_validity?: Json | null;
          manifold?: Json | null;
          expansion_id?: string | null;
          is_expanded?: boolean;
          causal_role?: string | null;
          theory_type?: string | null;
          falsifiability_score?: number | null;
          evidence_strength?: number | null;
          analysis_count?: number;
          last_analyzed_at?: string | null;
          connection_search_count?: number;
          last_connection_search_at?: string | null;
          decomposition_probed_at?: string | null;
        };
      };
      expansions: {
        Row: {
          id: string;
          space_id: string;
          entity_id: string;
          parent_expansion_id: string | null;
          depth_level: number;
          summary: string | null;
          sub_components: Json;
          internal_pathways: Json;
          internal_dynamics: Json | null;
          llm_model: string | null;
          token_cost: number;
          computed_at: string;
          stale: boolean;
        };
        Insert: {
          id?: string;
          space_id: string;
          entity_id: string;
          parent_expansion_id?: string | null;
          depth_level?: number;
          summary?: string | null;
          sub_components?: Json;
          internal_pathways?: Json;
          internal_dynamics?: Json | null;
          llm_model?: string | null;
          token_cost?: number;
          computed_at?: string;
          stale?: boolean;
        };
        Update: {
          id?: string;
          space_id?: string;
          entity_id?: string;
          parent_expansion_id?: string | null;
          depth_level?: number;
          summary?: string | null;
          sub_components?: Json;
          internal_pathways?: Json;
          internal_dynamics?: Json | null;
          llm_model?: string | null;
          token_cost?: number;
          computed_at?: string;
          stale?: boolean;
        };
      };
      edges: {
        Row: {
          id: string;
          space_id: string;
          source_entity_id: string;
          target_entity_id: string;
          relationship_type: string;
          dimension:
            | "structural"
            | "functional"
            | "temporal"
            | "causal"
            | "correlational"
            | "logical"
            | "epistemic"
            | "comparative"
            | "agentive";
          source_tag: "stated" | "inferred" | "predicted";
          strength: number;
          polarity: "positive" | "negative" | "neutral" | "conditional";
          confidence: number;
          conditions: string | null;
          is_tradeoff: boolean;
          resolved_by_entity_id: string | null;
          is_part_of_cycle: boolean;
          cycle_id: string | null;
          dynamics: string | null;
          dynamics_properties: Json | null;
          utility: Json | null;
          is_low_confidence: boolean;
          knowledge_layer: "internal" | "conceptual" | "external" | "bridge";
          provenance: Json;
          requires_user_approval: boolean;
          approved_at: string | null;
          temporal_validity: Json | null;
          analysis_count: number;
          last_analyzed_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          source_entity_id: string;
          target_entity_id: string;
          relationship_type: string;
          dimension:
            | "structural"
            | "functional"
            | "temporal"
            | "causal"
            | "correlational"
            | "logical"
            | "epistemic"
            | "comparative"
            | "agentive";
          source_tag: "stated" | "inferred" | "predicted";
          strength?: number;
          polarity?: "positive" | "negative" | "neutral" | "conditional";
          confidence?: number;
          conditions?: string | null;
          is_tradeoff?: boolean;
          resolved_by_entity_id?: string | null;
          is_part_of_cycle?: boolean;
          cycle_id?: string | null;
          dynamics?: string | null;
          dynamics_properties?: Json | null;
          utility?: Json | null;
          is_low_confidence?: boolean;
          knowledge_layer?: "internal" | "conceptual" | "external" | "bridge";
          provenance?: Json;
          requires_user_approval?: boolean;
          approved_at?: string | null;
          temporal_validity?: Json | null;
          analysis_count?: number;
          last_analyzed_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          source_entity_id?: string;
          target_entity_id?: string;
          relationship_type?: string;
          dimension?:
            | "structural"
            | "functional"
            | "temporal"
            | "causal"
            | "correlational"
            | "logical"
            | "epistemic"
            | "comparative"
            | "agentive";
          source_tag?: "stated" | "inferred" | "predicted";
          strength?: number;
          polarity?: "positive" | "negative" | "neutral" | "conditional";
          confidence?: number;
          conditions?: string | null;
          is_tradeoff?: boolean;
          resolved_by_entity_id?: string | null;
          is_part_of_cycle?: boolean;
          cycle_id?: string | null;
          dynamics?: string | null;
          dynamics_properties?: Json | null;
          utility?: Json | null;
          is_low_confidence?: boolean;
          knowledge_layer?: "internal" | "conceptual" | "external" | "bridge";
          provenance?: Json;
          requires_user_approval?: boolean;
          approved_at?: string | null;
          temporal_validity?: Json | null;
          analysis_count?: number;
          last_analyzed_at?: string | null;
        };
      };
      cycles: {
        Row: {
          id: string;
          space_id: string;
          cycle_id: string;
          name: string | null;
          classification:
            | "reinforcing_positive"
            | "reinforcing_negative"
            | "balancing";
          entity_ids: string[];
          edge_ids: string[] | null;
          intervention_point_entity_id: string | null;
          intervention_description: string | null;
          description: string | null;
          growth_type: string | null;
          cycle_time: string | null;
          estimated_multiplier: number | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          cycle_id: string;
          name?: string | null;
          classification:
            | "reinforcing_positive"
            | "reinforcing_negative"
            | "balancing";
          entity_ids: string[];
          edge_ids?: string[] | null;
          intervention_point_entity_id?: string | null;
          intervention_description?: string | null;
          description?: string | null;
          growth_type?: string | null;
          cycle_time?: string | null;
          estimated_multiplier?: number | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          cycle_id?: string;
          name?: string | null;
          classification?:
            | "reinforcing_positive"
            | "reinforcing_negative"
            | "balancing";
          entity_ids?: string[];
          edge_ids?: string[] | null;
          intervention_point_entity_id?: string | null;
          intervention_description?: string | null;
          description?: string | null;
          growth_type?: string | null;
          cycle_time?: string | null;
          estimated_multiplier?: number | null;
        };
      };
      bridges: {
        Row: {
          id: string;
          source_space_id: string;
          source_entity_id: string;
          target_space_id: string;
          target_entity_id: string;
          bridge_type: "identity" | "influence" | "structural";
          coupling_strength: "strong" | "moderate" | "weak";
          coupling_direction:
            | "source_to_target"
            | "target_to_source"
            | "bidirectional";
          shared_variable_name: string;
          description: string | null;
          discovery_method:
            | "llm_reasoning"
            | "embedding_similarity"
            | "manual";
          confidence: number;
        };
        Insert: {
          id?: string;
          source_space_id: string;
          source_entity_id: string;
          target_space_id: string;
          target_entity_id: string;
          bridge_type: "identity" | "influence" | "structural";
          coupling_strength: "strong" | "moderate" | "weak";
          coupling_direction:
            | "source_to_target"
            | "target_to_source"
            | "bidirectional";
          shared_variable_name: string;
          description?: string | null;
          discovery_method?:
            | "llm_reasoning"
            | "embedding_similarity"
            | "manual";
          confidence?: number;
        };
        Update: {
          id?: string;
          source_space_id?: string;
          source_entity_id?: string;
          target_space_id?: string;
          target_entity_id?: string;
          bridge_type?: "identity" | "influence" | "structural";
          coupling_strength?: "strong" | "moderate" | "weak";
          coupling_direction?:
            | "source_to_target"
            | "target_to_source"
            | "bidirectional";
          shared_variable_name?: string;
          description?: string | null;
          discovery_method?:
            | "llm_reasoning"
            | "embedding_similarity"
            | "manual";
          confidence?: number;
        };
      };
      reasoning_results: {
        Row: {
          id: string;
          space_id: string;
          reasoning_type:
            | "centrality"
            | "cycles"
            | "cascade"
            | "link_prediction"
            | "path"
            | "weaving";
          input_params: Json | null;
          result_data: Json;
          result_text: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          reasoning_type:
            | "centrality"
            | "cycles"
            | "cascade"
            | "link_prediction"
            | "path"
            | "weaving";
          input_params?: Json | null;
          result_data: Json;
          result_text?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          reasoning_type?:
            | "centrality"
            | "cycles"
            | "cascade"
            | "link_prediction"
            | "path"
            | "weaving";
          input_params?: Json | null;
          result_data?: Json;
          result_text?: string | null;
          created_at?: string;
        };
      };
      propositions: {
        Row: {
          id: string;
          space_id: string;
          proposition_id: string;
          statement: string;
          proposition_type:
            | "certain"
            | "probable"
            | "possible"
            | "speculative"
            | "irreducible";
          confidence: number;
          depends_on: string[] | null;
          entity_ids: string[] | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          proposition_id: string;
          statement: string;
          proposition_type?:
            | "certain"
            | "probable"
            | "possible"
            | "speculative"
            | "irreducible";
          confidence?: number;
          depends_on?: string[] | null;
          entity_ids?: string[] | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          proposition_id?: string;
          statement?: string;
          proposition_type?:
            | "certain"
            | "probable"
            | "possible"
            | "speculative"
            | "irreducible";
          confidence?: number;
          depends_on?: string[] | null;
          entity_ids?: string[] | null;
        };
      };
      novel_connections: {
        Row: {
          id: string;
          space_id: string;
          source_entity_id: string;
          target_entity_id: string;
          relationship_type: string;
          strength: "strong" | "moderate" | "speculative";
          reasoning: string;
          crosses_spaces: boolean;
          target_space_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          source_entity_id: string;
          target_entity_id: string;
          relationship_type: string;
          strength: "strong" | "moderate" | "speculative";
          reasoning: string;
          crosses_spaces?: boolean;
          target_space_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          source_entity_id?: string;
          target_entity_id?: string;
          relationship_type?: string;
          strength?: "strong" | "moderate" | "speculative";
          reasoning?: string;
          crosses_spaces?: boolean;
          target_space_id?: string | null;
          created_at?: string;
        };
      };
      contradictions: {
        Row: {
          id: string;
          space_a_id: string;
          space_b_id: string | null;
          assumption_text: string;
          conclusion_text: string;
          severity: "critical" | "moderate" | "minor";
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_a_id: string;
          space_b_id?: string | null;
          assumption_text: string;
          conclusion_text: string;
          severity: "critical" | "moderate" | "minor";
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          space_a_id?: string;
          space_b_id?: string | null;
          assumption_text?: string;
          conclusion_text?: string;
          severity?: "critical" | "moderate" | "minor";
          description?: string | null;
          created_at?: string;
        };
      };
      scenarios: {
        Row: {
          id: string;
          space_id: string;
          name: string;
          conditions: string;
          outcome_label: string;
          outcome_value: string;
          probability: "likely" | "possible" | "unlikely" | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          space_id: string;
          name: string;
          conditions: string;
          outcome_label: string;
          outcome_value: string;
          probability?: "likely" | "possible" | "unlikely" | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          space_id?: string;
          name?: string;
          conditions?: string;
          outcome_label?: string;
          outcome_value?: string;
          probability?: "likely" | "possible" | "unlikely" | null;
          sort_order?: number;
        };
      };
      action_items: {
        Row: {
          id: string;
          space_id: string;
          timeframe: "today" | "this_week" | "this_month" | "after_validation";
          path_label: string;
          action_text: string;
          why_text: string | null;
          derived_from_entity_id: string | null;
          tags: { t: string; c: string }[];
          sort_order: number;
          status: "pending" | "in_progress" | "completed" | "skipped";
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          timeframe: "today" | "this_week" | "this_month" | "after_validation";
          path_label?: string;
          action_text: string;
          why_text?: string | null;
          derived_from_entity_id?: string | null;
          tags?: { t: string; c: string }[];
          sort_order?: number;
          status?: "pending" | "in_progress" | "completed" | "skipped";
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          timeframe?: "today" | "this_week" | "this_month" | "after_validation";
          path_label?: string;
          action_text?: string;
          why_text?: string | null;
          derived_from_entity_id?: string | null;
          tags?: { t: string; c: string }[];
          sort_order?: number;
          status?: "pending" | "in_progress" | "completed" | "skipped";
          completed_at?: string | null;
        };
      };
      space_changelog: {
        Row: {
          id: string;
          space_id: string;
          version: number;
          change_type:
            | "initial_analysis"
            | "reevaluation"
            | "manual_edit"
            | "exploration"
            | "synthesis_refresh";
          summary: string;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          version?: number;
          change_type:
            | "initial_analysis"
            | "reevaluation"
            | "manual_edit"
            | "exploration"
            | "synthesis_refresh";
          summary: string;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          version?: number;
          change_type?:
            | "initial_analysis"
            | "reevaluation"
            | "manual_edit"
            | "exploration"
            | "synthesis_refresh";
          summary?: string;
          details?: Json;
          created_at?: string;
        };
      };
      // ── Arc 5C.1: persistent card chat messages ──
      // Migration: 20260519_card_chat_messages.sql
      card_chat_messages: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          card_shape_id: string;
          role: "user" | "assistant";
          kind: "text" | "proposed_change";
          content: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          card_shape_id: string;
          role: "user" | "assistant";
          kind: "text" | "proposed_change";
          content?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          card_shape_id?: string;
          role?: "user" | "assistant";
          kind?: "text" | "proposed_change";
          content?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      // ── Arc 5A: comment threads rooted on canvas shapes ──
      // Migration: 20260513_shape_threads.sql
      shape_threads: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          shape_id: string;
          parent_shape_id: string | null;
          root_shape_id: string;
          thread_depth: number;
          content: string;
          author_display: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          shape_id: string;
          parent_shape_id?: string | null;
          root_shape_id: string;
          thread_depth?: number;
          content?: string;
          author_display?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          shape_id?: string;
          parent_shape_id?: string | null;
          root_shape_id?: string;
          thread_depth?: number;
          content?: string;
          author_display?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      strategy_snapshots: {
        Row: {
          id: string;
          space_id: string;
          version: number;
          recommendation: Json;
          ranked_strategies: Json | null;
          status: "generated" | "reviewing" | "confirmed" | "superseded";
          trigger: "manual" | "auto_chain" | "resynthesize";
          quality_score: number | null;
          user_label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          version?: number;
          recommendation: Json;
          ranked_strategies?: Json;
          status?: "generated" | "reviewing" | "confirmed" | "superseded";
          trigger?: "manual" | "auto_chain" | "resynthesize";
          quality_score?: number | null;
          user_label?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          version?: number;
          recommendation?: Json;
          ranked_strategies?: Json;
          status?: "generated" | "reviewing" | "confirmed" | "superseded";
          trigger?: "manual" | "auto_chain" | "resynthesize";
          quality_score?: number | null;
          user_label?: string | null;
          created_at?: string;
        };
      };
      // ── Item 2: baseline + prediction ledger ─────────────────────────
      // Migration: 20260508_baseline_prediction_ledger.sql
      // Domain types: src/types/prediction.ts
      strategy_baselines: {
        Row: {
          id: string;
          strategy_snapshot_id: string;
          space_id: string;
          user_id: string;
          snapshot_at: string;
          kg_snapshot: Json;
          twin_state: Json;
          metric_baselines: Json;
          predicted_outcomes: Json;
          created_by: string;
          capture_notes: string | null;
        };
        Insert: {
          id?: string;
          strategy_snapshot_id: string;
          space_id: string;
          user_id: string;
          snapshot_at?: string;
          kg_snapshot: Json;
          twin_state: Json;
          metric_baselines: Json;
          predicted_outcomes: Json;
          created_by: string;
          capture_notes?: string | null;
        };
        Update: {
          id?: string;
          strategy_snapshot_id?: string;
          space_id?: string;
          user_id?: string;
          snapshot_at?: string;
          kg_snapshot?: Json;
          twin_state?: Json;
          metric_baselines?: Json;
          predicted_outcomes?: Json;
          created_by?: string;
          capture_notes?: string | null;
        };
      };
      prediction_ledger: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          strategy_snapshot_id: string | null;
          app_id: string | null;
          agent_id: string | null;
          tracker_id: string | null;
          metric_label: string;
          metric_unit: string | null;
          predicted_at: string;
          horizon_at: string;
          predicted_value: number | null;
          predicted_value_text: string | null;
          predicted_distribution: Json | null;
          rationale: string | null;
          confidence: number | null;
          status: "open" | "resolved" | "abandoned";
          resolved_actual: number | null;
          resolved_actual_text: string | null;
          resolved_at: string | null;
          deviation: number | null;
          deviation_tag: "expected" | "regime_shift" | "surprise" | "qualitative" | "failed" | null;
          resolution_notes: string | null;
          // Tier 6: entity backlinks (migration 20260422_deep_wiring.sql)
          entity_ids: string[];
          // Migration 20260518 — widen ledger for plan_step outcomes.
          subject_kind: "metric" | "step_outcome" | "action_return";
          plan_step_id: string | null;
          capability_id: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          strategy_snapshot_id?: string | null;
          app_id?: string | null;
          agent_id?: string | null;
          tracker_id?: string | null;
          metric_label: string;
          metric_unit?: string | null;
          predicted_at?: string;
          horizon_at: string;
          predicted_value?: number | null;
          predicted_value_text?: string | null;
          predicted_distribution?: Json | null;
          rationale?: string | null;
          confidence?: number | null;
          status?: "open" | "resolved" | "abandoned";
          resolved_actual?: number | null;
          resolved_actual_text?: string | null;
          resolved_at?: string | null;
          deviation?: number | null;
          deviation_tag?: "expected" | "regime_shift" | "surprise" | "qualitative" | "failed" | null;
          resolution_notes?: string | null;
          entity_ids?: string[];
          subject_kind?: "metric" | "step_outcome" | "action_return";
          plan_step_id?: string | null;
          capability_id?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          strategy_snapshot_id?: string | null;
          app_id?: string | null;
          agent_id?: string | null;
          tracker_id?: string | null;
          metric_label?: string;
          metric_unit?: string | null;
          predicted_at?: string;
          horizon_at?: string;
          predicted_value?: number | null;
          predicted_value_text?: string | null;
          predicted_distribution?: Json | null;
          rationale?: string | null;
          confidence?: number | null;
          status?: "open" | "resolved" | "abandoned";
          resolved_actual?: number | null;
          resolved_actual_text?: string | null;
          resolved_at?: string | null;
          deviation?: number | null;
          deviation_tag?: "expected" | "regime_shift" | "surprise" | "qualitative" | "failed" | null;
          resolution_notes?: string | null;
          entity_ids?: string[];
          subject_kind?: "metric" | "step_outcome" | "action_return";
          plan_step_id?: string | null;
          capability_id?: string | null;
        };
      };
      improvement_goals: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          title: string;
          description: string | null;
          metric_name: string;
          metric_unit: string | null;
          target_value: number;
          baseline_value: number;
          current_value: number;
          deadline: string | null;
          status: "active" | "achieved" | "abandoned" | "paused";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          title: string;
          description?: string | null;
          metric_name: string;
          metric_unit?: string | null;
          target_value: number;
          baseline_value?: number;
          current_value?: number;
          deadline?: string | null;
          status?: "active" | "achieved" | "abandoned" | "paused";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          metric_name?: string;
          metric_unit?: string | null;
          target_value?: number;
          baseline_value?: number;
          current_value?: number;
          deadline?: string | null;
          status?: "active" | "achieved" | "abandoned" | "paused";
          created_at?: string;
          updated_at?: string;
        };
      };
      goal_progress: {
        Row: {
          id: string;
          goal_id: string;
          recorded_at: string;
          value: number;
          note: string | null;
          source: "manual" | "ai_estimated" | "integration";
        };
        Insert: {
          id?: string;
          goal_id: string;
          recorded_at?: string;
          value: number;
          note?: string | null;
          source?: "manual" | "ai_estimated" | "integration";
        };
        Update: {
          id?: string;
          goal_id?: string;
          recorded_at?: string;
          value?: number;
          note?: string | null;
          source?: "manual" | "ai_estimated" | "integration";
        };
      };
      goal_recommendations: {
        Row: {
          id: string;
          goal_id: string;
          rank: number;
          title: string;
          reasoning: string;
          source_type: string;
          source_entity_id: string | null;
          impact_estimate: "high" | "medium" | "low" | null;
          status: "pending" | "in_progress" | "completed" | "dismissed";
          outcome: "effective" | "ineffective" | "partial" | "not_tested" | null;
          outcome_notes: string | null;
          outcome_recorded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          goal_id: string;
          rank: number;
          title: string;
          reasoning: string;
          source_type: string;
          source_entity_id?: string | null;
          impact_estimate?: "high" | "medium" | "low" | null;
          status?: "pending" | "in_progress" | "completed" | "dismissed";
          outcome?: "effective" | "ineffective" | "partial" | "not_tested" | null;
          outcome_notes?: string | null;
          outcome_recorded_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          goal_id?: string;
          rank?: number;
          title?: string;
          reasoning?: string;
          source_type?: string;
          source_entity_id?: string | null;
          impact_estimate?: "high" | "medium" | "low" | null;
          status?: "pending" | "in_progress" | "completed" | "dismissed";
          outcome?: "effective" | "ineffective" | "partial" | "not_tested" | null;
          outcome_notes?: string | null;
          outcome_recorded_at?: string | null;
          created_at?: string;
        };
      };
      analysis_jobs: {
        Row: {
          id: string;
          user_id: string;
          space_id: string | null;
          tier: string;
          status: "queued" | "running" | "completed" | "failed" | "cancelled";
          current_phase: string | null;
          input_text: string | null;
          intent: Json | null;
          reservation_id: string | null;
          inngest_run_id: string | null;
          error_message: string | null;
          artifacts_ready: string[];
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          space_id?: string | null;
          tier: string;
          status?: "queued" | "running" | "completed" | "failed" | "cancelled";
          current_phase?: string | null;
          input_text?: string | null;
          intent?: Json | null;
          reservation_id?: string | null;
          inngest_run_id?: string | null;
          error_message?: string | null;
          artifacts_ready?: string[];
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          space_id?: string | null;
          tier?: string;
          status?: "queued" | "running" | "completed" | "failed" | "cancelled";
          current_phase?: string | null;
          input_text?: string | null;
          intent?: Json | null;
          reservation_id?: string | null;
          inngest_run_id?: string | null;
          error_message?: string | null;
          artifacts_ready?: string[];
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
      };
      job_events: {
        Row: {
          id: string;
          job_id: string;
          event_type: string;
          artifact_kind: string | null;
          payload: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          event_type: string;
          artifact_kind?: string | null;
          payload?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_id?: string;
          event_type?: string;
          artifact_kind?: string | null;
          payload?: Json | null;
          created_at?: string;
        };
      };
      agents: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          kind:
            | "decomposer"
            | "critic"
            | "augmenter"
            | "researcher"
            | "synthesizer"
            | "strategist"
            | "twin"
            | "bridge"
            | "expansion"
            | "coordinator"
            | "reasoner"
            | "reevaluator"
            | "incremental_analyzer"
            | "chat";
          name: string;
          callsign: string | null;
          specialty: string | null;
          focus_areas: string[];
          status: "idle" | "queued" | "running" | "paused" | "error" | "retired";
          last_run_at: string | null;
          next_run_at: string | null;
          source_objective_id: string | null;
          source_goal_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          kind:
            | "decomposer"
            | "critic"
            | "augmenter"
            | "researcher"
            | "synthesizer"
            | "strategist"
            | "twin"
            | "bridge"
            | "expansion"
            | "coordinator"
            | "reasoner"
            | "reevaluator"
            | "incremental_analyzer"
            | "chat";
          name: string;
          callsign?: string | null;
          specialty?: string | null;
          focus_areas?: string[];
          status?: "idle" | "queued" | "running" | "paused" | "error" | "retired";
          last_run_at?: string | null;
          next_run_at?: string | null;
          source_objective_id?: string | null;
          source_goal_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          kind?:
            | "decomposer"
            | "critic"
            | "augmenter"
            | "researcher"
            | "synthesizer"
            | "strategist"
            | "twin"
            | "bridge"
            | "expansion"
            | "coordinator"
            | "reasoner"
            | "reevaluator"
            | "incremental_analyzer"
            | "chat";
          name?: string;
          callsign?: string | null;
          specialty?: string | null;
          focus_areas?: string[];
          status?: "idle" | "queued" | "running" | "paused" | "error" | "retired";
          last_run_at?: string | null;
          next_run_at?: string | null;
          source_objective_id?: string | null;
          source_goal_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      agent_runs: {
        Row: {
          id: string;
          agent_id: string;
          space_id: string;
          job_id: string | null;
          inngest_run_id: string | null;
          step_id: string | null;
          trigger_event: string | null;
          trigger_data: Json | null;
          status: "running" | "completed" | "failed" | "cancelled";
          findings_count: number;
          artifacts_produced: string[];
          entity_ids_discovered: string[];
          cost_credits: number;
          heartbeat_at: string;
          started_at: string;
          completed_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          agent_id: string;
          space_id: string;
          job_id?: string | null;
          inngest_run_id?: string | null;
          step_id?: string | null;
          trigger_event?: string | null;
          trigger_data?: Json | null;
          status?: "running" | "completed" | "failed" | "cancelled";
          findings_count?: number;
          artifacts_produced?: string[];
          entity_ids_discovered?: string[];
          cost_credits?: number;
          heartbeat_at?: string;
          started_at?: string;
          completed_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          agent_id?: string;
          space_id?: string;
          job_id?: string | null;
          inngest_run_id?: string | null;
          step_id?: string | null;
          trigger_event?: string | null;
          trigger_data?: Json | null;
          status?: "running" | "completed" | "failed" | "cancelled";
          findings_count?: number;
          artifacts_produced?: string[];
          entity_ids_discovered?: string[];
          cost_credits?: number;
          heartbeat_at?: string;
          started_at?: string;
          completed_at?: string | null;
          error_message?: string | null;
        };
      };
      // ── Tier 5: per-app agent runtime ─────────────────────────────────
      // Migration: 20260421_app_agent_runs.sql
      // Domain types: src/types/agent-run.ts
      // Distinct from public.agent_runs (the deep-research coordinator's
      // table) — this one tracks per-app predictor/measurer/validator
      // agents declared in InfrastructureProposal.agent_specs.
      app_agent_runs: {
        Row: {
          id: string;
          app_id: string;
          space_id: string;
          user_id: string;
          agent_id: string;
          agent_role: string;
          scheduled_for: string;
          started_at: string | null;
          completed_at: string | null;
          status: "scheduled" | "running" | "completed" | "failed" | "skipped";
          output: Json | null;
          note: string | null;
          duration_ms: number | null;
        };
        Insert: {
          id?: string;
          app_id: string;
          space_id: string;
          user_id: string;
          agent_id: string;
          agent_role: string;
          scheduled_for: string;
          started_at?: string | null;
          completed_at?: string | null;
          status?: "scheduled" | "running" | "completed" | "failed" | "skipped";
          output?: Json | null;
          note?: string | null;
          duration_ms?: number | null;
        };
        Update: {
          id?: string;
          app_id?: string;
          space_id?: string;
          user_id?: string;
          agent_id?: string;
          agent_role?: string;
          scheduled_for?: string;
          started_at?: string | null;
          completed_at?: string | null;
          status?: "scheduled" | "running" | "completed" | "failed" | "skipped";
          output?: Json | null;
          note?: string | null;
          duration_ms?: number | null;
        };
      };
      interventions: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          source_tactic_id: string | null;
          source_strategy_version: number | null;
          title: string;
          description: string | null;
          target_entity_id: string | null;
          target_entity_code: string | null;
          macro_link: string | null;
          infrastructure_action: "build" | "strengthen" | "connect" | "monitor" | "configure" | null;
          priority: number;
          effort: "low" | "medium" | "high" | null;
          impact: "low" | "medium" | "high" | null;
          timeframe: "now" | "short_term" | "medium_term" | "long_term" | null;
          metric_name: string | null;
          metric_target: string | null;
          metric_unit: string | null;
          status: "proposed" | "active" | "completed" | "superseded" | "abandoned";
          app_id: string | null;
          depends_on_intervention_ids: string[];
          implementation_trigger: string | null;
          implementation_action: string | null;
          implementation_category: "proactive" | "reactive" | "course_correction" | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          source_tactic_id?: string | null;
          source_strategy_version?: number | null;
          title: string;
          description?: string | null;
          target_entity_id?: string | null;
          target_entity_code?: string | null;
          macro_link?: string | null;
          infrastructure_action?: "build" | "strengthen" | "connect" | "monitor" | "configure" | null;
          priority?: number;
          effort?: "low" | "medium" | "high" | null;
          impact?: "low" | "medium" | "high" | null;
          timeframe?: "now" | "short_term" | "medium_term" | "long_term" | null;
          metric_name?: string | null;
          metric_target?: string | null;
          metric_unit?: string | null;
          status?: "proposed" | "active" | "completed" | "superseded" | "abandoned";
          app_id?: string | null;
          depends_on_intervention_ids?: string[];
          implementation_trigger?: string | null;
          implementation_action?: string | null;
          implementation_category?: "proactive" | "reactive" | "course_correction" | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          source_tactic_id?: string | null;
          source_strategy_version?: number | null;
          title?: string;
          description?: string | null;
          target_entity_id?: string | null;
          target_entity_code?: string | null;
          macro_link?: string | null;
          infrastructure_action?: "build" | "strengthen" | "connect" | "monitor" | "configure" | null;
          priority?: number;
          effort?: "low" | "medium" | "high" | null;
          impact?: "low" | "medium" | "high" | null;
          timeframe?: "now" | "short_term" | "medium_term" | "long_term" | null;
          metric_name?: string | null;
          metric_target?: string | null;
          metric_unit?: string | null;
          status?: "proposed" | "active" | "completed" | "superseded" | "abandoned";
          app_id?: string | null;
          depends_on_intervention_ids?: string[];
          implementation_trigger?: string | null;
          implementation_action?: string | null;
          implementation_category?: "proactive" | "reactive" | "course_correction" | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
      };
      apps: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          name: string;
          description: string | null;
          app_type: "dashboard" | "workflow" | "tool" | "monitor" | "integration";
          source_strategy_version: number | null;
          source_perspective: string | null;
          source_infrastructure_proposal_id: string | null;
          dominant_entity_ids: string[];
          dominant_entity_codes: string[];
          sub_space_id: string | null;
          serves_goal_id: string | null;
          serves_sub_objective_ids: string[];
          tracked_metric_tracker_ids: string[];
          config: Json;
          state: Json;
          status: "proposed" | "approved" | "active" | "paused" | "retired";
          health_score: number | null;
          stale_reason:
            | "kg_changed"
            | "new_research"
            | "user_feedback"
            | "strategy_regen"
            | "whiteboard_edit"
            | null;
          stale_since: string | null;
          last_refreshed_at: string | null;
          last_updated_by: string | null;
          priority: number;
          complexity: "low" | "medium" | "high" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          name: string;
          description?: string | null;
          app_type?: "dashboard" | "workflow" | "tool" | "monitor" | "integration";
          source_strategy_version?: number | null;
          source_perspective?: string | null;
          source_infrastructure_proposal_id?: string | null;
          dominant_entity_ids?: string[];
          dominant_entity_codes?: string[];
          sub_space_id?: string | null;
          serves_goal_id?: string | null;
          serves_sub_objective_ids?: string[];
          tracked_metric_tracker_ids?: string[];
          config?: Json;
          state?: Json;
          status?: "proposed" | "approved" | "active" | "paused" | "retired";
          health_score?: number | null;
          stale_reason?:
            | "kg_changed"
            | "new_research"
            | "user_feedback"
            | "strategy_regen"
            | "whiteboard_edit"
            | null;
          stale_since?: string | null;
          last_refreshed_at?: string | null;
          last_updated_by?: string | null;
          priority?: number;
          complexity?: "low" | "medium" | "high" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          app_type?: "dashboard" | "workflow" | "tool" | "monitor" | "integration";
          source_strategy_version?: number | null;
          source_perspective?: string | null;
          source_infrastructure_proposal_id?: string | null;
          dominant_entity_ids?: string[];
          dominant_entity_codes?: string[];
          sub_space_id?: string | null;
          serves_goal_id?: string | null;
          serves_sub_objective_ids?: string[];
          tracked_metric_tracker_ids?: string[];
          config?: Json;
          state?: Json;
          status?: "proposed" | "approved" | "active" | "paused" | "retired";
          health_score?: number | null;
          stale_reason?:
            | "kg_changed"
            | "new_research"
            | "user_feedback"
            | "strategy_regen"
            | "whiteboard_edit"
            | null;
          stale_since?: string | null;
          last_refreshed_at?: string | null;
          last_updated_by?: string | null;
          priority?: number;
          complexity?: "low" | "medium" | "high" | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      app_versions: {
        Row: {
          id: string;
          app_id: string;
          version: number;
          config_snapshot: Json;
          state_snapshot: Json;
          change_summary: string | null;
          change_type: "generated" | "user_edit" | "agent_update" | "pipeline_regen" | "staleness_refresh";
          changed_by: string;
          change_payload: Json | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          version: number;
          config_snapshot?: Json;
          state_snapshot?: Json;
          change_summary?: string | null;
          change_type: "generated" | "user_edit" | "agent_update" | "pipeline_regen" | "staleness_refresh";
          changed_by: string;
          change_payload?: Json | null;
          changed_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          version?: number;
          config_snapshot?: Json;
          state_snapshot?: Json;
          change_summary?: string | null;
          change_type?: "generated" | "user_edit" | "agent_update" | "pipeline_regen" | "staleness_refresh";
          changed_by?: string;
          change_payload?: Json | null;
          changed_at?: string;
        };
      };
      // ── Tier 3: per-app sub-strategies ────────────────────────────────
      // Migration: 20260420_app_strategies.sql
      // Domain types: src/types/app-strategy.ts
      app_strategies: {
        Row: {
          id: string;
          app_id: string;
          space_id: string;
          user_id: string;
          parent_strategy_snapshot_id: string | null;
          parent_proposal_id: string | null;
          version: number;
          status: "draft" | "active" | "superseded" | "archived";
          generated_at: string;
          generated_by: string;
          last_deviation_trigger_at: string | null;
          generation_rationale: string | null;
          spec: Json;
          parent_proposal_snapshot: Json | null;
          quality: Json;
          // Tier 6: KG entity backlinks (migration 20260422_deep_wiring.sql)
          // Mirrors apps.dominant_entity_ids — cascade staleness uses same pattern.
          entity_refs: string[];
        };
        Insert: {
          id?: string;
          app_id: string;
          space_id: string;
          user_id: string;
          parent_strategy_snapshot_id?: string | null;
          parent_proposal_id?: string | null;
          version?: number;
          status?: "draft" | "active" | "superseded" | "archived";
          generated_at?: string;
          generated_by: string;
          last_deviation_trigger_at?: string | null;
          generation_rationale?: string | null;
          spec: Json;
          parent_proposal_snapshot?: Json | null;
          quality?: Json;
          entity_refs?: string[];
        };
        Update: {
          id?: string;
          app_id?: string;
          space_id?: string;
          user_id?: string;
          parent_strategy_snapshot_id?: string | null;
          parent_proposal_id?: string | null;
          version?: number;
          status?: "draft" | "active" | "superseded" | "archived";
          generated_at?: string;
          generated_by?: string;
          last_deviation_trigger_at?: string | null;
          generation_rationale?: string | null;
          spec?: Json;
          parent_proposal_snapshot?: Json | null;
          quality?: Json;
          entity_refs?: string[];
        };
      };
      app_strategy_versions: {
        Row: {
          id: string;
          app_strategy_id: string;
          app_id: string;
          change_type:
            | "generated"
            | "superseded"
            | "agent_refined"
            | "user_edit"
            | "deviation_triggered"
            | "archived";
          change_summary: string | null;
          diff: Json | null;
          changed_by: string;
          changed_at: string;
        };
        Insert: {
          id?: string;
          app_strategy_id: string;
          app_id: string;
          change_type:
            | "generated"
            | "superseded"
            | "agent_refined"
            | "user_edit"
            | "deviation_triggered"
            | "archived";
          change_summary?: string | null;
          diff?: Json | null;
          changed_by: string;
          changed_at?: string;
        };
        Update: {
          id?: string;
          app_strategy_id?: string;
          app_id?: string;
          change_type?:
            | "generated"
            | "superseded"
            | "agent_refined"
            | "user_edit"
            | "deviation_triggered"
            | "archived";
          change_summary?: string | null;
          diff?: Json | null;
          changed_by?: string;
          changed_at?: string;
        };
      };
      user_app_preferences: {
        Row: {
          id: string;
          user_id: string;
          app_id: string | null;
          app_type: "dashboard" | "workflow" | "tool" | "monitor" | "integration" | null;
          preferences: Json;
          interaction_counts: Json;
          last_interaction_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          app_id?: string | null;
          app_type?: "dashboard" | "workflow" | "tool" | "monitor" | "integration" | null;
          preferences?: Json;
          interaction_counts?: Json;
          last_interaction_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          app_id?: string | null;
          app_type?: "dashboard" | "workflow" | "tool" | "monitor" | "integration" | null;
          preferences?: Json;
          interaction_counts?: Json;
          last_interaction_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      entity_questions: {
        Row: {
          id: string;
          space_id: string;
          entity_id: string;
          question_text: string;
          status: "open" | "researching" | "answered" | "dismissed";
          answer_text: string | null;
          result_refs: Json;
          created_at: string;
          updated_at: string;
          answered_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          entity_id: string;
          question_text: string;
          status?: "open" | "researching" | "answered" | "dismissed";
          answer_text?: string | null;
          result_refs?: Json;
          created_at?: string;
          updated_at?: string;
          answered_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          entity_id?: string;
          question_text?: string;
          status?: "open" | "researching" | "answered" | "dismissed";
          answer_text?: string | null;
          result_refs?: Json;
          created_at?: string;
          updated_at?: string;
          answered_at?: string | null;
        };
      };
      pairwise_connection_checks: {
        Row: {
          id: string;
          space_id: string;
          entity_a_id: string;
          entity_b_id: string;
          checked_at: string;
          edge_proposed: boolean;
          resulting_edge_id: string | null;
          pair_key: string;
          /** Depth at which this check was performed: 0-4 (see migration 20260418) */
          examination_level: number;
          /** When edge_proposed=false, confidence that there truly is no edge (0-1) */
          negative_confidence: number | null;
          /** Which of the 9 edge dimensions were explicitly considered */
          dimensions_examined: string[];
          /** Free-form text describing what would flip this verdict */
          revisit_trigger: string | null;
          /** LLM reasoning snippet for this verdict */
          reasoning: string | null;
          /** User review state — for calibration tracking */
          user_verdict: "accepted" | "rejected" | "uncertain" | null;
          user_verdict_at: string | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          entity_a_id: string;
          entity_b_id: string;
          checked_at?: string;
          edge_proposed?: boolean;
          resulting_edge_id?: string | null;
          pair_key: string;
          examination_level?: number;
          negative_confidence?: number | null;
          dimensions_examined?: string[];
          revisit_trigger?: string | null;
          reasoning?: string | null;
          user_verdict?: "accepted" | "rejected" | "uncertain" | null;
          user_verdict_at?: string | null;
        };
        Update: {
          id?: string;
          space_id?: string;
          entity_a_id?: string;
          entity_b_id?: string;
          checked_at?: string;
          edge_proposed?: boolean;
          resulting_edge_id?: string | null;
          pair_key?: string;
          examination_level?: number;
          negative_confidence?: number | null;
          dimensions_examined?: string[];
          revisit_trigger?: string | null;
          reasoning?: string | null;
          user_verdict?: "accepted" | "rejected" | "uncertain" | null;
          user_verdict_at?: string | null;
        };
      };
      // ── Capability registry (migration 20260516) ───────────────────────
      capabilities: {
        Row: {
          id: string;
          slug: string | null;
          name: string;
          description: string;
          category:
            | "person_contact"
            | "community_inquiry"
            | "literature_research"
            | "dataset_acquisition"
            | "direct_observation"
            | "instrumentation"
            | "experiment"
            | "synthesis"
            | "temporal_capture";
          yields: Json;
          preconditions: Json;
          cost_user_minutes_p50: number;
          cost_user_minutes_p90: number;
          cost_money_usd_p50: number;
          cost_calendar_latency_days_p50: number;
          cost_calendar_latency_days_p90: number;
          requires_human: boolean;
          requires_agent: boolean;
          requires_instrument: boolean;
          requires_external_service: boolean;
          repeatable: boolean;
          one_shot: boolean;
          perturbs_system: boolean;
          yields_structured_data: boolean;
          relational_cost: "none" | "low" | "medium" | "high";
          latency_kind: "sync" | "async" | "scheduled_event";
          success_priors: Json;
          yield_priors: Json;
          proposed_by_user_id: string | null;
          status: "active" | "proposed" | "deprecated";
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug?: string | null;
          name: string;
          description: string;
          category:
            | "person_contact"
            | "community_inquiry"
            | "literature_research"
            | "dataset_acquisition"
            | "direct_observation"
            | "instrumentation"
            | "experiment"
            | "synthesis"
            | "temporal_capture";
          yields: Json;
          preconditions?: Json;
          cost_user_minutes_p50?: number;
          cost_user_minutes_p90?: number;
          cost_money_usd_p50?: number;
          cost_calendar_latency_days_p50?: number;
          cost_calendar_latency_days_p90?: number;
          requires_human?: boolean;
          requires_agent?: boolean;
          requires_instrument?: boolean;
          requires_external_service?: boolean;
          repeatable?: boolean;
          one_shot?: boolean;
          perturbs_system?: boolean;
          yields_structured_data?: boolean;
          relational_cost?: "none" | "low" | "medium" | "high";
          latency_kind?: "sync" | "async" | "scheduled_event";
          success_priors?: Json;
          yield_priors?: Json;
          proposed_by_user_id?: string | null;
          status?: "active" | "proposed" | "deprecated";
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["capabilities"]["Insert"]>;
      };
      data_needs: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          target_entity_id: string | null;
          target_metric_tracker_id: string | null;
          question: string;
          rationale: string | null;
          expected_answer_shape: Json;
          current_confidence: number;
          priority: number;
          source_kind:
            | "prediction_spec"
            | "validation_spec"
            | "user_authored"
            | "planner_recursion"
            | "agent_detected";
          source_ref: Json | null;
          status: "open" | "planning" | "in_flight" | "resolved" | "abandoned";
          first_opened_at: string;
          last_activity_at: string;
          resolved_at: string | null;
          resolved_confidence: number | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          target_entity_id?: string | null;
          target_metric_tracker_id?: string | null;
          question: string;
          rationale?: string | null;
          expected_answer_shape?: Json;
          current_confidence?: number;
          priority?: number;
          source_kind:
            | "prediction_spec"
            | "validation_spec"
            | "user_authored"
            | "planner_recursion"
            | "agent_detected";
          source_ref?: Json | null;
          status?: "open" | "planning" | "in_flight" | "resolved" | "abandoned";
          first_opened_at?: string;
          last_activity_at?: string;
          resolved_at?: string | null;
          resolved_confidence?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["data_needs"]["Insert"]>;
      };
      acquisition_plans: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          data_need_ids: string[];
          title: string;
          summary: string | null;
          parent_plan_id: string | null;
          version: number;
          expected_info_gain: number;
          expected_compound_success: number;
          expected_cost_user_minutes: number;
          expected_cost_money_usd: number;
          expected_calendar_latency_days: number;
          novelty_score: number;
          contains_perturbing_step: boolean;
          contains_one_shot_step: boolean;
          status:
            | "draft"
            | "proposed"
            | "approved"
            | "in_flight"
            | "resolved"
            | "abandoned"
            | "superseded";
          generated_by: string;
          rationale: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          data_need_ids?: string[];
          title: string;
          summary?: string | null;
          parent_plan_id?: string | null;
          version?: number;
          expected_info_gain?: number;
          expected_compound_success?: number;
          expected_cost_user_minutes?: number;
          expected_cost_money_usd?: number;
          expected_calendar_latency_days?: number;
          novelty_score?: number;
          contains_perturbing_step?: boolean;
          contains_one_shot_step?: boolean;
          status?:
            | "draft"
            | "proposed"
            | "approved"
            | "in_flight"
            | "resolved"
            | "abandoned"
            | "superseded";
          generated_by?: string;
          rationale?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["acquisition_plans"]["Insert"]>;
      };
      plan_steps: {
        Row: {
          id: string;
          plan_id: string;
          space_id: string;
          user_id: string;
          capability_id: string;
          params: Json;
          predicted_return: Json;
          actual_return: Json | null;
          deviation_tag:
            | "expected"
            | "regime_shift"
            | "surprise"
            | "qualitative"
            | "failed"
            | null;
          deviation_notes: string | null;
          closes_data_need_ids: string[];
          status: "blocked" | "ready" | "in_flight" | "resolved" | "skipped" | "failed";
          dispatched_at: string | null;
          resolved_at: string | null;
          executed_by: "human" | "agent" | "instrument" | "external_service" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          space_id: string;
          user_id: string;
          capability_id: string;
          params?: Json;
          predicted_return?: Json;
          actual_return?: Json | null;
          deviation_tag?:
            | "expected"
            | "regime_shift"
            | "surprise"
            | "qualitative"
            | "failed"
            | null;
          deviation_notes?: string | null;
          closes_data_need_ids?: string[];
          status?: "blocked" | "ready" | "in_flight" | "resolved" | "skipped" | "failed";
          dispatched_at?: string | null;
          resolved_at?: string | null;
          executed_by?: "human" | "agent" | "instrument" | "external_service" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["plan_steps"]["Insert"]>;
      };
      plan_step_edges: {
        Row: {
          id: string;
          plan_id: string;
          from_step_id: string;
          to_step_id: string;
          edge_kind: "sequential" | "parallel" | "fallback" | "branch" | "join";
          branch_predicate: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          from_step_id: string;
          to_step_id: string;
          edge_kind: "sequential" | "parallel" | "fallback" | "branch" | "join";
          branch_predicate?: Json | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["plan_step_edges"]["Insert"]>;
      };
      capability_observations: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          capability_id: string;
          plan_step_id: string;
          context_key: string;
          succeeded: boolean;
          yield_completeness: number | null;
          deviation_tag:
            | "expected"
            | "regime_shift"
            | "surprise"
            | "qualitative"
            | "failed"
            | null;
          observed_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          capability_id: string;
          plan_step_id: string;
          context_key?: string;
          succeeded: boolean;
          yield_completeness?: number | null;
          deviation_tag?:
            | "expected"
            | "regime_shift"
            | "surprise"
            | "qualitative"
            | "failed"
            | null;
          observed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["capability_observations"]["Insert"]>;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
};
