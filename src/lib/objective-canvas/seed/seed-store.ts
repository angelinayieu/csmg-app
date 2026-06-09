// ── Seed store ───────────────────────────────────────────────────────
//
// Read/write the ObjectiveSeed at spaces.synthesis_data.objective_canvas.seed.
// Merge-safe (re-reads + replaces only the `seed` sub-key, so sibling keys —
// prompt_sharpening, crucible, glossary — are untouched). SERVER-ONLY. Soft-fail.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ObjectiveSeed } from "./seed-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function readSeed(db: AnyDb, spaceId: string): Promise<ObjectiveSeed | null> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = isRecord(data?.synthesis_data) ? data!.synthesis_data : {};
    const oc = isRecord(synth.objective_canvas) ? synth.objective_canvas : {};
    return isRecord(oc.seed) ? (oc.seed as unknown as ObjectiveSeed) : null;
  } catch (err) {
    console.warn("[seed-store] read failed (soft):", err);
    return null;
  }
}

export async function writeSeed(db: AnyDb, spaceId: string, seed: ObjectiveSeed): Promise<void> {
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
    oc.seed = seed;
    synth.objective_canvas = oc;
    await db.from("spaces").update({ synthesis_data: synth }).eq("id", spaceId);
  } catch (err) {
    console.warn("[seed-store] write failed (soft):", err);
  }
}
