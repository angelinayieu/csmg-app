export interface WeaveRequest {
  spaceAId: string;
  spaceBId: string;
}

export interface WeaveBridge {
  source_space_prefix: string;
  source_entity_id: string;
  source_entity_name: string;
  target_space_prefix: string;
  target_entity_id: string;
  target_entity_name: string;
  bridge_type: "identity" | "influence" | "structural";
  coupling_strength: "strong" | "moderate" | "weak";
  coupling_direction:
    | "source_to_target"
    | "target_to_source"
    | "bidirectional";
  shared_variable_name: string;
  description: string;
}

export interface WeaveContradiction {
  assumption_text: string;
  conclusion_text: string;
  severity: "critical" | "moderate" | "minor";
  description: string;
}

export interface WeaveResponse {
  bridges: WeaveBridge[];
  contradictions: WeaveContradiction[];
}
