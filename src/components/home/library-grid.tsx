"use client";

// ── Library grid ──
//
// The "library" section of the minimal home — the user's real spaces as
// clean white cards. Each card reads in three zones:
//   1. grey label  → the category / type of the workspace (from space_kind)
//   2. bold title  → the AI-summarized NAME of the work (card_brief.name)
//   3. bullets     → the AI-summarized most-important points / final
//                    statements (card_brief.points)
//
// The brief is generated + cached server-side (spaces.card_brief). Cards
// that arrive without a fresh brief (new or stale) are filled progressively
// by POSTing /api/spaces/[id]/card-brief — SSR stays fast and cards
// "sharpen" a moment after load. Until a brief lands we fall back to the
// raw name + a naive description split so a card is never empty.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2, Loader2, Layers } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { SpaceCardBrief } from "@/lib/objective-canvas/summarize-space-card";

export interface LibrarySpace {
  id: string;
  name: string | null;
  description: string | null;
  space_kind: string | null;
  /** Cached AI brief — null when missing or stale (server-decided). */
  card_brief?: SpaceCardBrief | null;
  /** True when this objective has a sandbox (a hidden child space) inside it —
   *  rendered as a sub-branch chip rather than its own card. */
  hasSandbox?: boolean;
}

const KIND_LABEL: Record<string, string> = {
  objective_canvas: "Objective",
  brainstorm_speed: "Brainstorm",
  reasoning: "Whiteboard",
  precise_rd: "Research",
  digital_twin: "Twin",
};

function kindLabel(kind: string | null): string {
  return KIND_LABEL[kind ?? ""] ?? "Canvas";
}

// Naive fallback bullets from the raw description, used only until the AI
// brief lands (or if it never does).
function bulletsFrom(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\n|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3)
    .map((s) => (s.length > 90 ? s.slice(0, 89) + "…" : s));
}

// Progressively fetch briefs for cards that arrived without a fresh one.
// Cached (fresh) briefs return instantly from the route without an LLM hop;
// misses cost one Sonnet call. Home caps the grid at 12 cards, so a wider
// fan-out (vs. the old 3) sharpens raw titles in ~2 waves instead of 4.
const FILL_CONCURRENCY = 6;

function useProgressiveBriefs(
  spaces: LibrarySpace[],
): Record<string, SpaceCardBrief> {
  const [briefs, setBriefs] = useState<Record<string, SpaceCardBrief>>(() => {
    const seed: Record<string, SpaceCardBrief> = {};
    for (const s of spaces) if (s.card_brief) seed[s.id] = s.card_brief;
    return seed;
  });
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const todo = spaces.filter((s) => !s.card_brief).map((s) => s.id);
    if (todo.length === 0) return;

    let cancelled = false;
    let idx = 0;
    async function worker() {
      while (!cancelled && idx < todo.length) {
        const id = todo[idx++];
        try {
          const res = await fetch(`/api/spaces/${id}/card-brief`, {
            method: "POST",
          });
          if (!res.ok) continue;
          const json = (await res.json()) as { brief: SpaceCardBrief | null };
          if (json.brief && !cancelled) {
            setBriefs((prev) => ({ ...prev, [id]: json.brief! }));
          }
        } catch {
          /* transient — skip this card */
        }
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(FILL_CONCURRENCY, todo.length) }, worker),
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return briefs;
}

