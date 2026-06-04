// ── generate-journal ──────────────────────────────────────────────
//
// Append a new voice note to the persisted set, then re-synthesize the WHOLE
// journal from all notes and persist it. Notes + artifact live in
// spaces.synthesis_data.objective_canvas (voice_notes[] + journal), so the
// journal stays whole + reload-robust as it grows. Soft-fail throughout.

import { llmJSON } from "../llm";
import {
  JOURNAL_AGENT_SYSTEM,
  JOURNAL_USER,
  JOURNAL_RESPONSE_SCHEMA,
  normalizeJournal,
  type JournalArtifact,
} from "./journal-prompt";
import { patchObjectiveCanvasState } from "./clarifying-state";

// Match the prompt-sharpening model choice (Opus 4.6, no temperature param).
const JOURNAL_MODEL = "claude-opus-4-6";
const MAX_NOTES = 200;

export async function synthesizeJournalForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  newNote?: string,
): Promise<JournalArtifact | null> {
  try {
    const { data: space } = await db
      .from("spaces")
      .select("user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space || space.user_id !== userId) return null;

    const oc = (space.synthesis_data as Record<string, unknown> | null)
      ?.objective_canvas as { voice_notes?: unknown } | undefined;
    const notes: string[] = Array.isArray(oc?.voice_notes)
      ? (oc!.voice_notes as unknown[]).filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0,
        )
      : [];
    const trimmed = (newNote ?? "").trim();
    if (trimmed) notes.push(trimmed);
    if (notes.length === 0) return null;
    const bounded = notes.slice(-MAX_NOTES);

    let artifact: JournalArtifact;
    try {
      artifact = await llmJSON<JournalArtifact>({
        system: JOURNAL_AGENT_SYSTEM,
        user: JOURNAL_USER(bounded),
        provider: "anthropic",
        model: JOURNAL_MODEL,
        maxTokens: 3000,
        responseSchema: JOURNAL_RESPONSE_SCHEMA,
        validator: (d) => normalizeJournal(d),
      });
    } catch (e) {
      console.warn(
        "[journal] synthesis failed:",
        e instanceof Error ? e.message : String(e),
      );
      return null;
    }
    artifact.generated_at = new Date().toISOString();

    // Re-read for the freshest base, then persist notes + journal.
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const patched = patchObjectiveCanvasState(fresh?.synthesis_data, {
      // module-augmentation keys; spread onto objective_canvas as-is.
      voice_notes: bounded,
      journal: artifact,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: patched })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn("[journal] persist failed:", writeRes.error.message);
    }
    return artifact;
  } catch (err) {
    console.warn(
      "[journal] generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
