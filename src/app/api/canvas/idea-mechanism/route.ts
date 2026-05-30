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
}

/** A short noun phrase for the feature name — first line / sentence. */
function deriveName(text: string): string {
  const firstLine = (text.split(/\n/)[0] ?? "").trim();
  const base = firstLine || text.trim();
  if (!base) return "Idea";
  return base.length > 80 ? `${base.slice(0, 80)}…` : base;
}

/** Flatten the rich spec into board-card rows: the causal action, the system
 *  components (the architecture), then the runtime data-flow steps (the DAG). */
function flattenSpec(spec: MechanismSpec): Item[] {
  const items: Item[] = [];
  if (spec.mechanism_of_action) {
    items.push({
      title: "Mechanism of action",
      subtitle: spec.mechanism_of_action,
    });
  }
  for (const c of spec.system_components ?? []) {
    items.push({ title: c.name, subtitle: `${c.category} — ${c.detail}` });
  }
  for (const s of spec.runtime_flow ?? []) {
    const io = [
      s.consumes?.length ? `in: ${s.consumes.join(", ")}` : "",
      s.produces?.length ? `out: ${s.produces.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    items.push({
      title: s.step,
      subtitle: [s.component, s.data, io].filter(Boolean).join(" · "),
    });
  }
  return items.slice(0, 10);
}

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
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
    const spec = await enrichMechanismSpec(input);
    if (!spec) return NextResponse.json({ items: [] });
    return NextResponse.json({ items: flattenSpec(spec) });
  } catch (err) {
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
