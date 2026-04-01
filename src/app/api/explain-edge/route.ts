import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmGenerate } from "@/lib/llm";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { edgeId, sourceName, targetName, relationshipType, dimension, spaceContext } = body;

  if (!sourceName || !targetName || !relationshipType) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    const explanation = await llmGenerate({
      system: `You explain relationships between concepts in a knowledge graph. Give a clear, specific 1-2 sentence explanation of WHY this relationship exists. Be concrete — reference the actual concepts, not abstract patterns. Write as a knowledgeable analyst, not a system.`,
      user: `In the context of: "${spaceContext}"

Explain why "${sourceName}" ${relationshipType} "${targetName}" (${dimension} relationship).

Give a 1-2 sentence explanation of the mechanism — HOW and WHY this connection exists.`,
      maxTokens: 200,
      temperature: 0.3,
      model: "gpt-4o-mini", // cheap for short explanations
    });

    // Cache the explanation on the edge record
    if (edgeId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("edges")
        .update({ conditions: explanation.trim() })
        .eq("id", edgeId);
    }

    return NextResponse.json({ explanation: explanation.trim() });
  } catch (err) {
    console.error("Edge explanation error:", err);
    return NextResponse.json(
      { error: "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
