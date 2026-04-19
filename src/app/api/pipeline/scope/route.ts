import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";
import { sanitizeErrorMessage } from "@/lib/api-helpers";
import { buildScopeIntentBlock, buildDomainScopingBlock } from "@/lib/prompts/intent-context";
import type { UserIntent } from "@/types/analysis";

export const maxDuration = 30;

interface ScopeResult {
  spaces: Array<{
    name: string;
    prefix: string;
    description: string;
    key_concepts: string[];
    priority: number;
  }>;
  summary: string;
  detected_context?: string;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  // 1. Auth check
  let user;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (authErr) {
    console.error("[Scope] Auth error:", authErr);
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
  try {
    const body = await request.json();
    text = body?.text;
    intent = body?.intent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!text || typeof text !== "string" || text.length < 20) {
    return NextResponse.json(
      { error: "Text too short (minimum 20 characters)" },
      { status: 400 }
    );
  }

  // 3. LLM-based scope mapping (always run — even short inputs benefit from structured decomposition)
  try {
    // Truncate very long texts to reduce LLM processing time
    const inputForLLM = text.length > 8000 ? text.slice(0, 8000) + "\n[...text truncated...]" : text;

    // Build domain detection instruction if user hasn't specified context_type
    const needsDetection = !intent?.context_type;
    const detectionInstruction = needsDetection
      ? `\n\nCONTEXT DETECTION: The user has not specified their domain. Analyze the input and detect the context_type from: startup, research, career, strategy, operations, investment, education. Add "detected_context": "<type>" to your JSON output. Choose the SINGLE most fitting type based on the input's core subject matter.`
      : "";

    const domainLens = buildDomainScopingBlock(intent?.context_type ?? null);

    const scope = await llmJSON<ScopeResult>({
      system: `You are a strategic analyst decomposing a situation into distinct analytical spaces. Your job is to carve the input into 3-4 ORTHOGONAL domains that together cover the COMPLETE scope — but each space must be a genuinely different LENS on the situation, not a generic business category.

CRITICAL: Spaces must be SPECIFIC to THIS input, not generic templates.

BAD examples (too generic):
- "Market Strategy" / "Product Development" / "Team Building" / "Financial Planning"
- "Technical Analysis" / "Business Analysis" / "Risk Analysis"

GOOD examples (specific to an AI SaaS startup with no customers):
- "GPT-4 Response Quality vs Integration Speed" (the core product tradeoff)
- "Enterprise vs SMB Go-to-Market" (the strategic fork)
- "3-Person Team Capacity & 8-Month Runway" (the constraint landscape)

Rules:
- Each space name should contain SPECIFIC details from the input (names, numbers, technologies, tradeoffs mentioned)
- key_concepts must be pulled directly from the input, not invented
- Spaces should create TENSION between them — analyzing one should raise questions about another
- Prefer spaces organized around DECISIONS and TRADEOFFS in the input, not functional departments
- Return 3-4 spaces max
- Use sequential prefixes: A, B, C, D
${domainLens}${detectionInstruction}
Return ONLY valid JSON:
{
  "spaces": [
    {
      "name": "string (3-6 words, SPECIFIC to this input)",
      "prefix": "A",
      "description": "string (one sentence explaining what this space analyzes and WHY it matters)",
      "key_concepts": ["specific concept from input", "another specific concept"],
      "priority": 1
    }
  ],
  "summary": "One sentence capturing the core tension or decision in the input"${needsDetection ? ',\n  "detected_context": "startup | research | career | strategy | operations | investment | education"' : ""}
}${buildScopeIntentBlock(intent)}`,
      user: inputForLLM,
      maxTokens: 1500,
      temperature: 0.3,
      model: "gpt-4o",
    });

    // Validate the response has spaces
    if (!scope?.spaces?.length) {
      console.error("[Scope] LLM returned no spaces:", scope);
      return NextResponse.json(
        { error: "Scope mapping returned empty result. Try again or use Standard analysis." },
        { status: 500 }
      );
    }

    const elapsed = Date.now() - startTime;
    return NextResponse.json({
      ...scope,
      _timing: { scopeMapMs: elapsed },
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[Scope] Failed after ${elapsed}ms:`, raw);
    return NextResponse.json(
      { error: `Scope mapping failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 }
    );
  }
}
