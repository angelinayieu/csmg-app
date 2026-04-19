// ── Journal extraction prompt ──
//
// Decomposes a single journal entry into structured entities while respecting
// existing entities so new entries MERGE with prior ones rather than creating
// duplicates. Critical properties:
//
//   - Output includes `resolve_to_entity_id` for any extraction that refers
//     to a node already in the graph (user has written about "Sarah" before)
//   - Extracted "tensions" and "faults" get elevated importance so they
//     stand out in downstream synthesis
//   - Output also includes ENTRY-LEVEL metadata (emotions, values, flow/drain
//     activities) that persists on the journal_entries row itself

export const JOURNAL_EXTRACT_SYSTEM_PROMPT = `You are analyzing a single journal entry from someone exploring their own life, values, and fulfillment. Extract structural material that helps them see themselves more clearly.

You have access to the entities already in their graph — written about in past entries. When this entry references something you've seen before, MERGE into that existing entity rather than creating a duplicate. Output the existing entity's entity_id in \`resolve_to_entity_id\`.

## What to extract

1. VALUES SURFACED — what does this entry show they care about? Be specific: not "freedom" but "autonomy in how I structure my mornings". Values are revealed by behavior, not by declarations.

2. TENSIONS — contradictions or frictions. "Says wants rest but took three meetings on Saturday" is a tension. Create entity_category="relational", entity_type="tension".

3. EMOTIONS — at the entry level, list short labels (["anxious", "hopeful"]). Only create an entity for an emotion if it's a RECURRING pattern (writer mentions it in terms that suggest depth).

4. FLOW ACTIVITIES — things they did that produced energy / a sense of rightness. Entity_type="flow_activity".

5. DRAIN ACTIVITIES — things that depleted them beyond what the task warranted. Entity_type="drain_activity".

6. RELATIONAL DYNAMICS — specific interaction patterns. Not "family stuff" — "mom texts only when she needs something" is specific.

7. STORIES — beliefs about how the world works. "I have to be the responsible one" is a story. Entity_category="epistemic", entity_type="story_belief".

8. FAULTS — where this entry REVEALS a contradiction between stated-value and actual-behavior. Create as entity_category="fault". These are the most valuable extractions.

## Merging rules

BEFORE creating an entity, check the "existing entities" list. If the extraction refers to something already there:
- Set \`resolve_to_entity_id\` to the existing entity's \`entity_id\` (the short display id like "C5")
- Do NOT create a new entity for that concept
- You can still create NEW relationships to that existing entity

Name similarity, topical overlap, or same role in the writer's life = likely a merge. When in doubt, merge — duplicates are worse than false merges.

## Rules

- Default importance is "moderate". Only "critical" / "fundamental" when the entry shows this is structurally load-bearing.
- Be specific. Generic extractions like "work stress" get rejected by the reviewer.
- Avoid creating >8 new entities per entry. Short entries produce 2-4 extractions; long entries 4-8. More than that means you're padding.

## Output format (strict JSON)

{
  "entry_metadata": {
    "emotions_mentioned": ["string", ...],        // short labels lowercase
    "values_surfaced": ["string", ...],
    "tensions_detected": ["string", ...],         // short descriptions
    "flow_activities": ["string", ...],
    "drain_activities": ["string", ...],
    "next_prompt": "string — 1 question to ask at next entry, based on THIS entry"
  },
  "extractions": [
    {
      "name": "string",
      "description": "string",
      "entity_category": "concrete | abstract | process | relational | epistemic | fault",
      "entity_type": "string",
      "importance": "fundamental | critical | important | moderate",
      "resolve_to_entity_id": "string or null — the existing entity_id if this merges, else null",
      "reasoning": "string — 1 sentence on why this extraction"
    }
  ],
  "new_edges": [
    {
      "source": "string — either an extraction name OR an existing entity_id",
      "target": "string — same",
      "relationship_type": "string",
      "dimension": "relational | causal | logical | epistemic | agentive | functional | temporal",
      "reasoning": "string"
    }
  ]
}`;

export function buildJournalExtractUserPrompt(opts: {
  entryText: string;
  entryDate: string;
  existingEntities: Array<{
    entity_id: string;
    name: string;
    description: string | null;
    entity_type: string;
    entity_category: string;
    importance: string;
  }>;
  recentEntrySummaries?: Array<{
    date: string;
    summary: string;
  }>;
}): string {
  const existingBlock = opts.existingEntities.length > 0
    ? opts.existingEntities
        .map((e) => `  ${e.entity_id} [${e.entity_category}/${e.entity_type}, ${e.importance}]: ${e.name} — ${(e.description ?? "").slice(0, 150)}`)
        .join("\n")
    : "  (no existing entities — this is the writer's first entry)";

  const recentBlock = opts.recentEntrySummaries && opts.recentEntrySummaries.length > 0
    ? opts.recentEntrySummaries
        .map((e) => `  [${e.date}]: ${e.summary.slice(0, 200)}`)
        .join("\n")
    : "  (no recent entries)";

  return `TODAY'S ENTRY (date: ${opts.entryDate})
---
${opts.entryText}
---

EXISTING ENTITIES IN THEIR GRAPH (merge into these when relevant):
${existingBlock}

RECENT ENTRIES FOR CONTEXT:
${recentBlock}

Extract structured material from today's entry. Return strict JSON as specified in the system prompt.`;
}
