"use client";

// ── IntakeHome ──
//
// Instant whiteboard intake. The REAL objective board (ObjectiveCanvasShell)
// is mounted UNDERNEATH the minimal home and pre-warms on page load (tldraw +
// board-subs + persistence). The home renders as an opaque overlay on top.
// The moment the user starts typing, we:
//   1. seed the board's chatbox card with the typed text (it auto-focuses), and
//   2. fade the home overlay away to reveal the already-ready board.
// No router.push, no route transition, no loading page — "we're already inside
// the whiteboard while typing." Submitting promotes the draft in place (the
// chatbox card → objective card) exactly as on the objective route.
//
// Falls back to the plain MinimalHome when there's no draft space (logged out
// / draft creation failed) — then the chatbox uses its legacy navigation.

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MinimalHome } from "./minimal-home";
import { seedChatboxCard } from "@/components/objective/board-bus";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { LibrarySpace } from "./library-grid";
import type { SyncedTab } from "./objective-chatbox";

// Board + headless mounts load client-side only (tldraw is browser-only) and
// AFTER the home paints, so the home stays instant while the board warms up.
const ObjectiveCanvasShell = dynamic(
  () =>
    import("@/components/objective/objective-canvas-shell").then(
      (m) => m.ObjectiveCanvasShell,
    ),
  { ssr: false },
);
const PromptSharpeningMount = dynamic(
  () =>
    import("@/components/objective/prompt-sharpening-mount").then(
      (m) => m.PromptSharpeningMount,
    ),
  { ssr: false },
);
const ObjectiveImageMount = dynamic(
  () =>
    import("@/components/objective/objective-image-mount").then(
      (m) => m.ObjectiveImageMount,
    ),
  { ssr: false },
);

interface Props {
  displayName: string;
  email: string;
  creditBalance: number;
  spaces: LibrarySpace[];
  syncedTabs: SyncedTab[];
  driveConnected: boolean;
  /** Hidden draft objective space — the board mounted under the home. */
  draftSpaceId?: string;
}

export function IntakeHome(props: Props) {
  const { draftSpaceId } = props;
  const [revealed, setRevealed] = useState(false);
  const startedRef = useRef(false);

  const handleStart = useCallback(
    (text: string) => {
      if (!draftSpaceId || startedRef.current) return;
      startedRef.current = true;

      // Seed the board's chatbox card with the typed text. The board is
      // already mounted; a few bounded retries cover the rare case where it's
      // still warming up when the user types (deployChatboxOnBoard is
      // idempotent, so extra dispatches no-op once the card exists).
      const seed = () => seedChatboxCard({ spaceId: draftSpaceId, seedText: text });
      seed();
      const timers = [300, 900, 1800].map((ms) => window.setTimeout(seed, ms));
      // Backup for a hard refresh mid-intake: the real /app/objective/[id]
      // route (seedOnLoad defaults true) re-seeds from this on reload.
      try {
        window.sessionStorage.setItem(`intake:seed:${draftSpaceId}`, text);
      } catch {
        /* sessionStorage unavailable */
      }

      // Reveal the board underneath (fade the home overlay out) and reflect
      // the board URL without a navigation, so refresh/bookmark land on it.
      setRevealed(true);
      try {
        window.history.replaceState(null, "", `/app/objective/${draftSpaceId}`);
      } catch {
        /* history unavailable */
      }

      void timers; // fire-and-forget; cleared implicitly on unmount/navigation
    },
    [draftSpaceId],
  );

  // No draft (logged out / creation failed) → plain home with legacy nav.
  if (!draftSpaceId) return <MinimalHome {...props} />;

  return (
    <>
      {/* Pre-warmed real board underneath (the shell is fixed inset-0 z-40). */}
      <ObjectiveCanvasShell spaceId={draftSpaceId} minimal seedOnLoad={false} rightInset={16}>
        <></>
      </ObjectiveCanvasShell>
      <PromptSharpeningMount spaceId={draftSpaceId} />
      <ObjectiveImageMount spaceId={draftSpaceId} />

      {/* Home overlay on top — opaque so the board never bleeds through before
          the user types. On first keystroke it fades to 0 + goes click-through,
          revealing the ready board (its chatbox card holds the typed text). */}
      <div
        className="fixed inset-0 overflow-y-auto"
        aria-hidden={revealed}
        style={{
          zIndex: 50,
          background: appleVibe.surface.base,
          opacity: revealed ? 0 : 1,
          pointerEvents: revealed ? "none" : "auto",
          transition: "opacity 0.45s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <MinimalHome {...props} onIntakeStart={handleStart} />
      </div>
    </>
  );
}
