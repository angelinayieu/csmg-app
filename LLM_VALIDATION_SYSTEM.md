# LLM Output Validation System

## Overview

This system provides comprehensive validation and error recovery for Large Language Model (LLM) outputs to prevent data corruption across the Interaxis knowledge graph application.

## Architecture

### 1. **Validation Module** (`src/lib/validation/llm-validators.ts`)

Provides strict schema validation for all LLM-generated data types:

#### Primitive Validators
- **`validators.string()`** - Validates non-empty strings with length limits
- **`validators.number()`** - Validates numbers within specified ranges
- **`validators.confidence()`** - Validates confidence scores (0-1) with auto-clamping
- **`validators.enum()`** - Validates enum values with fallback defaults
- **`validators.boolean()`** - Coerces and validates boolean values
- **`validators.array()`** - Validates arrays with element-level validation
- **`validators.optional()`** - Provides default values for missing/invalid fields

#### Domain-Specific Validators
- **`validateEntity()`** - Validates StructuredEntity with all required fields
- **`validateEdge()`** - Validates StructuredEdge with integrity checks
- **`validateStructuredDecomposition()`** - Validates complete analysis output

#### Key Features
- **Path-based error reporting** - Errors include precise location (e.g., `root.entities[0].confidence`)
- **Helpful suggestions** - Errors include recovery suggestions
- **Enum defaults** - Invalid enum values fall back to sensible defaults
- **Type coercion** - Automatic type conversion where possible
- **Length limits** - Prevents oversized strings from corrupting storage

### 2. **Error Recovery Module** (`src/lib/validation/error-recovery.ts`)

Provides auto-recovery and data sanitization:

#### Recovery Strategies
```typescript
RecoveryStrategy.recover(data, validator, fallback)
```
Attempts three recovery strategies in order:
1. **Clean Data** - Removes null/undefined values and empty strings
2. **Fill Defaults** - Adds missing required fields with sensible defaults
3. **Sanitize Values** - Fixes corrupted numbers and strings

#### Structural Integrity
```typescript
validateStructuralIntegrity(decomposition)  // Detects issues
autoCorrectStructuralIssues(decomposition)   // Auto-fixes
```
- Validates edge references point to existing entities
- Validates cycle entity references
- Validates leverage/risk point references
- Auto-replaces invalid references with valid ones

#### Consistency Validation
```typescript
validateConsistency(decomposition)
```
- Ensures entity_count matches entities array length
- Ensures edge_count matches edges array length
- Auto-corrects mismatches

#### Text Sanitization
```typescript
sanitizeText(text, maxLength)
```
- Removes null bytes (`\x00`)
- Fixes replacement characters
- Normalizes line endings
- Enforces length limits

#### Fallback Creation
```typescript
createFallbackDecomposition(prefix, name, description)
```
Creates minimal valid decomposition when recovery fails completely.

### 3. **LLM Integration** (`src/lib/llm.ts`)

Enhanced `llmJSON()` function with built-in validation:

```typescript
export async function llmJSON<T = unknown>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  validator?: (data: unknown) => T;      // NEW
  fallback?: T;                          // NEW
}): Promise<T>
```

Features:
- **Optional validation** - Pass `validator` function for schema checking
- **Automatic recovery** - Uses `RecoveryStrategy` on validation failure
- **Graceful fallback** - Uses `fallback` value if recovery fails
- **Logging** - Logs recovery details for monitoring

### 4. **Agent Integration** (`src/lib/orchestration/agents.ts`)

Key agents now use validation:

#### `runStructurer()`
```typescript
const result = await llmJSON<StructuredDecomposition>({
  system: STRUCTURING_SYSTEM_PROMPT,
  user: input,
  validator: validateStructuredDecomposition,
  fallback: createFallbackDecomposition("raw", "Raw Analysis", input.slice(0, 200)),
});

// Structural checks
const integrityCheck = validateStructuralIntegrity(result);
if (!integrityCheck.isValid) {
  autoCorrectStructuralIssues(result);
}
validateConsistency(result);
```

#### `runAugmenter()`
```typescript
const result = await llmJSON<StructuredDecomposition>({
  system: AUGMENTER_SYSTEM_PROMPT,
  user: input,
  validator: validateStructuredDecomposition,
  fallback: original,  // Fall back to original
});
```

## Data Corruption Scenarios Addressed

### 1. **Missing Fields**
- **Problem**: LLM omits required fields
- **Solution**: Validators provide sensible defaults
- **Example**: Missing `confidence` defaults to 0.5

### 2. **Invalid Types**
- **Problem**: LLM returns wrong type (string instead of number)
- **Solution**: Type coercion and validation with error recovery
- **Example**: `"0.5"` is converted to `0.5`

### 3. **Out-of-Range Values**
- **Problem**: Values exceed expected bounds (confidence > 1, negative counts)
- **Solution**: Validators clamp values to valid ranges
- **Example**: Confidence 1.5 → 1.0, -0.2 → 0.0

### 4. **Invalid Enum Values**
- **Problem**: LLM generates invalid enum value
- **Solution**: Fallback to default enum value
- **Example**: Invalid `entity_category: "foo"` → `"abstract"`

