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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { text } = await request.json();
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
    const scope = await llmJSON<ScopeResult>({
      system: `You are mapping the analytical scope of a complex input. Identify 3-6 distinct analytical areas that together cover the COMPLETE scope. Each area should be a self-contained domain.

Rules:
- Every concept in the input must belong to at least one area
- Areas should be roughly equal in complexity
- Name areas by WHAT THEY CONTAIN, not analytical category (e.g., "The product" not "Technical analysis")
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
      user: text,
      maxTokens: 2000,
      temperature: 0.3,
      model: "gpt-4o-mini",
    });

    return NextResponse.json(scope);
  } catch (err) {
    console.error("Scope mapping error:", err);
    return NextResponse.json(
      { error: "Scope mapping failed" },
      { status: 500 }
    );
  }
}
