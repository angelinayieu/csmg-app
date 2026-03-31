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
        };
        Insert: {
          id: string;
          display_name?: string | null;
          created_at?: string;
          usage_count?: number;
          tier?: "free" | "pro" | "team";
        };
        Update: {
          id?: string;
          display_name?: string | null;
          created_at?: string;
          usage_count?: number;
          tier?: "free" | "pro" | "team";
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
          created_at?: string;
          updated_at?: string;
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
          has_sub_space: boolean;
          sub_space_id: string | null;
          graph_x: number | null;
          graph_y: number | null;
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
          has_sub_space?: boolean;
          sub_space_id?: string | null;
          graph_x?: number | null;
          graph_y?: number | null;
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
          has_sub_space?: boolean;
          sub_space_id?: string | null;
          graph_x?: number | null;
          graph_y?: number | null;
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
          is_part_of_cycle: boolean;
          cycle_id: string | null;
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
          is_part_of_cycle?: boolean;
          cycle_id?: string | null;
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
          is_part_of_cycle?: boolean;
          cycle_id?: string | null;
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
          description: string | null;
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
          description?: string | null;
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
          description?: string | null;
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
