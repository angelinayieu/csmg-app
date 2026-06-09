// ── Crucible store ───────────────────────────────────────────────────
//
// Read/write the Crucible loop state at
//   spaces.synthesis_data.objective_canvas.crucible
//
// Self-contained read-modify-write (re-reads synthesis_data before each write
// so a concurrent writer to a SIBLING objective_canvas key isn't clobbered —
// we only ever replace the `crucible` sub-key). SERVER-ONLY. Soft-fail
// throughout: a read miss returns null, a write failure is logged and swallowed
// so a transient DB error never 500s the loop.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrucibleState } from "./crucible-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Read the current Crucible state, or null if none exists yet. */
export async function readCrucibleState(
  db: AnyDb,
  spaceId: string,
): Promise<CrucibleState | null> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = isRecord(data?.synthesis_data) ? data!.synthesis_data : {};
    const oc = isRecord(synth.objective_canvas) ? synth.objective_canvas : {};
    const crucible = oc.crucible;
    return isRecord(crucible) ? (crucible as unknown as CrucibleState) : null;
  } catch (err) {
    console.warn("[crucible-store] read failed (soft):", err);
    return null;
  }
}

/** Persist the Crucible state, merging into objective_canvas WITHOUT touching
 *  sibling keys (prompt_sharpening, glossary, voice_notes, …). Re-reads
 *  synthesis_data immediately before writing for the freshest base. */
export async function writeCrucibleState(
  db: AnyDb,
  spaceId: string,
  state: CrucibleState,
): Promise<void> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = isRecord(data?.synthesis_data)
      ? { ...(data!.synthesis_data as Record<string, unknown>) }
      : {};
    const oc = isRecord(synth.objective_canvas)
      ? { ...(synth.objective_canvas as Record<string, unknown>) }
      : {};
    oc.crucible = state;
    synth.objective_canvas = oc;
    await db.from("spaces").update({ synthesis_data: synth }).eq("id", spaceId);
  } catch (err) {
    console.warn("[crucible-store] write failed (soft):", err);
  }
}
