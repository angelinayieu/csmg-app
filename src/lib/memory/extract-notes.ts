/**
 * Walk a tldraw document snapshot and pull out every sticky-note-shaped
 * record as `{ note_id, text, updated_at? }`. Reuses the defensive walk
 * pattern from prune-spans.ts — handles both snapshot.store and
 * snapshot.document.store layouts that tldraw has used across versions.
 *
 * A "note" here means any shape whose record carries a usable text field.
 * We match defensively:
 *   - type === 'note' (tldraw default sticky note)
 *   - type === 'sticky-note'
 *   - type === 'kg-note' (custom shape in this repo)
 *   - any shape whose props contains a string `text`
 *
 * This is the text source the memory writer embeds under kind='note'
 * and the ProposalRail (Sprint 3) anchors character offsets into.
 */

export interface ExtractedNote {
  note_id: string;        // tldraw shape id, e.g. "shape:abc123"
  text: string;
  type: string | null;    // original shape type, for debugging
}

export function extractNotesFromSnapshot(snapshot: unknown): ExtractedNote[] {
  const out: ExtractedNote[] = [];
  if (!snapshot || typeof snapshot !== "object") return out;

  const snap = snapshot as Record<string, unknown>;
  const roots: Array<Record<string, unknown>> = [];
  if (snap.store && typeof snap.store === "object") {
    roots.push(snap.store as Record<string, unknown>);
  }
  const doc = snap.document;
  if (
    doc &&
    typeof doc === "object" &&
    (doc as Record<string, unknown>).store &&
    typeof (doc as Record<string, unknown>).store === "object"
  ) {
    roots.push((doc as Record<string, unknown>).store as Record<string, unknown>);
  }

  const seen = new Set<string>();

  for (const store of roots) {
    for (const key of Object.keys(store)) {
      if (!key.startsWith("shape:")) continue;
      const rec = store[key];
      if (!rec || typeof rec !== "object") continue;

      const r = rec as Record<string, unknown>;
      const idRaw = r.id;
      const id = typeof idRaw === "string" ? idRaw : key;
      if (seen.has(id)) continue;

      const type = typeof r.type === "string" ? (r.type as string) : null;
      const props = (r.props && typeof r.props === "object"
        ? (r.props as Record<string, unknown>)
        : null);

      // Extract text defensively — tldraw's note shape stores plain text
      // under props.text, but custom shapes may put it under props.body
      // or props.content. We check all three.
      let text: string | null = null;
      if (props) {
        const candidate = props.text ?? props.body ?? props.content;
        if (typeof candidate === "string") {
          text = candidate;
        } else if (
          candidate &&
          typeof candidate === "object" &&
          typeof (candidate as Record<string, unknown>).text === "string"
        ) {
          // Some rich-text variants nest { text: '...', richText?: ... }
          text = (candidate as Record<string, string>).text;
        }
      }

      if (!text) continue;
      const trimmed = text.trim();
      if (trimmed.length === 0) continue;

      // Only include shapes that look like note-kind. If type is unknown
      // but has text, we still include — better to over-index than miss
      // user content.
      const isNoteLike =
        type === null ||
        type === "note" ||
        type === "sticky-note" ||
        type === "kg-note" ||
        type === "text";
      if (!isNoteLike) continue;

      seen.add(id);
      out.push({ note_id: id, text: trimmed, type });
    }
  }

  return out;
}
