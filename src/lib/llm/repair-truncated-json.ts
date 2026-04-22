// ── Truncated JSON repair ──
//
// Why this exists: GPT-4o's hard 16384-token output cap is often hit
// when we ask for a fully-enriched decomposition JSON (20-50 entities
// × many fields each). The response arrives as ~67K chars with the
// JSON structurally unclosed: `{"entities":[{"…","…"},{"…","…"},{"na`
// — mid-array, mid-string, or mid-object. Standard JSON.parse throws,
// which previously forced us to the empty fallback, losing EVERY
// partial entity the LLM actually got out.
//
// This module salvages the parseable prefix. It walks the string
// character-by-character, tracks bracket/quote state, trims at the
// last fully-balanced boundary, appends closing brackets to repair
// the structural frame, and re-parses. If the last truncated entity
// was incomplete, it's dropped — but the 15-40 entities before it
// survive.
//
// This is a best-effort recovery, not a guarantee. Caller must still
// have a fallback for the case where even the repaired slice doesn't
// parse (extreme corruption, truncation before first object).

export interface RepairResult {
  parsed: unknown | null;
  droppedTail: boolean;
  repairedChars: number;
}

/**
 * Attempt to salvage partial JSON from a truncated LLM response.
 *
 * Strategy:
 *   1. Walk forward, tracking string/escape state (don't react to
 *      brackets inside string literals).
 *   2. Record the last position where structural brackets were
 *      balanced IF the character at that position was a valid
 *      terminator of a complete value (`}`, `]`, or comma).
 *   3. Trim the input to that position, strip any trailing comma,
 *      and append the closing brackets needed to balance open
 *      frames.
 *   4. Try JSON.parse. Success → return parsed object with
 *      droppedTail=true so callers can log the loss.
 */
export function repairTruncatedJson(raw: string): RepairResult {
  if (!raw || raw.length === 0) {
    return { parsed: null, droppedTail: false, repairedChars: 0 };
  }

  // First try: maybe it parses cleanly already.
  try {
    return { parsed: JSON.parse(raw), droppedTail: false, repairedChars: 0 };
  } catch {
    // Fall through to repair path.
  }

  // Extract substring from first `{` to end — strip any prefix like
  // markdown fences or explanatory prose the LLM might have emitted.
  const startIdx = raw.indexOf("{");
  if (startIdx === -1) {
    return { parsed: null, droppedTail: false, repairedChars: 0 };
  }
  const work = raw.slice(startIdx);

  // Walk forward tracking state. At each point where depth returns to
  // 0 AND we see a structural-terminator char (`,`, `]`, or `}`),
  // record the position as a safe trim candidate. If we crash mid-
  // string, the last candidate is where we rewind to.
  let inString = false;
  let escapeNext = false;
  const stack: Array<"{" | "["> = [];
  let lastSafePos = -1;
  let lastSafeDepth = 0;

  for (let i = 0; i < work.length; i++) {
    const ch = work[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      stack.push("{");
      continue;
    }
    if (ch === "[") {
      stack.push("[");
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      // A closed object/array at depth N is a safe trim candidate —
      // everything up to and including this char is a complete value
      // that the parser can handle if we close the outer frame.
      lastSafePos = i;
      lastSafeDepth = stack.length;
      continue;
    }
    if (ch === ",") {
      // A top-of-container comma is also safe; trim HERE and we
      // lose only the element that was mid-write.
      lastSafePos = i - 1; // drop the comma itself
      lastSafeDepth = stack.length;
      continue;
    }
  }

  if (lastSafePos < 0) {
    // Nothing parseable survived.
    return { parsed: null, droppedTail: true, repairedChars: 0 };
  }

  // Trim and close. Build the closing sequence by popping the stack
  // to the depth we were at when we hit the last safe position.
  // Everything still open needs a closer.
  let trimmed = work.slice(0, lastSafePos + 1);
  // Remove trailing commas the trim may have left behind.
  trimmed = trimmed.replace(/,\s*$/, "");

  // The stack at lastSafePos had depth `lastSafeDepth`. We need to
  // close that many open frames. We pushed "{" or "[" onto `stack`
  // in order; the frames still open at lastSafePos are the ones
  // that hadn't been popped by then. Since we didn't track depth
  // history per char, we re-walk the TRIMMED string to compute
  // which closers are needed.
  const needed: string[] = [];
  {
    let s = false;
    let esc = false;
    const st: string[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (s) {
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') s = false;
        continue;
      }
      if (ch === '"') {
        s = true;
        continue;
      }
      if (ch === "{") st.push("}");
      else if (ch === "[") st.push("]");
      else if (ch === "}" || ch === "]") st.pop();
    }
    while (st.length > 0) needed.push(st.pop()!);
  }

  const repaired = trimmed + needed.join("");
  try {
    const parsed = JSON.parse(repaired);
    return {
      parsed,
      droppedTail: true,
      repairedChars: work.length - trimmed.length,
    };
  } catch {
    return { parsed: null, droppedTail: true, repairedChars: 0 };
  }
}
