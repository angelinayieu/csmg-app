import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";
import { safeJsonParse } from "@/lib/api-helpers";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError || !body) {
    return NextResponse.json({ error: parseError ?? "Invalid JSON" }, { status: 400 });
  }
  const { text } = body;
  if (!text || text.length < 20) {
    return NextResponse.json({ error: "Text too short" }, { status: 400 });
  }

  // For short inputs, skip scope mapping
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

    const elapsed = Date.now() - startTime;
    
    return NextResponse.json({
      ...scope,
      _timing: { scopeMapMs: elapsed }
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[Scope] Failed after ${elapsed}ms:`, err);
    return NextResponse.json(
      { error: "Scope mapping failed", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
