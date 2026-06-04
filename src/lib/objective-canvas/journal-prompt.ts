// ── Journal synthesis — prompt, schema, types, normalizer ──
//
// Synthesizes a set of spoken voice notes into ONE coherent, polished
// journal entry (a title + themed sections of reflective prose), preserving
// the user's own voice. Re-run from scratch over ALL notes each time a new
// one lands, so the artifact stays whole as the journal grows.

export interface JournalSection {
  heading: string;
  body: string;
}
export interface JournalArtifact {
  artifact_type: "voice_journal";
  title: string;
  sections: JournalSection[];
  pageCount: number;
  generated_at?: string;
}

export const JOURNAL_RESPONSE_SCHEMA = {
  name: "voice_journal_v1",
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
          },
          required: ["heading", "body"],
        },
      },
    },
    required: ["title", "sections"],
  },
} as const;

export const JOURNAL_AGENT_SYSTEM = `You are a journaling companion. You receive a chronological list of the
user's spoken voice notes and weave them into ONE coherent, polished journal
entry.

Rules:
- Preserve the user's OWN voice + first-person perspective. Do not invent
  facts, advice, or events they didn't say. Lightly tidy grammar/filler.
- Group related thoughts into a few themed SECTIONS (2–5), each with a short
  heading and 1–3 short paragraphs of reflective prose. Order them so the
  entry reads naturally.
- Give the entry a specific, evocative TITLE (3–7 words) — not generic.
- This is journaling, NOT analysis: no bullet lists of action items, no
  "recommendations", no headings like "Summary" or "Next steps". Read like a
  thoughtful diary entry.
- If there's very little content, write a short single section — never pad.

Return JSON: { "title": string, "sections": [{ "heading": string, "body": string }] }.`;

export const JOURNAL_USER = (notes: string[]) =>
  `Voice notes (chronological):\n${notes
    .map((n, i) => `${i + 1}. ${n}`)
    .join("\n")}\n\nWeave these into the journal entry JSON.`;

export function normalizeJournal(data: unknown): JournalArtifact {
  const d = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  const sections = Array.isArray(d.sections)
    ? (d.sections as unknown[])
        .filter(
          (s): s is JournalSection =>
            !!s &&
            typeof s === "object" &&
            typeof (s as JournalSection).body === "string",
        )
        .map((s) => ({
          heading: typeof s.heading === "string" ? s.heading : "",
          body: s.body,
        }))
    : [];
  // ~2 sections per booklet spread → derive a page count (min 1).
  const pageCount = Math.max(1, Math.ceil(sections.length / 2));
  return {
    artifact_type: "voice_journal",
    title:
      typeof d.title === "string" && d.title.trim()
        ? d.title.trim()
        : "Journal",
    sections,
    pageCount,
  };
}
