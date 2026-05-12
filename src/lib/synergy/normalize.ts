// ── Synergy text normalization helpers ──
//
// Used by the history-bucket dedup ("did the user already add this
// suggestion?") and the AI augment context builder (board labels
// passed to the LLM are case/space-normalized so the prompt's dedup
// rule isn't tripped by trivial casing differences).

import type { HistoryBucket } from "./types";

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeKey(bucket: HistoryBucket, text: string): string {
  return `${bucket}:${normalizeText(text)}`;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
