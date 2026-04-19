"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import type { ClusterNudge } from "./use-cluster-nudges";
import type { StickyNoteShape } from "../shapes/types";
import { useValue } from "tldraw";

// Phase 6.1 + 8.1 — Auto-decompose with a unified queue.
//
// When Auto-AI is on, the canvas has TWO natural auto-decompose targets:
//   (1) Stickies the user has written into and left idle — materialize
//       them into a real KG node without requiring a button click.
//   (2) Under-decomposed hubs already on the canvas — fire the nudge
//       handler against them.
//
// Stickies take priority because they represent active thinking. Hubs
// are backfill. Only one target fires per cycle, with a cooldown so we
// don't spam the LLM.

export type AutoDecomposeState = "off" | "watching" | "running" | "cooldown";

export interface UseAutoDecomposeOptions {
  editor: Editor | null;
  enabled: boolean;
  nudges: ClusterNudge[];
  /** Fire a decompose against an under-decomposed hub. */
  fireHub: (nudge: ClusterNudge) => Promise<void>;
  /** Fire a materialize against an idle sticky. */
  fireSticky: (shape: StickyNoteShape) => Promise<void>;
  idleMs?: number;
  cooldownMs?: number;
  /** Min chars in a sticky before we consider auto-firing. */
  stickyMinChars?: number;
}

const DEFAULT_IDLE_MS = 3000;
const DEFAULT_COOLDOWN_MS = 8000;
const DEFAULT_STICKY_MIN_CHARS = 12;

export function useAutoDecompose({
  editor,
  enabled,
  nudges,
  fireHub,
  fireSticky,
  idleMs = DEFAULT_IDLE_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  stickyMinChars = DEFAULT_STICKY_MIN_CHARS,
}: UseAutoDecomposeOptions): {
  state: AutoDecomposeState;
  lastTargetName: string | null;
} {
  const [state, setState] = useState<AutoDecomposeState>("off");
  const [lastTargetName, setLastTargetName] = useState<string | null>(null);

  const lastActivityRef = useRef(Date.now());
  const cooldownUntilRef = useRef(0);
  const inflightRef = useRef(false);
  // Hub dedup (per session)
  const firedHubs = useRef(new Set<string>());
  // Sticky dedup (per shape id — once materialized, we mark the sticky
  // with entityId=<uuid> so the candidate scan below naturally skips it).
  const firedStickies = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) {
      setState("off");
      firedHubs.current.clear();
      firedStickies.current.clear();
    } else {
      setState("watching");
    }
  }, [enabled]);

  // Activity tracking
  useEffect(() => {
    if (!editor) return;
    const unsub = editor.store.listen(
      () => {
        lastActivityRef.current = Date.now();
      },
      { scope: "document", source: "user" },
    );
    return unsub;
  }, [editor]);

  // Reactive scan: stickies with enough text AND no linked entity yet.
  // Uses tldraw's reactive useValue so the target set refreshes whenever
  // any sticky is edited.
  const candidateStickies = useValue<StickyNoteShape[]>(
    "auto-decompose: candidate stickies",
    () => {
      if (!editor || !enabled) return [];
      const out: StickyNoteShape[] = [];
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type !== "sticky-note") continue;
        const sn = s as StickyNoteShape;
        const text = sn.props.text?.trim() ?? "";
        if (text.length < stickyMinChars) continue;
        if (sn.props.entityId) continue; // already materialized
        if (firedStickies.current.has(sn.id as string)) continue;
        out.push(sn);
      }
      return out;
    },
    [editor, enabled, stickyMinChars],
  );

  // Polling loop
  useEffect(() => {
    if (!enabled || !editor) return;

    const tick = setInterval(async () => {
      const now = Date.now();
      if (inflightRef.current) return;
      if (now < cooldownUntilRef.current) {
        setState("cooldown");
        return;
      }
      if (now - lastActivityRef.current < idleMs) {
        setState("watching");
        return;
      }

      // Priority 1: idle stickies. They represent active thinking.
      const targetSticky = candidateStickies[0];
      if (targetSticky) {
        firedStickies.current.add(targetSticky.id as string);
        setState("running");
        setLastTargetName(
          targetSticky.props.text.slice(0, 48) +
            (targetSticky.props.text.length > 48 ? "…" : ""),
        );
        inflightRef.current = true;
        try {
          await fireSticky(targetSticky);
        } catch (err) {
          console.warn("[auto-decompose:sticky] failed", err);
        } finally {
          inflightRef.current = false;
          cooldownUntilRef.current = Date.now() + cooldownMs;
          setState("cooldown");
        }
        return;
      }

      // Priority 2: under-decomposed hubs
      const targetHub = nudges.find((n) => !firedHubs.current.has(n.entityId));
      if (!targetHub) {
        setState("watching");
        return;
      }

      firedHubs.current.add(targetHub.entityId);
      setState("running");
      setLastTargetName(targetHub.name);
      inflightRef.current = true;
      try {
        await fireHub(targetHub);
      } catch (err) {
        console.warn("[auto-decompose:hub] failed", err);
      } finally {
        inflightRef.current = false;
        cooldownUntilRef.current = Date.now() + cooldownMs;
        setState("cooldown");
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [editor, enabled, nudges, candidateStickies, fireHub, fireSticky, idleMs, cooldownMs]);

  return { state, lastTargetName };
}
