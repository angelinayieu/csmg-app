"use client";

// ── Annotations visibility — global UI preference ─────────────────
//
// App-wide on/off switch for inline annotation MARKS: the phrase-scope
// dotted underlines, the word-scope pill highlights, and the glossary
// underlines. When OFF, every annotated-text renderer falls back to
// plain text — the underlying annotation DATA is untouched; only the
// visual marks (and their hover popovers) hide. This is the "clean
// reading mode" switch.
//
// Why an external store instead of useLocalPref: the floating toggle and
// the many mark-render sites (Core Objective card, room title/definition
// headings, glossary text) live in unrelated subtrees. They must react
// to each other INSTANTLY. useSyncExternalStore gives one shared source
// of truth with no Provider to thread through the (parallel-edited)
// objective layout. localStorage-backed so the choice survives reloads
// and route changes. Global (not per-space) — it's a reading preference,
// not a per-document setting.

import { useSyncExternalStore } from "react";

const KEY = "oc:annotations-visible";

let visible = true; // default ON — matches today's behavior
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Read the persisted choice once, on the first client subscription.
 *  Deferred (not at module load) so SSR + first paint render with the
 *  default (true), matching getServerSnapshot and avoiding a hydration
 *  mismatch; if the stored value differs, the emit() schedules a single
 *  client re-render. */
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === "0" || raw === "false") {
      visible = false;
      emit();
    }
  } catch {
    // storage unavailable (private mode / quota) — keep default
  }
}

function subscribe(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return visible;
}

function getServerSnapshot(): boolean {
  return true;
}

export function setAnnotationsVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // soft-fail — session-only state still works
  }
  emit();
}

export function toggleAnnotationsVisible(): void {
  setAnnotationsVisible(!visible);
}

/** Subscribe to the global annotation-marks visibility flag. */
export function useAnnotationsVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
