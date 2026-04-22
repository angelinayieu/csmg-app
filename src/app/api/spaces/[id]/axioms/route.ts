// GET /api/spaces/[id]/axioms
//
// Phase A1.4a — surfaces the axioms embedded in a space's
// synthesis_data so the universal asset catalog can expose them as
// draggable reasoning artifacts.
//
// Axioms are NOT a standalone table — they live as a JSON array under
// `spaces.synthesis_data.axioms`. They regenerate on every synthesis
// pass, so consumers should treat them as ephemeral records keyed by
// semantic `axiom_id` (e.g. "A2"), not durable UUIDs.
//
// The library hydrates the axiom's full content at drop time onto the
// shape props so the card survives future re-synthesis (the axiom set
// may change, but the frozen card on the whiteboard keeps the reading
// the user dropped).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Axiom } from "@/types/synthesis";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface AxiomsResponse {
  axioms: Axiom[];
  /** True when synthesis_data exists and was parseable. */
  synthesis_present: boolean;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = (await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle()) as {
    data: { synthesis_data: unknown } | null;
    error: unknown;
  };

  if (error) {
    console.error("[space axioms] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch synthesis_data" },
      { status: 500 },
    );
  }

  let synthesis: Record<string, unknown> | null = null;
  const raw = data?.synthesis_data ?? null;
  if (raw && typeof raw === "object") {
    synthesis = raw as Record<string, unknown>;
  } else if (typeof raw === "string") {
    try {
      synthesis = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      synthesis = null;
    }
  }

  const rawAxioms = synthesis?.axioms;
  const axioms: Axiom[] = Array.isArray(rawAxioms)
    ? (rawAxioms as Axiom[]).filter(
        (a): a is Axiom =>
          !!a &&
          typeof a === "object" &&
          typeof (a as Axiom).axiom_id === "string" &&
          typeof (a as Axiom).claim === "string",
      )
    : [];

  const payload: AxiomsResponse = {
    axioms,
    synthesis_present: synthesis !== null,
  };
  return NextResponse.json(payload);
}
