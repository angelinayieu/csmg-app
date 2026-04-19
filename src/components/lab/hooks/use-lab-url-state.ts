"use client";

// Phase 27 — URL-sync lab state.
//
// The Node / Space / Universal lab pages each track two pieces of
// ephemeral state that users want to *share* or *re-enter*:
//   - focusedReactionId   → which reaction the footer network has open
//   - selectedSubunitId   → which subunit the Control Panel is tuning
//
// Sharable means they need to round-trip through the URL. This hook
// wraps useSearchParams + router.replace so every orchestrator gets the
// same behavior with two lines of wiring.
//
// Design notes:
//   - `replace`, not `push` — we don't want back-button to re-traverse
//     every hover state change.
//   - We read once on mount for the initial value. If the user manually
//     edits the URL (or navigates via a shared link), that wins. After
//     mount, the hook is the source of truth and writes to the URL.
//   - Keys stay short (`rxn`, `tune`) to keep shared URLs readable.
//   - Value-less (null) → the key is stripped from the URL, not left as
//     `?rxn=`. This keeps URLs tidy when the user clears selection.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface LabUrlState {
  focusedReactionId: string | null;
  setFocusedReactionId: (id: string | null) => void;
  selectedSubunitId: string | null;
  setSelectedSubunitId: (id: string | null) => void;
}

export function useLabUrlState(): LabUrlState {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial values from the URL. Captured once on first render so
  // later writes don't rebuild this hook's state — we own it after mount.
  const initialRxn = searchParams.get("rxn");
  const initialTune = searchParams.get("tune");

  const [focusedReactionId, _setFocusedReactionId] = useState<string | null>(
    initialRxn,
  );
  const [selectedSubunitId, _setSelectedSubunitId] = useState<string | null>(
    initialTune,
  );

  // Track the last URL we wrote so external navigation (e.g. next/link)
  // doesn't trip us into an update loop.
  const lastWrittenRef = useRef<string | null>(null);

  const writeUrl = useCallback(
    (rxn: string | null, tune: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (rxn) params.set("rxn", rxn);
      else params.delete("rxn");
      if (tune) params.set("tune", tune);
      else params.delete("tune");
      const qs = params.toString();
      const path = window.location.pathname;
      const next = qs ? `${path}?${qs}` : path;
      if (lastWrittenRef.current === next) return;
      lastWrittenRef.current = next;
      router.replace(next, { scroll: false });
    },
    [router, searchParams],
  );

  const setFocusedReactionId = useCallback(
    (id: string | null) => {
      _setFocusedReactionId(id);
      writeUrl(id, selectedSubunitId);
    },
    [writeUrl, selectedSubunitId],
  );

  const setSelectedSubunitId = useCallback(
    (id: string | null) => {
      _setSelectedSubunitId(id);
      writeUrl(focusedReactionId, id);
    },
    [writeUrl, focusedReactionId],
  );

  // Keep state synced if the URL changes underneath us (e.g. back/forward
  // navigation or a shared link opened in the current tab). Guarded by
  // `lastWrittenRef` so our own writes don't feed back in.
  useEffect(() => {
    const rxn = searchParams.get("rxn");
    const tune = searchParams.get("tune");
    _setFocusedReactionId((cur) => (cur === rxn ? cur : rxn));
    _setSelectedSubunitId((cur) => (cur === tune ? cur : tune));
  }, [searchParams]);

  return {
    focusedReactionId,
    setFocusedReactionId,
    selectedSubunitId,
    setSelectedSubunitId,
  };
}
