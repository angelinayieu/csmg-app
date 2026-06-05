// ── build-space-context ─────────────────────────────────────────────
//
// The shared substrate that makes on-canvas AI ops reason WITH the user's
// taste instead of from raw text. Assembles, for a space:
//   • the objective — the RE-FRAMED sharpened prompt when present (which bakes
//     in the user's resolutions), else the space's own text,
//   • a compact preamble — the glossary (defined terms = the user's vocabulary)
//     + the resolved intent (Resolution Studio answers).
// Ops prepend `preamble` to their LLM user prompt so generation honors the
// definitions + resolutions the user worked to set. Soft-fail: returns empty
// context (ops behave exactly as before) on any error.

import type { GlossaryTerm } from "./generate-glossary";
import type { PromptSharpeningArtifact } from "./prompt-sharpening-prompt";

export interface SpaceContext {
  /** Re-framed sharpened objective if present, else the space's own text. */
  objective: string;
  /** Compact prompt preamble (glossary + resolved intent). "" if none. */
  preamble: string;
  /** True when there's at least glossary or resolutions to inject. */
  hasContext: boolean;
}

const MAX_GLOSSARY = 24;

export async function buildSpaceContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<SpaceContext> {
  const empty: SpaceContext = {
    objective: "",
    preamble: "",
    hasContext: false,
  };
  try {
    const { data: space } = await db
      .from("spaces")
      .select("synthesis_data, input_text, description, primary_goal, name")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space) return empty;

    const synth = (space.synthesis_data as Record<string, unknown> | null) ?? {};
    const oc = synth.objective_canvas as
      | { prompt_sharpening?: PromptSharpeningArtifact }
      | undefined;
    const artifact = oc?.prompt_sharpening;

    // Prefer the re-framed sharpened prompt — it encodes the user's resolved
    // intent. Fall back to the space's own text.
    const objective =
      (artifact?.sharpened_prompt && artifact.sharpened_prompt.trim()) ||
      (
        space.primary_goal ||
        space.description ||
        space.input_text ||
        space.name ||
        ""
      )
        .toString()
        .trim();

    // Glossary — already authority-sorted on write (user > annotation > ...).
    const glossary: GlossaryTerm[] = Array.isArray(synth.glossary)
      ? (synth.glossary as GlossaryTerm[])
      : [];
    const gTop = glossary
      .filter((g) => g?.term && g?.definition)
      .slice(0, MAX_GLOSSARY);
    const glossaryBlock = gTop.length
      ? "Defined terms (use these EXACT meanings; never silently redefine):\n" +
        gTop.map((g) => `- ${g.term}: ${g.definition}`).join("\n")
      : "";

    // Resolutions — the user's explicit clarifications (highest-signal taste).
    const resolutions = artifact?.resolutions ?? [];
    const rLines = resolutions
      .map((r) => {
        const ans = r.answer_text?.trim() || r.chosen_readings.join("; ");
        return ans ? `- "${r.phrase}" → ${ans}` : "";
      })
      .filter(Boolean);
    const rBlock = rLines.length
      ? "Resolved intent (the user clarified these — honor them precisely):\n" +
        rLines.join("\n")
      : "";

    const parts = [glossaryBlock, rBlock].filter(Boolean);
    const preamble = parts.length
      ? "## Shared project context — honor the user's vocabulary + resolved intent\n\n" +
        parts.join("\n\n")
      : "";

    return { objective, preamble, hasContext: parts.length > 0 };
  } catch {
    return empty;
  }
}
