"use client";

// ── Mechanism Gallery ─────────────────────────────────────────────
//
// A stacked-card deck presentation for a feature's mechanism lineup —
// the "different methods to solve the same problem" gallery. Replaces
// the flat bottom-rail list (MechanismLineup's <ul>) with an
// interactive, browsable deck:
//
//   • One method is in focus as a large flip-flashcard; the rest fan
//     out behind it as a peeking deck (click a ghost to bring forward).
//   • FRONT = surface / "final product" forward: identity + score +
//     the interface mockup when the method is elected (the actual
//     thing the method produces), or a clean summary before delivery.
//   • BACK (flip) = the internal reasoning: tradeoff, open questions,
//     target root-cause, a compact proxy-indicator summary, Open Lab.
//
// Why a NEW file (not folded into category-card.tsx): that file is
// large and co-edited by parallel sessions. This deck reuses the
// shared MethodBadge module + the LineupVariation type (type-only
// import) and owns its own compact mockup-face so it stays decoupled.
// Wiring it into CategoryCard as a list/gallery toggle is a small,
// separate follow-up once that file settles.
//
// Backend: zero new data. variations[] are pre-generated and live on
// entities.expanded_detail.variations[]. The mockup face hits the
// existing /api/brainstorm/item/variation/mockup route (format=
// thumbnail) — the same contract the inline preview uses.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Layout,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { MethodBadge } from "./method-badge";
import type { LineupVariation } from "./category-card";

// Score tier colors — one quiet signal. Green = strong, amber =
// middling, faint = weak/unscored. Mirrors the lineup's thresholds.
const STRONG = "#16A34A";
const MIDDLING = "#D97706";

function scoreColorFor(scorePct: number): string {
  if (scorePct >= 70) return STRONG;
  if (scorePct >= 40) return MIDDLING;
  return appleVibe.text.faint;
}

const CARD_H = 384;