export function LibraryGrid({ spaces }: { spaces: LibrarySpace[] }) {
  const router = useRouter();
  const briefs = useProgressiveBriefs(spaces);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  // The space awaiting the custom "are you sure?" confirmation. We replace
  // the browser-native window.confirm() with an on-brand minimal dialog.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // The card the user just clicked to OPEN. Navigation runs inside a React
  // transition so the home stays on-screen (no full-screen splash, no global
  // route loader) while ONLY this one card spins. When the whiteboard route
  // is ready the transition commits and we land straight on the board.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [isNavigating, startNavigation] = useTransition();

  function openSpace(id: string, href: string) {
    if (openingId) return; // a card is already opening — ignore double clicks
    setOpeningId(id);
    startNavigation(() => {
      router.push(href);
    });
  }

  // Safety net: if the transition settles while we're still mounted (a no-op
  // push or a failed navigation), clear the spinner so the card is live again.
  // On a successful open this component unmounts first, so it never fires.
  useEffect(() => {
    if (!isNavigating && openingId) setOpeningId(null);
  }, [isNavigating, openingId]);

  async function performRemove(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      // Soft-remove via archive (PATCH archived:true) rather than a hard
      // DELETE — it's reversible and never fails on a space that has linked
      // rows (entities / credit ledger have non-cascading FKs). The library
      // query already filters archived=false, so the card stays gone.
      const res = await fetch(`/api/spaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) setRemoved((prev) => new Set(prev).add(id));
    } catch {
      /* transient — leave the card in place */
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  // Dismiss the confirm dialog on Escape — standard modal affordance.
  useEffect(() => {
    if (!confirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyId) setConfirmId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmId, busyId]);

  const visible = spaces.filter((s) => !removed.has(s.id));

  // The space targeted by the open confirm dialog, plus a human title to
  // name it in the prompt (prefer the AI brief name, then the raw name).
  const confirmSpace = confirmId
    ? spaces.find((s) => s.id === confirmId) ?? null
    : null;
  const confirmTitle =
    (confirmSpace &&
      (briefs[confirmSpace.id]?.name?.trim() ||
        confirmSpace.name?.trim())) ||
    "this whiteboard";

  const removeDialog = (
    <RemoveDialog
      open={!!confirmSpace}
      title={confirmTitle}
      busy={!!confirmSpace && busyId === confirmSpace.id}
      onCancel={() => {
        if (!busyId) setConfirmId(null);
      }}
      onConfirm={() => {
        if (confirmSpace) void performRemove(confirmSpace.id);
      }}
    />
  );

  if (visible.length === 0) {
    return (
      <>
        <p
          className="text-[13px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          Your canvases will appear here. Start one above.
        </p>
        {removeDialog}
      </>
    );
  }

  return (
    <>
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((space) => {
        const brief = briefs[space.id] ?? null;
        const href =
          space.space_kind === "objective_canvas"
            ? `/app/objective/${space.id}`
            : `/app/space/${space.id}/whiteboard`;
        const title =
          brief?.name?.trim() || space.name?.trim() || "Untitled";
        const points =
          brief?.points && brief.points.length > 0
            ? brief.points
            : bulletsFrom(space.description);
        const opening = openingId === space.id;
        return (
          <div key={space.id} className="group relative">
          <motion.button
            type="button"
            onClick={() => openSpace(space.id, href)}
            aria-busy={opening}
            whileHover={opening ? undefined : { y: -3, boxShadow: appleVibe.shadow.cardHover }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full flex-col items-start rounded-3xl p-[22px] text-left"
            style={{
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.soft}`,
              boxShadow: opening ? appleVibe.shadow.cardHover : appleVibe.shadow.card,
              minHeight: 168,
              // While opening, the card is a non-interactive surface under the
              // veil — block re-clicks without disabling (keeps the layout).
              pointerEvents: opening ? "none" : undefined,
            }}
          >
            {/* zone 1 — what this is (AI "kind", else the space-kind label) */}
            <span
              className="text-[12px] font-semibold"
              style={{ color: appleVibe.text.tertiary }}
            >
              {brief?.kind?.trim() || kindLabel(space.space_kind)}
            </span>
            {/* zone 2 — AI-summarized name */}
            <span
              className="mt-0.5 text-[16px] font-bold leading-tight"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
              }}
            >
              {title}
            </span>
            {/* zone 3 — AI-summarized key points */}
            {points.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {points.map((b, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[12.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    <span
                      aria-hidden
                      className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: appleVibe.text.tertiary }}
                    />
                    <span className="line-clamp-2">{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span
                className="mt-3 text-[12.5px] font-light"
                style={{ color: appleVibe.text.tertiary }}
              >
                Open canvas →
              </span>
            )}

            {/* Sub-branch — the objective has a sandbox (a hidden child space)
                inside it. A small connector elbows down into a "Sandbox" chip
                so the card shows its nested layer at a glance. */}
            {space.hasSandbox && (
              <div className="mt-3 flex items-center gap-1.5">
                <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden>
                  <path
                    d="M1 0 L1 9 Q1 13 5 13 L13 13"
                    fill="none"
                    style={{ stroke: appleVibe.stroke.soft }}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <span
                  className="inline-flex items-center gap-1 rounded-full"
                  style={{
                    padding: "3px 9px 3px 7px",
                    background: appleVibe.surface.chip,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                    color: appleVibe.accent.primary,
                    fontSize: 11,
                    fontWeight: 650,
                    letterSpacing: "-0.01em",
                  }}
                >
                  <Layers style={{ width: 12, height: 12 }} strokeWidth={2.2} />
                  Sandbox
                </span>
              </div>
            )}
          </motion.button>

          {/* Opening state — ONLY this card. A soft frosted veil + a spinner
              pill signal that the whiteboard is loading. The home stays put
              behind it; when the route is ready we transition straight onto
              the board. Pointer-events-none: purely a visual cue. */}
          <AnimatePresence>
            {opening && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-3xl"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  background: "rgba(255,255,255,0.62)",
                  backdropFilter: "blur(2px)",
                  WebkitBackdropFilter: "blur(2px)",
                }}
              >
                <motion.span
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold"
                  style={{
                    background: appleVibe.surface.card,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                    boxShadow: appleVibe.shadow.chip,
                    color: appleVibe.accent.primary,
                  }}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Opening…
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Remove (archive) — hover-revealed so it never competes with the
              card content; stops propagation so it doesn't open the canvas. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmId(space.id);
            }}
            disabled={busyId === space.id || opening}
            title="Remove from library"
            aria-label="Remove from library"
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full opacity-0 transition-opacity duration-150 focus:opacity-100 group-hover:opacity-100"
            style={{
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.soft}`,
              boxShadow: appleVibe.shadow.chip,
              color: appleVibe.text.tertiary,
              cursor: busyId === space.id ? "default" : "pointer",
            }}
          >
            {busyId === space.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
          </div>
        );
      })}
    </div>
    {removeDialog}
    </>
  );
}

// ── Remove confirmation dialog ──
//
// A small, on-brand replacement for the browser-native window.confirm().
// Soft-dimmed backdrop + a centered white card with a destructive accent.
// Clicking the backdrop or pressing Escape (handled by the parent) cancels;
// the primary button archives the space.
//
// We render conditionally (not via AnimatePresence) so the dialog reliably
// unmounts the moment `open` flips false — AnimatePresence was holding the
// node mounted indefinitely after exit in this tree, so Cancel/Escape/backdrop
// "did nothing". The enter animation still plays via initial→animate on mount;
// closing is instant, which is the right feel for a confirm prompt anyway.
function RemoveDialog({
  open,
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const danger = appleVibe.stage.pain; // #DC2626
  if (!open) return null;
  return (
    <motion.div
      className="fixed inset-0 z-[120] grid place-items-center p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      onClick={onCancel}
      style={{
        background: "rgba(15,23,42,0.30)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
      }}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-label="Remove from library"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[330px] rounded-[24px] p-6"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.cardHover,
        }}
      >
        {/* destructive glyph */}
        <div
          className="grid h-11 w-11 place-items-center rounded-full"
          style={{ background: "rgba(220,38,38,0.10)", color: danger }}
        >
          <Trash2 className="h-[18px] w-[18px]" strokeWidth={2} />
        </div>

        <h2
          className="mt-4 text-[17px] font-bold leading-tight"
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
          }}
        >
          Remove from library?
        </h2>
        <p
          className="mt-1.5 text-[13px] font-light leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          <span style={{ fontWeight: 600 }}>{title}</span> will be archived. You
          can restore it later.
        </p>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-4 py-2 text-[13px] font-semibold transition-colors"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-opacity"
            style={{
              background: danger,
              boxShadow: "0 8px 20px -10px rgba(220,38,38,0.6)",
              opacity: busy ? 0.7 : 1,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
