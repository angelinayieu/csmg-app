// ── Data-Presence Classifier pipeline library ────────────────────────
//
// Wraps the data-presence LLM prompt + adds a cheap keyword fast-path
// so the common cases (pure idea, obvious telemetry dump) don't even
// burn a token. Soft-fails to the empty bundle on any failure.
//
// Slot in the intake handoff:
//   intake/bootstrap
//     → rigor-intake (parallel with this stage today)
//     → [THIS STAGE] classify-data-presence
//     → frame-extractor (reads spaces.data_presence to gate axes)
//     → decompose-hierarchical, ...
//
// Runtime: ~0.5-2s typical. Keyword fast-path skips LLM when the
// input is obviously one mode (short one-line thought, or an obvious
// CSV/telemetry dump).

import { llmJSON } from "@/lib/llm";
import {
  buildDataPresencePrompt,
  validateDataPresence,
  deriveTwinMode,
  type DataPresenceTags,
  type DataPresencePromptInput,
  type TwinMode,
} from "@/lib/prompts/data-presence-classifier";

export interface ClassifyDataPresenceOptions {
  inputText: string;
  rigorSummary?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ClassifyDataPresenceResult {
  tags: DataPresenceTags;
  twin_mode: TwinMode;
  stats: {
    llm_called: boolean;
    fast_path_used: boolean;
    fallback_used: boolean;
    duration_ms: number;
  };
}

// ── Keyword fast-path ────────────────────────────────────────────────
//
// Two common short-circuits to avoid the LLM call:
//
// (a) Very short, no digits, no technical vocab → almost certainly
//     has_just_idea. Users who type "thinking about improving our
//     sales process" don't need an LLM round-trip.
//
// (b) Input contains obvious telemetry markers (repeated timestamp-
//     like patterns, comma-separated numeric tables, JSON-looking
//     arrays) → almost certainly has_telemetry.
//
// Both are conservative — we only short-circuit when we're very
// confident. Ambiguous inputs still go through the LLM.

const TELEMETRY_MARKERS = [
  // ISO timestamp (2026-04-25T14:32...)
  /\b\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}/,
  // CSV-like tabular block: 3+ lines with >= 2 commas each
  /(?:^[^\n,]*,[^\n,]*,[^\n,]*$\n){3,}/m,
  // Explicit dashboard/telemetry vocab
  /\b(telemetry|sensor|live feed|streaming|event stream|metrics dashboard)\b/i,
];

function hasMultipleTelemetryMarkers(text: string): boolean {
  let hits = 0;
  for (const rx of TELEMETRY_MARKERS) {
    if (rx.test(text)) hits++;
  }
  return hits >= 2;
}

function looksLikePureIdea(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 240) return false;          // too long to be "just an idea"
  if (/\d{3,}/.test(trimmed)) return false;        // contains a number with >=3 digits (baseline/metric)
  if (/\$|%|\bkg\b|\bmph\b|\bmin\b|\bsec\b|°[cf]/i.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).length;
  if (words > 40) return false;                    // too many words; probably a spec
  return true;
}

// ── Main entry ───────────────────────────────────────────────────────

export async function classifyDataPresence(
  opts: ClassifyDataPresenceOptions,
): Promise<ClassifyDataPresenceResult> {
  const startedAt = Date.now();
  const input = opts.inputText ?? "";

  // Fast-path A: obvious telemetry dump
  if (hasMultipleTelemetryMarkers(input)) {
    const tags: DataPresenceTags = {
      has_telemetry: true,
      has_historical_output: false,
      has_baseline: false,
      has_spec: false,
      has_just_idea: false,
      data_presence_score: 0.9,
      evidence_excerpts: [input.slice(0, 120)],
    };
    return {
      tags,
      twin_mode: deriveTwinMode(tags),
      stats: {
        llm_called: false,
        fast_path_used: true,
        fallback_used: false,
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  // Fast-path B: obvious pure-idea
  if (looksLikePureIdea(input)) {
    const tags: DataPresenceTags = {
      has_telemetry: false,
      has_historical_output: false,
      has_baseline: false,
      has_spec: false,
      has_just_idea: true,
      data_presence_score: 0,
      evidence_excerpts: [input.slice(0, 120)],
    };
    return {
      tags,
      twin_mode: deriveTwinMode(tags),
      stats: {
        llm_called: false,
        fast_path_used: true,
        fallback_used: false,
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  // LLM path — genuinely ambiguous inputs.
  const promptInput: DataPresencePromptInput = {
    inputText: input,
    rigorSummary: opts.rigorSummary,
  };
  const { system, user } = buildDataPresencePrompt(promptInput);

  const emptyTags: DataPresenceTags = {
    has_telemetry: false,
    has_historical_output: false,
    has_baseline: false,
    has_spec: false,
    has_just_idea: true,  // neutral fallback = "just an idea" (least-capable mode)
    data_presence_score: 0,
    evidence_excerpts: [],
  };

  let tags: DataPresenceTags = emptyTags;
  let llmCalled = true;
  let fallbackUsed = false;

  try {
    const parsed = await llmJSON<unknown>({
      system,
      user,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.1,
      fallback: {},
    });
    tags = validateDataPresence(parsed);
    // If validator returned the all-false shape (LLM produced garbage
    // that coerced down), flag fallback so callers can log it.
    const anyTrue =
      tags.has_telemetry ||
      tags.has_historical_output ||
      tags.has_baseline ||
      tags.has_spec;
    if (!anyTrue && !tags.has_just_idea) fallbackUsed = true;
  } catch (err) {
    console.warn("[data-presence] LLM call failed:", err);
    tags = emptyTags;
    fallbackUsed = true;
  }

  return {
    tags,
    twin_mode: deriveTwinMode(tags),
    stats: {
      llm_called: llmCalled,
      fast_path_used: false,
      fallback_used: fallbackUsed,
      duration_ms: Date.now() - startedAt,
    },
  };
}
