// ── Journal reflect endpoint ──
//
// POST /api/journal/reflect
//   body: { space_id, text }
//
// Lightweight as-you-type companion — fires on debounce (≥80 chars) while
// the user is writing. Returns 1-2 deepening questions + preliminary theme
// detection. Intentionally uses gpt-4o-mini (fast + cheap) since it fires
// frequently; the full extraction on submit uses the heavier model.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 20;

interface ReflectResponse {
  questions: string[];
  detected: {
    emotions: string[];
    values: string[];
    tensions: string[];
  };
}

const REFLECT_SYSTEM = `You are a thoughtful journaling companion reading someone's entry as they write. Your job:

1. Detect emerging themes from the partial text (emotions, values, tensions).
2. Write 1–2 deepening questions that will help them go further into what they just wrote.

Guidelines:
- Questions must be specific to what they've actually written — never generic.
- Tone: curious friend, not therapist. "What made that moment stick?" not "How did that make you feel?"
- Values: reveal what they care about based on behavior, not declarations.
- Tensions: contradictions between what they said they want vs what they're actually doing.
- Emotions: short lowercase labels only (["frustrated", "relieved"]).
- Max 2 questions. If the entry is very short or unclear, return 1.

Return strict JSON:
{
  "questions": ["string"],
  "detected": {
    "emotions": ["string"],
    "values": ["string"],
    "tensions": ["string"]
  }
}`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  let space_id: string;
  let text: string;

  try {
    const body = await request.json();
    space_id = body.space_id;
    text = body.text;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!space_id || !text || text.trim().length < 60) {
    return NextResponse.json({
      questions: [],
      detected: { emotions: [], values: [], tensions: [] },
    });
  }

  const isOwner = await verifySpaceOwnership(supabase, space_id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Last 3 entries give enough pattern context without burning tokens
  const { data: recent } = await db
    .from("journal_entries")
    .select("entry_date, values_surfaced, tensions_detected, emotions_mentioned")
    .eq("space_id", space_id)
    .order("entry_date", { ascending: false })
    .limit(3);

  const recentContext =
    (recent ?? []).length > 0
      ? (recent as Array<{
          entry_date: string;
          values_surfaced: string[];
          tensions_detected: string[];
          emotions_mentioned: string[];
        }>)
          .map(
            (r) =>
              `[${r.entry_date}] emotions: ${(r.emotions_mentioned ?? []).join(", ")} | values: ${(r.values_surfaced ?? []).join(", ")} | tensions: ${(r.tensions_detected ?? []).slice(0, 2).join("; ")}`,
          )
          .join("\n")
      : "(first entry — no prior context)";

  const result = await llmJSON<ReflectResponse>({
    system: REFLECT_SYSTEM,
    user: `PARTIAL ENTRY:\n${text.slice(0, 1400)}\n\nRECENT PATTERNS:\n${recentContext}`,
    maxTokens: 380,
    temperature: 0.55,
    model: "gpt-4o-mini",
    fallback: { questions: [], detected: { emotions: [], values: [], tensions: [] } },
  });

  return NextResponse.json(result);
}
