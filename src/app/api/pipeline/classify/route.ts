import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyInput } from "@/lib/pipeline/epistemic-classifier";
import { sanitizeErrorMessage } from "@/lib/api-helpers";
import type { UserIntent } from "@/types/analysis";

export const maxDuration = 30;

export async function POST(request: Request) {
  const startTime = Date.now();

  // 1. Auth check
  let user;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (authErr) {
    console.error("[Classify] Auth error:", authErr);
    return NextResponse.json(
      { error: "Authentication failed", details: String(authErr) },
      { status: 500 }
    );
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let text: string;
  let intent: UserIntent | undefined;
  let scopeResult: { spaces: Array<{ name: string; description: string; key_concepts: string[] }>; summary: string } | undefined;
  try {
    const body = await request.json();
    text = body?.text;
    intent = body?.intent;
    scopeResult = body?.scopeResult;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!text || typeof text !== "string" || text.length < 20) {
    return NextResponse.json(
      { error: "Text too short for classification (minimum 20 characters)" },
      { status: 400 }
    );
  }

  // 3. Run epistemic classification
  try {
    const classification = await classifyInput({
      text,
      intent,
      scopeSummary: scopeResult?.summary,
      scopeSpaces: scopeResult?.spaces,
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `[Classify] ${classification.input_type} (${(classification.input_type_confidence * 100).toFixed(0)}%) | ` +
      `Cynefin: ${classification.cynefin_domain} | Pearl: ${classification.causal_depth} | ` +
      `Toulmin: ${classification.toulmin.has_argument ? `${classification.toulmin.claim_count} claims` : "no argument"} | ` +
      `Objectives: ${classification.preliminary_objectives.length} | ${elapsed}ms`
    );

    return NextResponse.json(classification);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[Classify] Failed after ${elapsed}ms:`, raw);
    return NextResponse.json(
      { error: `Classification failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 }
    );
  }
}