### 5. **Structural Integrity Issues**
- **Problem**: Edges reference non-existent entities
- **Solution**: Auto-correct references to valid entities
- **Example**: Edge targeting non-existent entity → replaced with first valid entity

### 6. **Count Mismatches**
- **Problem**: Metadata counts don't match actual arrays
- **Solution**: Auto-correct counts to match reality
- **Example**: `entity_count: 100` with 5 actual entities → corrected to 5

### 7. **Null Byte / Replacement Characters**
- **Problem**: Corrupted strings contain `\x00` or `\uFFFD`
- **Solution**: Text sanitization removes these characters
- **Example**: `"hello\x00world"` → `"helloworld"`

### 8. **Total Parsing Failure**
- **Problem**: LLM output doesn't contain valid JSON
- **Solution**: Multiple extraction attempts + fallback decomposition
- **Example**: Tries direct parse → markdown extraction → boundary extraction → fallback

## Usage Examples

### Simple Validation
```typescript
import { validateEntity } from "@/lib/validation/llm-validators";

const entity = await llmJSON<unknown>(/* ... */);
const validated = validateEntity(entity, "root.entities[0]");
```

### With Recovery
```typescript
import { RecoveryStrategy } from "@/lib/validation/error-recovery";
import { validateStructuredDecomposition } from "@/lib/validation/llm-validators";

const recovered = RecoveryStrategy.recover(
  llmOutput,
  validateStructuredDecomposition,
  createFallbackDecomposition()
);

console.log(`Recovered: ${recovered.recovered}`);
console.log(`Errors: ${recovered.errors}`);
```

### Integrated LLM Call
```typescript
const result = await llmJSON<StructuredDecomposition>({
  system: MY_PROMPT,
  user: input,
  validator: validateStructuredDecomposition,
  fallback: createFallbackDecomposition(),
});

// Automatically validated and recovered if needed
```

### Structural Integrity Check
```typescript
const integrity = validateStructuralIntegrity(result);
if (!integrity.isValid) {
  console.warn("Issues detected:", integrity.issues);
  autoCorrectStructuralIssues(result);
}
```

## Error Handling Best Practices

### 1. **Always Provide Fallbacks**
```typescript
validator: validateStructuredDecomposition,
fallback: createFallbackDecomposition("prefix", "name", description),
```

### 2. **Log Recovery Events**
```typescript
const recovered = RecoveryStrategy.recover(/*...*/);
if (recovered.recovered) {
  console.warn("Data recovery was necessary:", recovered.errors);
}
```

### 3. **Validate After Critical Operations**
```typescript
const structural = validateStructuralIntegrity(result);
const consistency = validateConsistency(result);
if (!structural.isValid || !consistency.isConsistent) {
  // Handle or log issues
}
```

### 4. **Use Meaningful Paths in Errors**
```typescript
// Good - includes full path
throw new ValidationError(
  `root.entities[${i}].name`,
  "Name is required"
);

// Context for debugging
try {
  validateEntity(entity, `root.entities[${index}]`);
} catch (err) {
  console.error(`Error validating entity at index ${index}:`, err.message);
}
```

## Performance Considerations

1. **Validation is Fast** - Most operations are O(n) where n is data size
2. **Recovery is Expensive** - Retries multiple strategies, use fallbacks early
3. **Caching** - Validators are pure functions, safe to call multiple times
4. **Batch Operations** - Validate arrays in single pass, not element-by-element

## Monitoring and Debugging

### Enable Detailed Logging
```typescript
// In llm.ts line where recovery occurs
if (!recovered.recovered && recovered.errors.length > 0) {
  console.error("LLM Output Validation Failure", {
    input_size: raw.length,
    errors: recovered.errors,
    attempted_validators: recovered.errors.length,
  });
}
```

### Track Validation Metrics
```typescript
const metrics = {
  total_validations: 0,
  successful: 0,
  recovered: 0,
  fallback_used: 0,
};
```

## Testing

Comprehensive test suite covers:
- ✅ Primitive validator edge cases
- ✅ Entity validation completeness
- ✅ Edge validation with invalid references
- ✅ Decomposition validation with missing fields
- ✅ Error recovery strategies
- ✅ Structural integrity detection
- ✅ Consistency validation and auto-correction
- ✅ Text sanitization
- ✅ Fallback decomposition creation
- ✅ Error message quality

## Future Enhancements

1. **Schema Versioning** - Support multiple StructuredDecomposition versions
2. **Custom Validators** - Allow domain-specific validation rules
3. **Validation Metrics** - Track which validations fail most often
4. **Batch Validation** - Optimize validation of large arrays
5. **Async Validators** - Support async validation rules (e.g., DB lookups)
6. **Error Tracking** - Persistent error logging for post-mortem analysis

## Integration Checklist

- ✅ Validation module created with comprehensive validators
- ✅ Error recovery module with auto-correction
- ✅ llmJSON enhanced with validation support
- ✅ runStructurer integrated with validation
- ✅ runAugmenter integrated with validation
- ✅ Structural integrity checks in place
- ✅ Consistency validation in place
- ✅ Test suite created
- ⏭️ Additional agents to integrate (runWeaver, runMetaSynthesizer, etc.)
- ⏭️ Metrics dashboard for monitoring
