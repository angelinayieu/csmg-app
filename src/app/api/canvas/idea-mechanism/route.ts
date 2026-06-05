// ── POST /api/canvas/idea-mechanism ──
//
// The FULL "make it more technical" — generates the real engineering mechanism
// spec for a bare idea (a sticky note), then flattens it into result cards.
//
// Reuse, don't fork: this calls the existing `enrichMechanismSpec` generator
// (its SYSTEM_PROMPT + SPEC_SCHEMA + quality gate) with a minimal, text-derived
// input — NO synthetic DB entity. Empty room_pains/outcomes just make the spec
// a touch more generic; the runtime data-flow DAG, system components, and
// implementation methods still come through. `accept_on_first_attempt` keeps it
// to a single LLM pass (the on-canvas op wants speed over the retry gate).

import { NextResponse } from "next/server";
import { detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import {
  enrichMechanismSpec,
  type EnrichMechanismSpecInput,
  type MechanismSpec,
} from "@/lib/objective-canvas/enrich-mechanism-spec";

export const maxDuration = 60;

interface Body {
  text?: unknown;
}

interface Item {
  title: string;
  subtitle: string;
  /** Structured data tokens — mirrored on the subtitle as text but exposed
   *  here so downstream (library save → tech-spec) reads them as interface
   *  contracts instead of parsing strings. Empty for the lead "How it works"
   *  card. */
  consumes?: string[];
  produces?: string[];
}

/** A short noun phrase for the feature name — first line / sentence. */
function deriveName(text: string): string {
  const firstLine = (text.split(/\n/)[0] ?? "").trim();
  const base = firstLine || text.trim();
  if (!base) return "Idea";
  return base.length > 80 ? `${base.slice(0, 80)}…` : base;
}

/** Flatten the rich spec into board-card rows. The old version dumped the
 *  mechanism + EVERY component + EVERY runtime step as a flat, unordered pile of
 *  "Lab" cards — so the user couldn't tell how they connected ("just generates a
 *  bunch of labs"). The runtime_flow IS the pipeline, so we lead with the
 *  mechanism, then emit the flow as a NUMBERED sequence (1 → 2 → 3) whose
 *  subtitle spells out the data hand-off (consumes X → produces Y). The order +
 *  the produces/consumes chain make the connections legible even in a grid,
 *  until the board's connector layer draws them as arrows. Standalone components
 *  are dropped (each is already named as the `component` of its flow step) so
 *  the result reads as ONE coherent chain, not two overlapping lists. */
function flattenSpec(spec: MechanismSpec): Item[] {
  const items: Item[] = [];
  if (spec.mechanism_of_action) {
    items.push({ title: "How it works", subtitle: spec.mechanism_of_action });
  }
  const flow = spec.runtime_flow ?? [];
  flow.forEach((s, i) => {
    const handoff = [
      s.consumes?.length ? `consumes ${s.consumes.join(", ")}` : "",
      s.produces?.length ? `produces ${s.produces.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" → ");
    items.push({
      title: `${i + 1}. ${s.step}`,
      subtitle: [s.component, s.data, handoff].filter(Boolean).join(" · "),
      consumes: s.consumes ?? [],
      produces: s.produces ?? [],
    });
  });
  // No runtime flow (thin idea) — fall back to the component architecture so the
  // op never returns just the one-line mechanism.
  if (flow.length === 0) {
    for (const c of spec.system_components ?? []) {
      items.push({ title: c.name, subtitle: `${c.category} — ${c.detail}` });
    }
  }
  return items.slice(0, 10);
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const input: EnrichMechanismSpecInput = {
    feature: { name: deriveName(text), definition: text },
    room_pains: [],
    room_outcomes: [],
    sub_objective_title: "",
    core_objective_text: text.slice(0, 4000),
    constraints: null,
    accept_on_first_attempt: true,
  };

  try {
    const items = await withCharge(
      { db: supabase, userId: user.id, operation: "make_technical", spaceId: null },
      async () => {
        const spec = await enrichMechanismSpec(input);
        if (!spec) throw new Error("EMPTY_SPEC");
        return flattenSpec(spec);
      },
    );
    return NextResponse.json({ items });
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    if (err instanceof Error && err.message === "EMPTY_SPEC") {
      // No mechanism produced — don't charge (reservation already cancelled).
      return NextResponse.json({ items: [] });
    }
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/canvas/idea-mechanism] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