// ── Public component ──────────────────────────────────────────────
export function MechanismGallery({
  variations,
  featureId,
  spaceId,
  subObjectiveId,
  onElect,
  onReject,
}: {
  variations: LineupVariation[];
  /** Entity id — fired at the mockup route for the product face. */
  featureId: string;
  /** Used to build the Open Lab deep-link on the card back. Hidden
   *  when either is missing. */
  spaceId?: string;
  subObjectiveId?: string;
  onElect: (variationId: string) => void;
  onReject: (variationId: string) => void;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const n = variations.length;
  // Clamp + reset flip whenever the focused card changes or the deck
  // shrinks (e.g. after a reject re-sorts upstream).
  useEffect(() => {
    if (active > n - 1) setActive(Math.max(0, n - 1));
  }, [active, n]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (n === 0) return;
      setFlipped(false);
      setActive((i) => (i + dir + n) % n);
    },
    [n],
  );

  // Keyboard nav when the deck (or a child) has focus.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === " " || e.key === "Enter") {
        // space/enter flips the focused card
        if (e.target === stageRef.current) {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }
    },
    [go],
  );

  if (n === 0) return null;

  const v = variations[Math.min(active, n - 1)];
  // Up to two upcoming methods fanned behind the focused card.
  const ghosts: Array<{ idx: number; v: LineupVariation }> = [];
  for (let k = 1; k <= 2 && k < n; k++) {
    const idx = (active + k) % n;
    ghosts.push({ idx, v: variations[idx] });
  }

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Stage — perspective wrapper that hosts the fanned deck. */}
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label={`Method gallery — ${n} method${n === 1 ? "" : "s"}, viewing ${active + 1}`}
        className="relative outline-none"
        style={{ height: CARD_H, perspective: 1600 }}
      >
        {/* Ghost deck behind — decorative peek of upcoming methods.
            Offset + rotated + scaled down; click brings forward. */}
        {ghosts.map((g, gi) => {
          const depth = gi + 1; // 1 or 2
          return (
            <button
              key={`ghost-${g.idx}`}
              type="button"
              onClick={() => {
                setFlipped(false);
                setActive(g.idx);
              }}
              aria-label={`Bring "${g.v.name}" into focus`}
              className="absolute left-0 right-0 top-0 mx-auto cursor-pointer text-left"
              style={{
                height: CARD_H - depth * 14,
                maxWidth: 420 - depth * 18,
                transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.045})`,
                opacity: 0.55 - gi * 0.18,
                zIndex: 1 - gi,
                filter: "blur(0.3px)",
              }}
            >
              <div
                className="flex h-full w-full flex-col gap-2 overflow-hidden p-4"
                style={{
                  background: appleVibe.surface.card,
                  border: `1px solid ${appleVibe.stroke.soft}`,
                  borderRadius: appleVibe.radius.xl,
                  boxShadow: `0 10px 26px rgba(15,23,42,0.06)`,
                }}
              >
                <span
                  className="truncate text-[12px] font-semibold"
                  style={{
                    color: appleVibe.text.tertiary,
                    fontFamily: appleVibe.font.display,
                  }}
                >
                  {g.v.name}
                </span>
              </div>
            </button>
          );
        })}

        {/* Focused flip-card. */}
        <div
          className="absolute left-0 right-0 top-0 mx-auto"
          style={{ height: CARD_H, maxWidth: 420, zIndex: 10 }}
        >
          <motion.div
            animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            style={{
              position: "relative",
              height: "100%",
              width: "100%",
              transformStyle: "preserve-3d",
            }}
          >
            {/* FRONT */}
            <CardFace hidden={reduce ? flipped : false}>
              <FrontFace
                v={v}
                featureId={featureId}
                rank={active + 1}
                onElect={onElect}
                onReject={onReject}
                onFlip={() => setFlipped(true)}
              />
            </CardFace>

            {/* BACK */}
            <CardFace back hidden={reduce ? !flipped : false}>
              <BackFace
                v={v}
                spaceId={spaceId}
                subObjectiveId={subObjectiveId}
                featureId={featureId}
                onFlip={() => setFlipped(false)}
              />
            </CardFace>
          </motion.div>
        </div>
      </div>

      {/* Deck controls — prev / position dots / next. */}
      {n > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <DeckButton label="Previous method" onClick={() => go(-1)}>
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
          </DeckButton>
          <div className="flex items-center gap-1.5">
            {variations.map((vv, i) => (
              <button
                key={vv.id || i}
                type="button"
                onClick={() => {
                  setFlipped(false);
                  setActive(i);
                }}
                aria-label={`Go to method ${i + 1}`}
                aria-current={i === active}
                className="h-1.5 rounded-full transition-all duration-200"
                style={{
                  width: i === active ? 18 : 6,
                  background:
                    i === active
                      ? appleVibe.text.secondary
                      : appleVibe.stroke.medium,
                }}
              />
            ))}
          </div>
          <DeckButton label="Next method" onClick={() => go(1)}>
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.4} />
          </DeckButton>
        </div>
      )}
    </div>
  );
}

// ── Card face wrapper — 3D backface-hidden plane ──────────────────
function CardFace({
  children,
  back = false,
  hidden = false,
}: {
  children: React.ReactNode;
  back?: boolean;
  hidden?: boolean;
}) {
  return (
    <div
      aria-hidden={hidden}
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : undefined,
        // When reduced-motion collapses the flip, hide the off face so
        // the two don't overlap.
        visibility: hidden ? "hidden" : "visible",
      }}
    >
      {children}
    </div>
  );
}

// ── FRONT — surface / final-product forward ───────────────────────
function FrontFace({
  v,
  featureId,
  rank,
  onElect,
  onReject,
  onFlip,
}: {
  v: LineupVariation;
  featureId: string;
  rank: number;
  onElect: (id: string) => void;
  onReject: (id: string) => void;
  onFlip: () => void;
}) {
  const score = v.effectiveness_score ?? 0;
  const scorePct = score * 100;
  const scoreColor = scoreColorFor(scorePct);
  const isElected = v.disposition === "elected";
  const isRejected = v.disposition === "rejected";
  const isRd = v.provenance === "rd_iteration";

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${isElected ? `${STRONG}38` : appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: isElected
          ? `0 18px 40px ${STRONG}22, 0 4px 12px rgba(15,23,42,0.08)`
          : `0 16px 36px rgba(15,23,42,0.10), 0 3px 8px rgba(15,23,42,0.05)`,
        opacity: isRejected ? 0.6 : 1,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 px-4 pt-4">
        <span
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold tabular-nums"
          style={{
            background: isElected ? `${STRONG}16` : appleVibe.surface.chip,
            color: isElected ? STRONG : appleVibe.text.tertiary,
            fontFamily: appleVibe.font.display,
          }}
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4
              className="min-w-0 text-[14px] font-semibold leading-snug"
              style={{
                color: appleVibe.text.primary,
                letterSpacing: "-0.012em",
                fontFamily: appleVibe.font.display,
              }}
              title={v.name}
            >
              {v.name}
            </h4>
            {isElected && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[2px] text-[9px] font-semibold"
                style={{ background: `${STRONG}14`, color: STRONG }}
              >
                <Check className="h-2.5 w-2.5" strokeWidth={2.6} />
                Elected
              </span>
            )}
            {isRd && !isElected && !isRejected && (
              <span
                className="inline-flex items-center rounded-full px-1.5 py-[2px] text-[9px] font-semibold"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.tertiary,
                }}
                title="Candidate from an R&D refinement run"
              >
                Experiment
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onFlip}
          aria-label="Flip to see reasoning"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.05)]"
          style={{ color: appleVibe.text.tertiary }}
          title="Flip — tradeoff, open questions, proxy indicators"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>

      {/* Score module */}
      {score > 0 && (
        <div className="flex items-center gap-2 px-4 pt-2.5">
          <div
            className="relative h-1.5 w-16 overflow-hidden"
            style={{
              background: appleVibe.stroke.soft,
              borderRadius: appleVibe.radius.pill,
            }}
          >
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${Math.max(4, Math.min(100, scorePct))}%`,
                background: scoreColor,
                borderRadius: appleVibe.radius.pill,
              }}
            />
          </div>
          <span
            className="tabular-nums"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {scorePct.toFixed(0)}
          </span>
          {v.evaluation_method && (
            <MethodBadge method={v.evaluation_method} compact />
          )}
        </div>
      )}

      {/* Product zone — the "final product" forward. When elected,
          the interface mockup IS the headline. Otherwise the
          description carries the front. */}
      <div className="mt-3 min-h-0 flex-1 px-4 pb-3">
        {isElected ? (
          <MockupFace
            entityId={featureId}
            variationId={v.id}
            initialHtml={v.mockup_thumbnail_html}
          />
        ) : (
          <p
            className="text-[12px] leading-relaxed"
            style={{
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 6,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {v.description || "No description yet."}
          </p>
        )}
      </div>

      {/* Actions footer */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2.5"
        style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <span
          className="text-[10px] font-light italic"
          style={{ color: appleVibe.text.faint }}
        >
          {isElected ? "Final product" : "Proposed method"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => v.id && onReject(v.id)}
            disabled={isRejected || !v.id}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[rgba(220,38,38,0.10)] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: isRejected ? "rgba(220,38,38,0.85)" : appleVibe.text.tertiary,
            }}
            aria-label="Reject this method"
            title="Reject"
          >
            <X className="h-4 w-4" strokeWidth={2.3} />
          </button>
          <button
            type="button"
            onClick={() => v.id && onElect(v.id)}
            disabled={isElected || !v.id}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed"
            style={{
              background: isElected ? `${STRONG}14` : appleVibe.accent.primary,
              color: isElected ? STRONG : appleVibe.text.onAccent,
            }}
            aria-label="Elect this method"
            title="Elect"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            {isElected ? "Elected" : "Elect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── BACK — internal reasoning ─────────────────────────────────────
function BackFace({
  v,
  spaceId,
  subObjectiveId,
  featureId,
  onFlip,
}: {
  v: LineupVariation;
  spaceId?: string;
  subObjectiveId?: string;
  featureId: string;
  onFlip: () => void;
}) {
  const topIndicators = (v.indicator_scores ?? []).slice(0, 4);
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: `0 16px 36px rgba(15,23,42,0.10)`,
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Reasoning
        </span>
        <button
          type="button"
          onClick={onFlip}
          aria-label="Flip back to product"
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.05)]"
          style={{ color: appleVibe.text.tertiary }}
          title="Flip back"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {v.tradeoff && (
          <div
            className="py-0.5 pl-3"
            style={{ borderLeft: "2px solid rgba(217,119,6,0.5)" }}
          >
            <div
              className="text-[9.5px] font-semibold tracking-tight"
              style={{ color: "rgba(180,83,9,0.92)" }}
            >
              Tradeoff
            </div>
            <p
              className="mt-0.5 text-[11.5px] leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {v.tradeoff}
            </p>
          </div>
        )}

        {v.open_questions && v.open_questions.length > 0 && (
          <div>
            <div
              className="mb-1 text-[9.5px] font-semibold tracking-tight"
              style={{ color: appleVibe.text.faint }}
            >
              Open questions
            </div>
            <ul className="space-y-1">
              {v.open_questions.slice(0, 3).map((q, i) => (
                <li
                  key={`${i}-${q}`}
                  className="text-[11.5px] leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        {v.target_root_cause && (
          <div className="flex items-center gap-1.5">
            <span
              className="text-[9.5px] font-semibold tracking-tight"
              style={{ color: appleVibe.text.faint }}
            >
              Targets
            </span>
            <span
              className="inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
              }}
            >
              {v.target_root_cause}
            </span>
          </div>
        )}

        {topIndicators.length > 0 && (
          <div>
            <div
              className="mb-1.5 text-[9.5px] font-semibold tracking-tight"
              style={{ color: appleVibe.text.faint }}
            >
              Proxy indicators
            </div>
            <div className="flex flex-wrap gap-1">
              {topIndicators.map((ind, i) => {
                const tier =
                  ind.score >= 0.7
                    ? STRONG
                    : ind.score < 0.4
                      ? appleVibe.stage.pain
                      : appleVibe.text.secondary;
                const label =
                  ind.indicator_text.length > 28
                    ? `${ind.indicator_text.slice(0, 26)}…`
                    : ind.indicator_text;
                return (
                  <span
                    key={`${ind.indicator_text}-${i}`}
                    title={ind.reason}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium"
                    style={{
                      background: appleVibe.surface.chip,
                      color: appleVibe.text.secondary,
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>{label}</span>
                    <span style={{ fontWeight: 600, color: tier }}>
                      {ind.score.toFixed(2)}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {!v.tradeoff &&
          !(v.open_questions && v.open_questions.length) &&
          !v.target_root_cause &&
          topIndicators.length === 0 && (
            <p
              className="text-[11.5px] font-light italic"
              style={{ color: appleVibe.text.faint }}
            >
              No reasoning captured yet — score this method to populate
              proxy indicators and tradeoffs.
            </p>
          )}
      </div>

      {spaceId && subObjectiveId && (
        <a
          href={`/app/objective/${spaceId}/sub/${subObjectiveId}/lab/${featureId}`}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11px] font-semibold transition-colors hover:bg-[rgba(124,58,237,0.06)]"
          style={{
            color: appleVibe.accent.primary,
            borderTop: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <FlaskConical className="h-3.5 w-3.5" strokeWidth={2.2} />
          Open Lab — full evaluation
        </a>
      )}
    </div>
  );
}

// ── Compact mockup product-face ───────────────────────────────────
//
// Self-contained 480×320 thumbnail mockup, scaled to fit the card's
// product zone. Same route contract as the inline preview in
// category-card.tsx (format=thumbnail). Owns its own fetch so the
// gallery stays decoupled from that co-edited file.
function MockupFace({
  entityId,
  variationId,
  initialHtml,
}: {
  entityId: string;
  variationId: string;
  initialHtml?: string;
}) {
  const [html, setHtml] = useState<string>(initialHtml ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMockup = useCallback(
    async (force = false) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/brainstorm/item/variation/mockup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId,
            variationId,
            format: "thumbnail",
            mode: force ? "force" : "default",
          }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          mockup_html?: string;
        };
        if (!res.ok) {
          setError(j.error ?? "Mockup generation failed.");
          return;
        }
        if (typeof j.mockup_html === "string") setHtml(j.mockup_html);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setBusy(false);
      }
    },
    [busy, entityId, variationId],
  );

  if (html) {
    return (
      <div
        className="relative h-full w-full overflow-hidden"
        style={{
          borderRadius: appleVibe.radius.md,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          background: "#fff",
        }}
      >
        <iframe
          title="Interface mockup"
          srcDoc={html}
          sandbox=""
          scrolling="no"
          style={{
            width: 480,
            height: 320,
            border: "none",
            transformOrigin: "top left",
            // Scale the 480-wide mockup down into the card column.
            transform: "scale(0.78)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 text-center"
      style={{
        borderRadius: appleVibe.radius.md,
        border: `1px dashed ${appleVibe.stroke.medium}`,
        background: appleVibe.surface.cardElevated,
      }}
    >
      {error && (
        <p
          className="px-3 text-[10.5px] font-light"
          style={{ color: "rgba(127,29,29,0.95)" }}
        >
          {error}
        </p>
      )}
      <motion.button
        type="button"
        onClick={() => void fetchMockup(false)}
        disabled={busy}
        whileHover={{ y: -1 }}
        whileTap={{ y: 0.5 }}
        className="inline-flex items-center gap-1.5 disabled:opacity-60"
        style={{
          background: appleVibe.surface.card,
          color: appleVibe.accent.primary,
          border: `1px solid ${appleVibe.accent.primary}40`,
          borderRadius: appleVibe.radius.pill,
          padding: "5px 12px",
          fontSize: "11px",
          fontWeight: 600,
        }}
        title="Generate a 480×320 interface mockup of this method"
      >
        {busy ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
            Generating…
          </>
        ) : (
          <>
            <Layout className="h-3 w-3" strokeWidth={2.2} />
            Preview interface
          </>
        )}
      </motion.button>
      {!busy && !error && (
        <span
          className="text-[9.5px] font-light"
          style={{ color: appleVibe.text.faint }}
        >
          Renders the final product
        </span>
      )}
    </div>
  );
}

// ── Deck nav button ───────────────────────────────────────────────
function DeckButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.06)]"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        color: appleVibe.text.secondary,
        boxShadow: appleVibe.shadow.chip,
      }}
    >
      {children}
    </button>
  );
}
