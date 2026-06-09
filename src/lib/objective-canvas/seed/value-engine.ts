// ── Value engine (Phase C) ───────────────────────────────────────────
//
// What makes the surfaced deliverable NON-WEAK: an idea's value is RELATIVE.
// This grounds the seed against reality so the external face can say "unlike
// X/Y, this …" instead of a platitude. Three moves, written into seed.internal:
//
//   1. differentiate  — name the REAL existing alternatives + their SPECIFIC
//                        failure (web-grounded). Value is relative to these.
//   2. analogize       — existing things like the idea (simpler / more complex)
//                        + what each implies for scope (web-grounded).
//   3. consolidate     — merge variables that mean the same thing into ONE
//                        canonical unit ("units of interaction & trade").
//
// SERVER-ONLY. Web-grounded calls reuse the proven Anthropic web_search pattern
// (getAnthropicClient + getResearchTools + parseResearchResponse). Soft-fail.

import { getAnthropicClient } from "@/lib/anthropic";
import { llmJSON, BEST_CLAUDE_MODEL, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import { getResearchTools, parseResearchResponse, extractJSON } from "@/lib/web-search";
import type { SeedAlternative, SeedAnalog, SeedVariableRef } from "./seed-types";

export interface LandscapeResult {
  alternatives: SeedAlternative[];
  analogousExamples: SeedAnalog[];
  landscape: { fact: string; source?: string }[];
}

/** Web-grounded: real alternatives + analogous products for THIS objective.
 *  Returns empty on miss so the seed still builds. */
export async function enrichLandscape(
  objective: string,
  leverageLabels: string[],
): Promise<LandscapeResult> {
  const empty: LandscapeResult = { alternatives: [], analogousExamples: [], landscape: [] };
  if (!objective.trim()) return empty;
  try {
    const anthropic = getAnthropicClient();
    const resp = await anthropic.messages.create({
      model: BEST_CLAUDE_MODEL,
      max_tokens: 1600,
      system:
        "You are a competitive strategist. Search the web for the REAL existing solutions to this objective, then return STRICT JSON only (no prose) with this shape:\n" +
        '{ "alternatives": [{"name": string, "failure": string}], "analogous": [{"name": string, "relation": "simpler"|"more_complex"|"adjacent", "implication": string}], "landscape": [{"fact": string, "source": string}] }\n' +
        "Rules: name REAL products/companies, not categories. `failure` = the SPECIFIC thing each gets wrong (concrete, falsifiable). `analogous` = things like this idea (simpler or more complex) + what that implies for scope. `landscape` = 2–4 specific facts (with a source domain). 3–5 alternatives, 2–4 analogous. No generic best-practice.",
      messages: [
        {
          role: "user",
          content:
            `OBJECTIVE\n${objective}\n\n` +
            (leverageLabels.length ? `LEVERAGE / ANGLE\n${leverageLabels.slice(0, 4).join("; ")}\n\n` : "") +
            "Search, then return the JSON.",
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: getResearchTools("light") as any,
    });
    const parsed = parseResearchResponse(resp.content);
    const raw = extractJSON<{
      alternatives?: { name?: string; failure?: string }[];
      analogous?: { name?: string; relation?: string; implication?: string }[];
      landscape?: { fact?: string; source?: string }[];
    }>(parsed.jsonOutput);

    const alternatives: SeedAlternative[] = (raw?.alternatives ?? [])
      .map((a) => ({ name: String(a?.name ?? "").trim(), failure: String(a?.failure ?? "").trim() }))
      .filter((a) => a.name && a.failure)
      .slice(0, 5);
    const rel = (r: unknown): SeedAnalog["relation"] =>
      r === "simpler" || r === "more_complex" || r === "adjacent" ? r : "adjacent";
    const analogousExamples: SeedAnalog[] = (raw?.analogous ?? [])
      .map((a) => ({ name: String(a?.name ?? "").trim(), relation: rel(a?.relation), implication: String(a?.implication ?? "").trim() }))
      .filter((a) => a.name)
      .slice(0, 4);
    const landscape = (raw?.landscape ?? [])
      .map((l) => ({ fact: String(l?.fact ?? "").trim(), source: String(l?.source ?? "").trim() || undefined }))
      .filter((l) => l.fact)
      .slice(0, 4);

    return { alternatives, analogousExamples, landscape };
  } catch (err) {
    console.warn("[value-engine] enrichLandscape failed (soft):", err);
    return empty;
  }
}

const CONSOLIDATE_SCHEMA = {
  name: "canonical_variables",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["canonical"],
    properties: {
      canonical: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "label", "note", "mergedFrom"],
          properties: {
            slug: { type: "string", description: "kebab-case canonical unit id" },
            label: { type: "string", description: "≤ 5 words" },
            note: { type: "string", description: "≤ 14 words: what this unit measures" },
            mergedFrom: { type: "array", items: { type: "string" }, description: "the input variable slugs this absorbs" },
          },
        },
      },
    },
  },
} as const;

/** Merge variables that mean the same thing into canonical units. No web. */
export async function consolidateVariables(
  variables: SeedVariableRef[],
): Promise<SeedVariableRef[]> {
  if (variables.length < 2) return variables;
  try {
    const out = await llmJSON<{ canonical?: { slug: string; label: string; note: string; mergedFrom: string[] }[] }>({
      system:
        "You consolidate a list of variables into CANONICAL units. Variables that measure the SAME underlying thing across different features must collapse into ONE unit (so features compare in shared 'units of interaction & trade'). Keep distinct things distinct. Each canonical unit lists the input slugs it absorbs in mergedFrom. Return JSON only.",
      user:
        "VARIABLES (slug — label — note):\n" +
        variables.map((v) => `- ${v.slug} — ${v.label}${v.note ? ` — ${v.note}` : ""}`).join("\n") +
        "\n\nReturn the canonical set (fewer than or equal to the input count).",
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      maxTokens: 1200,
      temperature: 0.2,
      responseSchema: CONSOLIDATE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
    const canon = (out?.canonical ?? [])
      .map((c) => ({
        slug: String(c?.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48),
        label: String(c?.label ?? "").trim().slice(0, 60),
        note: String(c?.note ?? "").trim().slice(0, 160) || undefined,
        mergedFrom: Array.isArray(c?.mergedFrom) ? c.mergedFrom.map((s) => String(s)).filter(Boolean) : [],
      }))
      .filter((c) => c.slug && c.label);
    return canon.length ? canon : variables;
  } catch (err) {
    console.warn("[value-engine] consolidateVariables failed (soft):", err);
    return variables;
  }
}
