"use client";

// ── ResolutionStudioMount ──
//
// Headless. Mounted once at the objective layout level. Listens for the
// OPEN_RESOLUTION_STUDIO event (fired by the Prompt Sharpening Card) and
// renders the immersive ResolutionStudio in a portal over the board (so it
// escapes tldraw's pan/zoom transform). AnimatePresence plays the modal's
// exit before unmount.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import {
  OPEN_RESOLUTION_STUDIO_EVENT,
  type ResolutionStudioDetail,
} from "@/components/objective/board-bus";
import { ResolutionStudio } from "./resolution-studio";

export function ResolutionStudioMount({ spaceId }: { spaceId: string }) {
  const [detail, setDetail] = useState<ResolutionStudioDetail | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<ResolutionStudioDetail>).detail;
      // Only respond to events for THIS board's space, with a non-empty deck.
      if (!d || d.spaceId !== spaceId || !d.concepts?.length) return;
      setDetail(d);
    }
    window.addEventListener(OPEN_RESOLUTION_STUDIO_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_RESOLUTION_STUDIO_EVENT, onOpen);
  }, [spaceId]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {detail && (
        <ResolutionStudio
          key={detail.spaceId + ":" + detail.concepts.length}
          detail={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </AnimatePresence>,
    document.body,
  );
}
