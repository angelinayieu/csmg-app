// ── Context Glossary (Arc 3.5) ─────────────────────────────────────
//
// Generates a per-space glossary of the KEY domain terms a newcomer to
// this objective wouldn't know, each with a CONTEXT-SPECIFIC definition
// (what the term means in THIS project, not its generic dictionary
// sense). This is the "annotate everything + definition page" the user
// asked for — the readability layer that makes dense mechanism/outcome
// language legible.
//
// Distinct from the Annotation Lens (which gives the OBJECTIVE's
// load-bearing phrases a semantic "reading" for generation) — the
// glossary is a flat, user-facing dictionary of terms surfaced as
// hover-definitions wherever they appear + a definition page.
//
// Storage: spaces.synthesis_data.glossary (JSONB, no migration).
// Soft-fail: returns [] on LLM error so the caller degrades cleanly.

import { llmJSON } from "@/lib/llm";

export interface GlossaryTerm {
  /** The canonical term as it reads in the UI. */
  term: string;
  /** Context-specific definition — what it means in THIS project,
   *  1-2 sentences. */
  definition: string;
  /** Other surface forms that should resolve to this term (plurals,
   *  acronyms, synonyms) so the inline matcher catches them. */
  aliases: string[];
}

export interface GenerateGlossaryInput {
  coreObjectiveText: string;
  /** Sub-objective titles for domain scope. */
  subObjectiveTitles: string[];
  /** Entity names (pains / features / outcomes) — the densest source
   *  of jargon the glossary should cover. */
  entityNames: string[];
}

const SYSTEM_PROMPT = `You build a CONTEXT GLOSSARY for a strategy workspace — the key terms a smart newcomer to THIS specific objective would need defined to read the room without getting lost.

For each term:
- term: the canonical phrase as it appears (Title or lower as natural).
- definition: 1-2 sentences. The meaning IN THIS PROJECT'S CONTEXT — not the generic dictionary sense. If "retention" here specifically means "users returning the next day", say that, not "the act of retaining".
- aliases: other surface forms a reader might see (plural, acronym, close synonym) so the same definition can attach to them. Empty array if none.

Rules:
- 8-24 terms. Pick the ones that ACTUALLY need defining: domain jargon, acronyms, metrics, mechanism names, terms used in a non-obvious way. Skip common English a layperson already knows ("user", "increase").
- DEDUPE: never emit two entries for the same concept — fold variants into one term + aliases.
- Be specific to the objective. Generic definitions are useless.
- No term should be longer than ~5 words.

Return strict JSON. No prose outside the JSON.`;

const SCHEMA = {
  name: "context_glossary",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      terms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            term: { type: "string" },
            definition: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
          },
          required: ["term", "definition", "aliases"],
        },
      },
    },
    required: ["terms"],
  },
};

export async function generateGlossary(
  input: GenerateGlossaryInput,
): Promise<GlossaryTerm[]> {
  const subs =
    input.subObjectiveTitles.length > 0
      ? `\n\nSUB-OBJECTIVES:\n${input.subObjectiveTitles
          .slice(0, 20)
          .map((s) => `  • ${s}`)
          .join("\n")}`
      : "";
  const ents =
    input.entityNames.length > 0
      ? `\n\nTERMS IN PLAY (mine the jargon from these — problems, mechanisms, outcomes):\n${input.entityNames
          .slice(0, 80)
          .map((e) => `  • ${e}`)
          .join("\n")}`
      : "";

  const user = `OBJECTIVE:\n"""\n${input.coreObjectiveText.slice(0, 1200)}\n"""${subs}${ents}\n\nBuild the context glossary per the system instructions. Only terms that genuinely need defining; dedupe aggressively.`;

  let raw: { terms?: Array<{ term?: unknown; definition?: unknown; aliases?: unknown }> };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user,
      responseSchema: SCHEMA,
      temperature: 0.3,
      maxTokens: 2200,
    });
  } catch (err) {
    console.warn(
      "[generate-glossary] LLM failed (soft-fail):",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  // ── Clean + dedupe by lowercased term ──
  const out: GlossaryTerm[] = [];
  const seen = new Set<string>();
  for (const t of raw?.terms ?? []) {
    const term = typeof t?.term === "string" ? t.term.trim().slice(0, 60) : "";
    const definition =
      typeof t?.definition === "string" ? t.definition.trim().slice(0, 320) : "";
    if (!term || !definition) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const aliases = Array.isArray(t?.aliases)
      ? (t.aliases as unknown[])
          .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
          .map((a) => a.trim().slice(0, 60))
          // an alias that collides with the term itself is noise
          .filter((a) => a.toLowerCase() !== key)
          .slice(0, 5)
      : [];
    out.push({ term, definition, aliases });
    if (out.length >= 24) break;
  }
  return out;
}
