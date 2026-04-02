import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";

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
  try {
    const body = await request.json();
    text = body?.text;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!text || typeof text !== "string" || text.length < 20) {
    return NextResponse.json(
      { error: "Text too short (minimum 20 characters)" },
      { status: 400 }
    );
  }

  // 3. For short inputs, skip LLM scope mapping
  if (text.length < 400) {
    return NextResponse.json({
      spaces: [
        {
          name: "Analysis",
          prefix: "C",
          description: "Complete analysis of the input",
          key_concepts: [],
          priority: 1,
        },
      ],
      summary: text.slice(0, 200),
      skipped: true,
    });
  }

  // 4. LLM-based scope mapping
  try {
    // Truncate very long texts to reduce LLM processing time
    const inputForLLM = text.length > 8000 ? text.slice(0, 8000) + "\n[...text truncated...]" : text;

    const scope = await llmJSON<ScopeResult>({
      system: `You are mapping the analytical scope of a complex input. Identify 3-4 distinct analytical areas (not more) that together cover the COMPLETE scope. Each area should be a self-contained domain. PRIORITIZE SPEED — favor broad areas over fine-grained ones.

Rules:
- Every concept in the input must belong to at least one area
- Areas should be roughly equal in complexity
- Name areas by WHAT THEY CONTAIN, not analytical category (e.g., "The product" not "Technical analysis")
- Return 3-4 areas max to save time
- Include a priority order

Return ONLY valid JSON:
{
  "spaces": [
    {
      "name": "string (2-4 words)",
      "prefix": "A",
      "description": "string (one sentence)",
      "key_concepts": ["concept1", "concept2"],
      "priority": 1
    }
  ],
  "summary": "One sentence describing the overall situation"
}`,
      user: inputForLLM,
      maxTokens: 1500,
      temperature: 0.2,
      model: "gpt-4o-mini",
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
    const details = err instanceof Error ? err.message : String(err);
    console.error(`[Scope] Failed after ${elapsed}ms:`, details);
    return NextResponse.json(
      { error: `Scope mapping failed: ${details}` },
      { status: 500 }
    );
  }
}
