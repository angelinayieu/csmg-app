"use client";

// ── Voice analysis controller (Live analysis mode) ──
//
// Turns finished spoken sentences into high-quality cards WITHOUT flooding
// the board. The quality levers (the genuinely hard part):
//   • Gate    — skip utterances below a length threshold (filler).
//   • Debounce + batch — buffer sentences, analyze only after ~2s of silence,
//                 so a whole thought becomes ONE analysis (not per fragment).
//   • Cap     — at most N cards per batch.
//   • Dedup   — skip titles we've already surfaced this session.
// Reuses the existing /api/canvas/converge-diverge pipeline; results land as
// artifact cards via the board-bus deploy event.

import { deployArtifactCard } from "@/components/objective/board-bus";

const MIN_CHARS = 18;
const DEBOUNCE_MS = 1800;
const MAX_CARDS_PER_BATCH = 3;

const recentTitles = new Set<string>();

interface Buffer {
  sentences: string[];
  timer: ReturnType<typeof setTimeout> | null;
}
const buffers = new Map<string, Buffer>();

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Called per finished sentence while Live analysis is on. */
export function handleVoiceSentence(spaceId: string, sentence: string): void {
  const clean = sentence.trim();
  if (clean.length < MIN_CHARS) return; // gate filler
  let buf = buffers.get(spaceId);
  if (!buf) {
    buf = { sentences: [], timer: null };
    buffers.set(spaceId, buf);
  }
  buf.sentences.push(clean);
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => void flush(spaceId), DEBOUNCE_MS);
}

async function flush(spaceId: string): Promise<void> {
  const buf = buffers.get(spaceId);
  if (!buf || buf.sentences.length === 0) return;
  const text = buf.sentences.join(" ").trim();
  buf.sentences = [];
  buf.timer = null;
  if (text.length < MIN_CHARS) return;

  try {
    const res = await fetch("/api/canvas/converge-diverge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, kind: "diverge", questionCount: 3, depth: 3 }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      items?: Array<{ title?: string; subtitle?: string }>;
    };
    const items = Array.isArray(json.items) ? json.items : [];
    let added = 0;
    for (const it of items) {
      if (added >= MAX_CARDS_PER_BATCH) break;
      const title = (it.title ?? "").trim();
      if (!title) continue;
      const key = norm(title);
      if (!key || recentTitles.has(key)) continue; // dedup
      recentTitles.add(key);
      deployArtifactCard({
        kind: "lab",
        entityId: `voice-${Date.now()}-${added}`,
        title,
        subtitle: it.subtitle,
        color: "#6366F1",
        roomId: "",
      });
      added += 1;
    }
  } catch {
    /* soft-fail — live analysis never blocks recording */
  }
}
