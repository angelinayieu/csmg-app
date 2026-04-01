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
          credits_used: number;
          agent_count: number;
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
          credits_used?: number;
          agent_count?: number;
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
          credits_used?: number;
          agent_count?: number;
          created_at?: string;
          updated_at?: string;
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
          knowledge_layer: "internal" | "external" | "bridge";
          provenance: Json;
          authority_level: "high" | "moderate" | "low" | "unverified";
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
          knowledge_layer?: "internal" | "external" | "bridge";
          provenance?: Json;
          authority_level?: "high" | "moderate" | "low" | "unverified";
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
          knowledge_layer?: "internal" | "external" | "bridge";
          provenance?: Json;
          authority_level?: "high" | "moderate" | "low" | "unverified";
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
          is_low_confidence: boolean;
          knowledge_layer: "internal" | "external" | "bridge";
          provenance: Json;
          requires_user_approval: boolean;
          approved_at: string | null;
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
          is_low_confidence?: boolean;
          knowledge_layer?: "internal" | "external" | "bridge";
          provenance?: Json;
          requires_user_approval?: boolean;
          approved_at?: string | null;
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
          is_low_confidence?: boolean;
          knowledge_layer?: "internal" | "external" | "bridge";
          provenance?: Json;
          requires_user_approval?: boolean;
          approved_at?: string | null;
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
