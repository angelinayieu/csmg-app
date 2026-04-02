/**
 * LLM Output Validation Tests
 * 
 * Comprehensive test suite covering validation edge cases and error recovery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  validators,
  validateEntity,
  validateEdge,
  validateStructuredDecomposition,
  ValidationError,
} from "@/lib/validation/llm-validators";
import {
  RecoveryStrategy,
  validateStructuralIntegrity,
  autoCorrectStructuralIssues,
  validateConsistency,
  sanitizeText,
  createFallbackDecomposition,
} from "@/lib/validation/error-recovery";
import type {
  StructuredDecomposition,
  StructuredEntity,
  StructuredEdge,
} from "@/types/analysis";

describe("Primitive Validators", () => {
  describe("string validator", () => {
    it("validates non-empty strings", () => {
      expect(validators.string("hello", "test")).toBe("hello");
    });

    it("rejects empty strings", () => {
      expect(() => validators.string("", "test")).toThrow(ValidationError);
    });

    it("rejects whitespace-only strings", () => {
      expect(() => validators.string("   ", "test")).toThrow(ValidationError);
    });

    it("trims whitespace", () => {
      expect(validators.string("  hello  ", "test")).toBe("hello");
    });

    it("respects max length", () => {
      expect(() => validators.string("a".repeat(2001), "test", 2000)).toThrow(
        ValidationError
      );
    });

    it("rejects non-string types", () => {
      expect(() => validators.string(123, "test")).toThrow(ValidationError);
    });
  });

  describe("number validator", () => {
    it("validates numbers within range", () => {
      expect(validators.number(5, "test", 0, 10)).toBe(5);
    });

    it("rejects numbers out of range", () => {
      expect(() => validators.number(15, "test", 0, 10)).toThrow(
        ValidationError
      );
    });

    it("rejects NaN", () => {
      expect(() => validators.number(NaN, "test")).toThrow(ValidationError);
    });

    it("rejects non-number types", () => {
      expect(() => validators.number("5", "test")).toThrow(ValidationError);
    });
  });

  describe("confidence validator", () => {
    it("clamps values to 0-1 range", () => {
      expect(validators.confidence(0.5, "test")).toBe(0.5);
      expect(validators.confidence(1.5, "test")).toBe(1);
      expect(validators.confidence(-0.5, "test")).toBe(0);
    });

    it("rejects NaN", () => {
      expect(() => validators.confidence(NaN, "test")).toThrow();
    });
  });

  describe("enum validator", () => {
    it("accepts valid enum values", () => {
      const result = validators.enum<"a" | "b" | "c">(
        "a",
        ["a", "b", "c"],
        "test"
      );
      expect(result).toBe("a");
    });

    it("rejects invalid enum values", () => {
      expect(() =>
        validators.enum<"a" | "b" | "c">(
          "d",
          ["a", "b", "c"],
          "test"
        )
      ).toThrow(ValidationError);
    });

    it("uses default value when invalid", () => {
      const result = validators.enum<"a" | "b" | "c">(
        "d",
        ["a", "b", "c"],
        "test",
        "a"
      );
      expect(result).toBe("a");
    });
  });

  describe("boolean validator", () => {
    it("validates boolean values", () => {
      expect(validators.boolean(true, "test")).toBe(true);
      expect(validators.boolean(false, "test")).toBe(false);
    });

    it("coerces string boolean values", () => {
      expect(validators.boolean("true", "test")).toBe(true);
      expect(validators.boolean("false", "test")).toBe(false);
    });

    it("coerces numeric boolean values", () => {
      expect(validators.boolean(1, "test")).toBe(true);
      expect(validators.boolean(0, "test")).toBe(false);
    });

    it("uses default for invalid values", () => {
      expect(validators.boolean("maybe", "test", false)).toBe(false);
      expect(validators.boolean("maybe", "test", true)).toBe(true);
    });
  });

  describe("array validator", () => {
    it("validates arrays with element validation", () => {
      const result = validators.array(
        [1, 2, 3],
        (v) => validators.number(v, "el"),
        "test"
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it("rejects non-array types", () => {
      expect(() =>
        validators.array("not an array", () => "", "test")
      ).toThrow(ValidationError);
    });

    it("fails on invalid element", () => {
      expect(() =>
        validators.array([1, "invalid", 3], (v) => validators.number(v, "el"), "test")
      ).toThrow(ValidationError);
    });
  });
});

describe("Entity Validation", () => {
  it("validates complete entity", () => {
    const entity: StructuredEntity = {
      entity_id: "E1",
      name: "Test Entity",
      description: "A test entity",
      source_tag: "explicit",
      entity_type: "concept",
      entity_category: "abstract",
      layer: null,
      importance: "important",
      confidence: 0.8,
      is_leverage_point: false,
      is_risk_point: false,
      is_master_bottleneck: false,
      blast_radius: 0.5,
      centrality_rank: null,
      is_shared_variable: false,
      is_decomposable: true,
    };

    const result = validateEntity(entity, "root.entities[0]");
    expect(result.entity_id).toBe("E1");
    expect(result.importance).toBe("important");
  });

  it("applies defaults to optional fields", () => {
    const entity = {
      entity_id: "E1",
      name: "Test",
      description: "Test",
      entity_type: "type",
    };

    const result = validateEntity(entity, "root.entities[0]");
    expect(result.source_tag).toBe("explicit");
    expect(result.entity_category).toBe("abstract");
  });

  it("rejects invalid entity categories", () => {
    const entity = {
      entity_id: "E1",
      name: "Test",
      description: "Test",
      entity_type: "type",
      entity_category: "invalid_category",
    };

    const result = validateEntity(entity, "root.entities[0]");
    expect(result.entity_category).toBe("abstract"); // Uses default
  });
});

describe("Edge Validation", () => {
  it("validates complete edge", () => {
    const edge: StructuredEdge = {
      source_entity_id: "E1",
      target_entity_id: "E2",
      relationship_type: "influences",
      dimension: "causal",
      source_tag: "stated",
      strength: 0.7,
      polarity: "positive",
      confidence: 0.8,
      conditions: null,
      is_tradeoff: false,
      resolved_by_entity_id: null,
      is_part_of_cycle: false,
      cycle_id: null,
      requires_user_approval: false,
    };

    const result = validateEdge(edge, "root.edges[0]");
    expect(result.source_entity_id).toBe("E1");
    expect(result.dimension).toBe("causal");
  });

  it("applies sensible defaults for edge dimensions", () => {
    const edge = {
      source_entity_id: "E1",
      target_entity_id: "E2",
      relationship_type: "links",
      dimension: "invalid_dimension",
      source_tag: "inferred",
      strength: 0.5,
      polarity: "neutral",
      confidence: 0.6,
    };

    const result = validateEdge(edge, "root.edges[0]");
    expect(result.dimension).toBe("correlational"); // Uses default
  });
});

describe("Structured Decomposition Validation", () => {
  let validDecomposition: StructuredDecomposition;

  beforeEach(() => {
    validDecomposition = {
      metadata: {
        name: "Test Analysis",
        description: "A test analysis",
        space_prefix: "test",
        entity_count: 1,
        edge_count: 0,
        orphan_count: 0,
        cycle_count: 0,
        maturity: "theoretical",
        synthesis_text: "Test synthesis",
      },
      entities: [
        {
          entity_id: "E1",
          name: "Entity 1",
          description: "First entity",
          source_tag: "explicit",
          entity_type: "concept",
          entity_category: "abstract",
          layer: null,
          importance: "moderate",
          confidence: 0.5,
          is_leverage_point: false,
          is_risk_point: false,
          is_master_bottleneck: false,
          blast_radius: 0,
          centrality_rank: null,
          is_shared_variable: false,
          is_decomposable: false,
        },
      ],
      edges: [],
      cycles: [],
      propositions: [],
      novel_connections: [],
      contradictions: [],
      scenarios: [],
      action_items: [],
      open_questions: [],
      leverage_points: [],
      risk_points: [],
      master_bottleneck: null,
      shared_variables: [],
    };
  });

  it("validates complete decomposition", () => {
    const result = validateStructuredDecomposition(validDecomposition);
    expect(result.metadata.name).toBe("Test Analysis");
    expect(result.entities.length).toBe(1);
  });

  it("auto-corrects entity count", () => {
    validDecomposition.metadata.entity_count = 999;
    const result = validateStructuredDecomposition(validDecomposition);
    expect(result.metadata.entity_count).toBe(1);
  });

  it("provides fallback for missing entities", () => {
    const invalid = {
      metadata: {
        name: "Test",
        description: "Test",
        space_prefix: "test",
      },
    };

    const result = validateStructuredDecomposition(invalid);
    expect(Array.isArray(result.entities)).toBe(true);
  });
});

describe("Error Recovery", () => {
  it("recovers from corrupted numbers", () => {
    const corrupted = {
      metadata: { name: "Test", description: "Test", space_prefix: "test" },
      entities: [
        {
          entity_id: "E1",
          name: "Entity",
          description: "Desc",
          entity_type: "type",
          confidence: NaN, // Corrupted
        },
      ],
      edges: [],
    };

    const recovered = RecoveryStrategy.recover(
      corrupted,
      validateStructuredDecomposition,
      createFallbackDecomposition()
    );

    expect(recovered.recovered).toBe(true);
    expect(recovered.data.entities[0].confidence).toBeDefined();
    expect(isNaN(recovered.data.entities[0].confidence)).toBe(false);
  });

  it("sanitizes text properly", () => {
    expect(sanitizeText("hello\x00world")).toBe("helloworld");
    expect(sanitizeText("  hello  ")).toBe("hello");
    expect(sanitizeText("a".repeat(5000), 2000).length).toBe(2000);
  });

  it("creates minimal fallback decomposition", () => {
    const fallback = createFallbackDecomposition("prefix", "name", "description");
    expect(fallback.metadata.name).toBe("name");
    expect(fallback.metadata.space_prefix).toBe("prefix");
    expect(fallback.entities.length).toBe(0);
    expect(fallback.edges.length).toBe(0);
  });
});

describe("Structural Integrity Validation", () => {
  let decomposition: StructuredDecomposition;

  beforeEach(() => {
    decomposition = createFallbackDecomposition();
    decomposition.entities = [
      {
        entity_id: "E1",
        name: "Entity 1",
        description: "Test",
        source_tag: "explicit",
        entity_type: "type",
        entity_category: "abstract",
        layer: null,
        importance: "moderate",
        confidence: 0.5,
        is_leverage_point: false,
        is_risk_point: false,
        is_master_bottleneck: false,
        blast_radius: 0,
        centrality_rank: null,
        is_shared_variable: false,
        is_decomposable: false,
      },
    ];
  });

  it("detects dangling edge references", () => {
    decomposition.edges = [
      {
        source_entity_id: "E1",
        target_entity_id: "E999", // Invalid reference
        relationship_type: "links",
        dimension: "causal",
        source_tag: "inferred",
        strength: 0.5,
        polarity: "neutral",
        confidence: 0.5,
        conditions: null,
        is_tradeoff: false,
        resolved_by_entity_id: null,
        is_part_of_cycle: false,
        cycle_id: null,
        requires_user_approval: false,
      },
    ];

    const check = validateStructuralIntegrity(decomposition);
    expect(check.isValid).toBe(false);
    expect(check.issues.some((i) => i.includes("E999"))).toBe(true);
  });

  it("auto-corrects dangling edges", () => {
    decomposition.edges = [
      {
        source_entity_id: "E1",
        target_entity_id: "E999",
        relationship_type: "links",
        dimension: "causal",
        source_tag: "inferred",
        strength: 0.5,
        polarity: "neutral",
        confidence: 0.5,
        conditions: null,
        is_tradeoff: false,
        resolved_by_entity_id: null,
        is_part_of_cycle: false,
        cycle_id: null,
        requires_user_approval: false,
      },
    ];

    const corrected = autoCorrectStructuralIssues(decomposition);
    expect(corrected.edges[0].target_entity_id).toBe("E1"); // Corrected to valid entity
  });
});

describe("Consistency Validation", () => {
  it("detects count mismatches", () => {
    const decomposition = createFallbackDecomposition();
    decomposition.entities = [
      {
        entity_id: "E1",
        name: "Entity",
        description: "Test",
        source_tag: "explicit",
        entity_type: "type",
        entity_category: "abstract",
        layer: null,
        importance: "moderate",
        confidence: 0.5,
        is_leverage_point: false,
        is_risk_point: false,
        is_master_bottleneck: false,
        blast_radius: 0,
        centrality_rank: null,
        is_shared_variable: false,
        is_decomposable: false,
      },
    ];
    decomposition.metadata.entity_count = 999;

    const check = validateConsistency(decomposition);
    expect(check.isConsistent).toBe(false);
    expect(decomposition.metadata.entity_count).toBe(1); // Corrected
  });
});

describe("Validation Error Handling", () => {
  it("provides helpful error messages", () => {
    try {
      validators.string(123, "root.user_input", 100);
    } catch (err) {
      expect(err instanceof ValidationError).toBe(true);
      const error = err as ValidationError;
      expect(error.path).toBe("root.user_input");
      expect(error.reason).toContain("Expected string");
    }
  });

  it("includes suggestions in error messages", () => {
    try {
      validators.enum<"a" | "b">(
        "c",
        ["a", "b"],
        "test.enum"
      );
    } catch (err) {
      const error = err as ValidationError;
      expect(error.suggestion).toBeDefined();
    }
  });
});
