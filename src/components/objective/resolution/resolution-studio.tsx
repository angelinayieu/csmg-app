"use client";

// ── ResolutionStudio ──────────────────────────────────────────────
//
// The immersive "I'll answer" experience (Phase 2). Opened from the Prompt
// Sharpening Card over the board. The user resolves each high-leverage
// ambiguity one flashcard at a time — picking candidate readings (chips),
// and/or answering in their own words by VOICE or TYPING, with a live AI
// assist that distills their rambling into a crisp answer + nudges. A right
// rail shows the scope sharpening in real time (a filling confidence ring +
// the resolved/remaining levers). Answers persist onto the sharpening
// artifact (the unit of the user's taste; Phase 3 writes them into the
// glossary / variables).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X, Check, CornerDownLeft } from "lucide-react";
import { Spark } from "@/components/objective/icons/spark";
import { GlassPanel } from "@/components/ui/glass-panel";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { useVoiceRecorder } from "@/components/objective/voice/use-voice-recorder";
import {
  refreshSharpening,
  emitAiAutoResolveStarted,
  emitAiAutoResolveEnded,
  type ResolutionStudioDetail,
  type ResolutionStudioConcept,
} from "@/components/objective/board-bus";
import type { Resolution } from "@/lib/objective-canvas/prompt-sharpening-prompt";

const ACCENT = "#2563EB"; // matches SHARPEN_COLOR

// Mirrors the sharpening card's Tropical Punch palette (kept in sync there).
const KIND_STYLE: Record<string, { color: string; label: string }> = {
  pain: { color: "#FF8243", label: "Pain" },
  goal: { color: "#FCE883", label: "Goal" },
  lever: { color: "#069494", label: "Lever" },
  constraint: { color: "#FF8243", label: "Limit" },
  concept: { color: "#FFC0CB", label: "Term" },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}
const slugOf = (c: ResolutionStudioConcept) =>
  c.concept_slug || slugify(c.phrase);
const scoreOf = (c: ResolutionStudioConcept) =>
  c.leverage * (0.5 + 0.5 * c.uncertainty);

interface AnswerState {
  chosen: string[];
  text: string;
  source: "manual" | "voice" | "ai";
}
const EMPTY: AnswerState = { chosen: [], text: "", source: "manual" };

export function ResolutionStudio({
  detail,
  onClose,
}: {
  detail: ResolutionStudioDetail;
  onClose: () => void;
}) {
  // Deck order: most leverage × uncertainty first (what most needs answering).
  const deck = useMemo(() => {
    const arr = [...(detail.concepts ?? [])];
    return arr.sort((a, b) => scoreOf(b) - scoreOf(a));
  }, [detail.concepts]);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [assist, setAssist] = useState<{ distilled: string; suggestions: string[] }>(
    { distilled: "", suggestions: [] },
  );
  const [assistLoading, setAssistLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hoverReading, setHoverReading] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  const assistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const assistSeq = useRef(0);

  const current = deck[index];
  const slug = current ? slugOf(current) : "";
  const ans = (slug && answers[slug]) || EMPTY;

  const setAns = useCallback(
    (patch: Partial<AnswerState>) => {
      if (!slug) return;
      setAnswers((prev) => ({
        ...prev,
        [slug]: { ...(prev[slug] || EMPTY), ...patch },
      }));
    },
    [slug],
  );

  // Voice — spoken sentences append to the current card's answer text.
  const recorder = useVoiceRecorder({
    onFinalSentence: (s) => {
      if (!slug) return;
      setAnswers((prev) => {
        const cur = prev[slug] || EMPTY;
        const text = (cur.text ? cur.text + " " : "") + s;
        return { ...prev, [slug]: { ...cur, text: text.trim(), source: "voice" } };
      });
    },
  });

  // Reset mic + assist when switching cards; stop the mic on unmount.
  useEffect(() => {
    recorder.reset();
    setAssist({ distilled: "", suggestions: [] });
    assistSeq.current++; // invalidate any in-flight assist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  useEffect(
    () => () => recorder.reset(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Live AI assist — debounced on the current answer text (typed or spoken).
  useEffect(() => {
    if (!current) return;
    const text = ans.text.trim();
    if (text.length < 10) {
      setAssist({ distilled: "", suggestions: [] });
      return;
    }
    clearTimeout(assistTimer.current);
    assistTimer.current = setTimeout(async () => {
      const seq = ++assistSeq.current;
      setAssistLoading(true);
      try {
        const r = await fetch(`/api/objective/${detail.spaceId}/answer-assist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phrase: current.phrase,
            question: current.why || `What do you mean by "${current.phrase}"?`,
            candidateReadings: current.candidate_readings || [],
            transcript: text,
          }),
        });
        if (r.ok && seq === assistSeq.current) {
          const j = (await r.json()) as {
            distilled?: string;
            suggestions?: string[];
          };
          setAssist({
            distilled: j.distilled || "",
            suggestions: Array.isArray(j.suggestions) ? j.suggestions : [],
          });
        }
      } catch {
        /* soft-fail */
      } finally {
        if (seq === assistSeq.current) setAssistLoading(false);
      }
    }, 1100);
    return () => clearTimeout(assistTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ans.text, index]);

  const answeredOf = useCallback(
    (c: ResolutionStudioConcept) => {
      const a = answers[slugOf(c)];
      return !!a && (a.chosen.length > 0 || a.text.trim().length > 0);
    },
    [answers],
  );
  const answeredCount = useMemo(
    () => deck.filter(answeredOf).length,
    [deck, answeredOf],
  );
  const isAnswered = ans.chosen.length > 0 || ans.text.trim().length > 0;
  const last = index >= deck.length - 1;

  function toggleReading(r: string) {
    const has = ans.chosen.includes(r);
    setAns({
      chosen: has ? ans.chosen.filter((x) => x !== r) : [...ans.chosen, r],
      source: "manual",
    });
  }
  function letAiDecide() {
    const top =
      assist.distilled ||
      (current?.candidate_readings && current.candidate_readings[0]) ||
      "";
    setAns({
      chosen: top && current?.candidate_readings?.includes(top) ? [top] : ans.chosen,
      text: top,
      source: "ai",
    });
  }
  function toggleMic() {
    if (!recorder.supported) return;
    if (recorder.recording) recorder.pause();
    else recorder.start();
  }
  function go(delta: number) {
    setIndex((i) => Math.max(0, Math.min(deck.length - 1, i + delta)));
  }

  const buildResolutions = useCallback((): Resolution[] => {
    const now = new Date().toISOString();
    return deck
      .map((c): Resolution | null => {
        const s = slugOf(c);
        const a = answers[s];
        if (!a || (!a.chosen.length && !a.text.trim())) return null;
        return {
          concept_slug: s,
          phrase: c.phrase,
          kind: c.kind,
          chosen_readings: a.chosen,
          answer_text: a.text.trim(),
          source: a.source,
          resolved_at: now,
        };
      })
      .filter((x): x is Resolution => x !== null);
  }, [deck, answers]);

  // Persist a set of resolutions, then run the Phase 3 write-back (glossary +
  // re-framed prompt) and (re)build Variable/Feature cards from the resolved
  // objective. Shared by the normal finish AND the "let AI answer all" path.
  const commitResolutions = useCallback(
    async (res: Resolution[]) => {
      if (!res.length) return;
      try {
        await fetch(`/api/objective/${detail.spaceId}/resolutions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolutions: res }),
        });
        try {
          const r = await fetch(
            `/api/objective/${detail.spaceId}/apply-resolutions`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            },
          );
          const j = r.ok
            ? ((await r.json()) as { status?: string; sharpenedPrompt?: string })
            : null;
          refreshSharpening(detail.spaceId);
          // Decompose the re-framed objective into Feature/Variable cards on the
          // board. The canonical event lives in deploy-oc-cards (tldraw-coupled),
          // so dispatch the raw event here to keep this modal tldraw-free.
          window.dispatchEvent(
            new CustomEvent("objective-board:decompose-into-cards", {
              detail: j?.sharpenedPrompt
                ? { objective: j.sharpenedPrompt }
                : undefined,
            }),
          );
        } catch {
          /* soft-fail — resolutions are saved regardless */
        }
      } catch {
        /* soft-fail — answers are still in state */
      }
    },
    [detail.spaceId],
  );

  const finish = useCallback(async () => {
    if (saving || autoBusy) return;
    setSaving(true);
    await commitResolutions(buildResolutions());
    setSaving(false);
    onClose();
  }, [saving, autoBusy, buildResolutions, commitResolutions, onClose]);

  // "Let AI answer everything" — the user skips the flashcards entirely. One
  // server call commits the most likely reading for EVERY ambiguity at once
  // (coherently with the objective); we keep any answers the user already gave
  // and fall back to each concept's top candidate reading if the call fails.
  const aiDecideAll = useCallback(async () => {
    if (saving || autoBusy) return;
    setAutoBusy(true);
    const now = new Date().toISOString();

    // Surface in-flight state to the goal rail's AI activity strip — same bus
    // event the card's inline "Let AI decide" emits, so the rail's pulse +
    // post-flight summary cover both entry points.
    emitAiAutoResolveStarted({
      spaceId: detail.spaceId,
      trigger: "studio",
      conceptCount: deck.length,
    });
    let aiRes: Resolution[] = [];
    let aiOk = false;
    try {
      const r = await fetch(`/api/objective/${detail.spaceId}/auto-resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          concepts: deck.map((c) => ({
            concept_slug: slugOf(c),
            phrase: c.phrase,
            kind: c.kind,
            why: c.why,
            candidate_readings: c.candidate_readings || [],
          })),
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as { resolutions?: Resolution[] };
        aiRes = Array.isArray(j?.resolutions) ? j.resolutions : [];
        aiOk = aiRes.length > 0;
      }
    } catch {
      /* soft-fail → fall back below */
    }
    emitAiAutoResolveEnded({
      spaceId: detail.spaceId,
      trigger: "studio",
      resolvedCount: aiRes.length,
      reviewCount: aiRes.filter((r) => r.needs_review).length,
      ok: aiOk,
    });

    // Merge: user's own answers win; then AI's; then a top-reading fallback for
    // anything still unresolved that has candidate readings.
    const bySlug = new Map<string, Resolution>();
    for (const c of deck) {
      const reads = c.candidate_readings || [];
      if (reads.length) {
        bySlug.set(slugOf(c), {
          concept_slug: slugOf(c),
          phrase: c.phrase,
          kind: c.kind,
          chosen_readings: [reads[0]],
          answer_text: "",
          source: "ai",
          resolved_at: now,
        });
      }
    }
    for (const r of aiRes) bySlug.set(r.concept_slug, r);
    for (const c of deck) {
      const s = slugOf(c);
      const a = answers[s];
      if (a && (a.chosen.length || a.text.trim())) {
        bySlug.set(s, {
          concept_slug: s,
          phrase: c.phrase,
          kind: c.kind,
          chosen_readings: a.chosen,
          answer_text: a.text.trim(),
          source: a.source,
          resolved_at: now,
        });
      }
    }

    await commitResolutions([...bySlug.values()]);
    setAutoBusy(false);
    onClose();
  }, [saving, autoBusy, deck, answers, detail.spaceId, commitResolutions, onClose]);

  // Esc closes (saving whatever's answered).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") void finish();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  if (!current) return null;
  const ks = KIND_STYLE[current.kind] ?? KIND_STYLE.concept;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={() => void finish()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(15,18,26,0.38)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.965, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.975, y: 8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: showDetail ? "min(1040px, 95vw)" : "min(620px, 94vw)",
          maxHeight: "88vh",
          transition: "width 0.34s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* A deck of cards peeking behind — reinforces the calm "one question
            at a time" flashcard feel. Only in the focused single-card view;
            it falls away once the detail rail is opened. */}
        {!showDetail && (
          <>
            <div aria-hidden style={deckCard(2)} />
            <div aria-hidden style={deckCard(1)} />
          </>
        )}
        <GlassPanel
          tier="modal"
          accent={ACCENT}
          radius={24}
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            maxHeight: "88vh",
            overflow: "hidden",
          }}
        >
          {/* AI is resolving everything — a calm working state over the card. */}
          {autoBusy && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                background: "rgba(255,255,255,0.74)",
                backdropFilter: "blur(3px)",
                WebkitBackdropFilter: "blur(3px)",
                textAlign: "center",
                padding: 24,
              }}
            >
              <Spark
                className="animate-pulse"
                style={{ width: 30, height: 30, color: ACCENT }}
              />
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: appleVibe.text.primary,
                }}
              >
                Letting AI answer all {deck.length}…
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: appleVibe.text.tertiary,
                  maxWidth: 280,
                }}
              >
                Committing to the most likely reading for each, then sharpening
                your objective.
              </div>
            </div>
          )}
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px 20px",
              borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            <Spark style={{ width: 16, height: 16, color: ACCENT }} strokeWidth={2.4} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                  color: appleVibe.text.tertiary,
                }}
              >
                Resolve to sharpen
              </div>
              {detail.objectiveTitle && (
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: appleVibe.text.primary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 520,
                  }}
                >
                  {detail.objectiveTitle}
                </div>
              )}
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Escape hatch — let AI answer the whole questionnaire so the
                  user never has to look through it. */}
              <button
                type="button"
                onClick={() => void aiDecideAll()}
                disabled={autoBusy || saving}
                title="Let AI commit to the most likely answer for every question — skip the flashcards"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "none",
                  background: `${ACCENT}12`,
                  color: ACCENT,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: autoBusy || saving ? "default" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Spark
                  className={autoBusy ? "animate-pulse" : undefined}
                  style={{ width: 13, height: 13 }}
                />
                {autoBusy ? "Answering…" : "Auto-answer all"}
              </button>
              {showDetail && (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: appleVibe.text.tertiary,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {answeredCount} of {deck.length} clarified
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                aria-label={showDetail ? "Hide details" : "Show details"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 11px",
                  borderRadius: 999,
                  border: "none",
                  background: showDetail ? `${ACCENT}14` : "rgba(15,23,42,0.05)",
                  color: showDetail ? ACCENT : appleVibe.text.secondary,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {showDetail ? "Hide" : "Details"}
              </button>
              <button
                type="button"
                onClick={() => void finish()}
                aria-label="Close"
                style={{
                  display: "inline-flex",
                  padding: 6,
                  borderRadius: 999,
                  border: "none",
                  background: "rgba(15,23,42,0.05)",
                  color: appleVibe.text.secondary,
                  cursor: "pointer",
                }}
              >
                <X style={{ width: 16, height: 16 }} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          {/* Body: flashcard | scope rail */}
          <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
            {/* ── Flashcard ── */}
            <div
              style={{
                flex: "1.55 1 0",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                padding: "22px 30px 18px",
                overflowY: "auto",
              }}
            >
              {/* Progress dots */}
              <div style={{ display: "flex", gap: 5, marginBottom: 16 }}>
                {deck.map((c, i) => {
                  const a = answeredOf(c);
                  return (
                    <span
                      key={i}
                      style={{
                        height: 4,
                        flex: 1,
                        borderRadius: 999,
                        background:
                          i === index
                            ? ACCENT
                            : a
                              ? `${ACCENT}66`
                              : "rgba(15,23,42,0.10)",
                        transition: "background 0.2s ease",
                      }}
                    />
                  );
                })}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -14 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  style={{ display: "flex", flexDirection: "column", maxWidth: 600 }}
                >
                  {/* kind — a quiet color swatch + neutral label. The palette
                      hue appears only as a small saturated dot (legible),
                      never as text (pale-yellow-on-white was illegible). The
                      deck is already ordered most-ambiguous-first, so no
                      alarm badge is needed to flag importance. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: ks.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                        color: appleVibe.text.tertiary,
                      }}
                    >
                      {ks.label}
                    </span>
                  </div>

                  {/* phrase */}
                  <div
                    style={{
                      marginTop: 14,
                      fontSize: 22,
                      fontWeight: 600,
                      lineHeight: 1.28,
                      color: appleVibe.text.primary,
                      letterSpacing: "-0.02em",
                      fontFamily: appleVibe.font.display,
                    }}
                  >
                    “{current.phrase}”
                  </div>
                  {current.why && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: appleVibe.text.secondary,
                      }}
                    >
                      {current.why}
                    </div>
                  )}

                  {/* candidate readings */}
                  {current.candidate_readings &&
                    current.candidate_readings.length > 0 && (
                      <div style={{ marginTop: 18 }}>
                        <div style={microLabel}>Which of these fits?</div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                          }}
                        >
                          {current.candidate_readings.map((r, i) => {
                            const sel = ans.chosen.includes(r);
                            const hov = hoverReading === i && !sel;
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => toggleReading(r)}
                                onMouseEnter={() => setHoverReading(i)}
                                onMouseLeave={() =>
                                  setHoverReading((h) => (h === i ? null : h))
                                }
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 13,
                                  textAlign: "left",
                                  padding: "12px 12px",
                                  borderRadius: 12,
                                  cursor: "pointer",
                                  border: "none",
                                  // Bare at rest — no boxes or borders — for an
                                  // image-2-style minimal list. Just a whisper
                                  // of wash on hover / selection; the checkbox
                                  // is the real selection signal.
                                  background: sel
                                    ? `${ACCENT}0A`
                                    : hov
                                      ? "rgba(15,23,42,0.035)"
                                      : "transparent",
                                  transition: "background 0.16s ease",
                                }}
                              >
                                <span
                                  style={{
                                    marginTop: 1,
                                    width: 18,
                                    height: 18,
                                    borderRadius: 7,
                                    flexShrink: 0,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: `1.5px solid ${sel ? ACCENT : appleVibe.stroke.medium}`,
                                    background: sel ? ACCENT : "transparent",
                                    transition: "all 0.16s ease",
                                  }}
                                >
                                  {sel && (
                                    <Check
                                      style={{ width: 12, height: 12, color: "white" }}
                                      strokeWidth={3}
                                    />
                                  )}
                                </span>
                                <span
                                  style={{
                                    fontSize: 13,
                                    lineHeight: 1.5,
                                    fontWeight: sel ? 600 : 500,
                                    color: sel
                                      ? appleVibe.text.primary
                                      : appleVibe.text.secondary,
                                  }}
                                >
                                  {r}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* voice / type lane */}
                  <div style={{ marginTop: 18 }}>
                    <div
                      style={{
                        ...microLabel,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>In your own words</span>
                      {recorder.recording && (
                        <Waveform level={recorder.level} color={ACCENT} />
                      )}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        borderRadius: 14,
                        border: `1px solid ${recorder.recording ? ACCENT : "transparent"}`,
                        background: recorder.recording
                          ? "rgba(255,255,255,0.85)"
                          : "rgba(15,23,42,0.03)",
                        transition: "all 0.16s ease",
                      }}
                    >
                      <textarea
                        value={ans.text}
                        onChange={(e) =>
                          setAns({
                            text: e.target.value,
                            source: ans.source === "voice" ? "voice" : "manual",
                          })
                        }
                        placeholder="Answer in your own words…"
                        rows={2}
                        style={{
                          width: "100%",
                          resize: "none",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          padding: "11px 44px 11px 13px",
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: appleVibe.text.primary,
                          fontFamily: appleVibe.font.stack,
                        }}
                      />
                      {/* mic */}
                      <button
                        type="button"
                        onClick={toggleMic}
                        title={
                          recorder.supported
                            ? recorder.recording
                              ? "Pause"
                              : "Speak your answer"
                            : "Voice needs Chrome or Edge"
                        }
                        disabled={!recorder.supported}
                        style={{
                          position: "absolute",
                          top: 9,
                          right: 9,
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "none",
                          cursor: recorder.supported ? "pointer" : "not-allowed",
                          background: recorder.recording
                            ? "rgba(220,38,38,0.92)"
                            : `${ACCENT}14`,
                          color: recorder.recording ? "white" : ACCENT,
                          opacity: recorder.supported ? 1 : 0.4,
                        }}
                      >
                        <Mic style={{ width: 15, height: 15 }} strokeWidth={2.3} />
                      </button>
                      {/* live interim line */}
                      {recorder.recording && recorder.interim && (
                        <div
                          style={{
                            padding: "0 13px 9px",
                            fontSize: 12,
                            lineHeight: 1.4,
                            color: appleVibe.text.faint,
                            fontStyle: "italic",
                          }}
                        >
                          {recorder.interim}…
                        </div>
                      )}
                    </div>

                    {/* live AI assist */}
                    {(assist.distilled || assist.suggestions.length > 0 || assistLoading) && (
                      <div style={{ marginTop: 10 }}>
                        {assistLoading && !assist.distilled ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              fontSize: 11,
                              color: appleVibe.text.faint,
                            }}
                          >
                            <span
                              className="animate-pulse"
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 999,
                                background: ACCENT,
                              }}
                            />
                            Listening…
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                            {assist.distilled && (
                              <button
                                type="button"
                                onClick={() => setAns({ text: assist.distilled })}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "6px 11px",
                                  borderRadius: 999,
                                  border: `1px solid ${ACCENT}`,
                                  background: `${ACCENT}10`,
                                  color: appleVibe.text.primary,
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  maxWidth: "100%",
                                }}
                                title="Use this crisp version"
                              >
                                <Spark
                                  style={{ width: 11, height: 11, color: ACCENT, flexShrink: 0 }}
                                  strokeWidth={2.4}
                                />
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {assist.distilled}
                                </span>
                              </button>
                            )}
                            {assist.suggestions.map((s, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() =>
                                  setAns({
                                    text: (ans.text ? ans.text + " " : "") + s,
                                  })
                                }
                                style={{
                                  padding: "6px 11px",
                                  borderRadius: 999,
                                  border: `1px solid ${appleVibe.stroke.soft}`,
                                  background: "rgba(255,255,255,0.65)",
                                  color: appleVibe.text.secondary,
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                                title="Add this angle"
                              >
                                + {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* footer — minimal (image-2): a quiet AI shortcut on the left,
                  a clean Back / Next pair on the right. No redundant Skip —
                  Next already advances when nothing is chosen. */}
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={letAiDecide}
                  style={textBtn(appleVibe.text.tertiary)}
                  title="Let AI pick the most likely answer"
                >
                  <Spark style={{ width: 12, height: 12 }} strokeWidth={2.4} />
                  Let AI decide
                </button>

                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => go(-1)}
                      style={textBtn(appleVibe.text.secondary)}
                    >
                      Back
                    </button>
                  )}
                  {last ? (
                    <button
                      type="button"
                      onClick={() => void finish()}
                      disabled={saving}
                      style={primaryBtn(saving)}
                    >
                      {saving ? "Saving…" : "Finish"}
                      {!saving && (
                        <CornerDownLeft
                          style={{ width: 14, height: 14 }}
                          strokeWidth={2.4}
                        />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => go(1)}
                      style={primaryBtn(false)}
                    >
                      Next
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Detail rail — hidden by default, revealed via "Details" so
                the focus stays on the question. ── */}
            {showDetail && (
              <motion.div
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  width: 340,
                  flexShrink: 0,
                  borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
                  background: "rgba(248,250,253,0.6)",
                  padding: "18px 18px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <Ring
                  value={deck.length ? answeredCount / deck.length : 0}
                  color={ACCENT}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      color: appleVibe.text.primary,
                    }}
                  >
                    Sharpening
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11.5,
                      lineHeight: 1.4,
                      color: appleVibe.text.tertiary,
                    }}
                  >
                    Clearer with every answer
                  </div>
                </div>
              </div>

              {detail.sharpenedPrompt && (
                <div>
                  <div style={microLabel}>Objective</div>
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: appleVibe.text.secondary,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.7)",
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                    }}
                  >
                    {detail.sharpenedPrompt}
                  </div>
                </div>
              )}

              {/* resolved */}
              {answeredCount > 0 && (
                <div>
                  <div style={microLabel}>Clarified</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {deck.filter(answeredOf).map((c) => {
                      const a = answers[slugOf(c)];
                      const k = KIND_STYLE[c.kind] ?? KIND_STYLE.concept;
                      const summary =
                        a.text.trim() || a.chosen.join(" · ") || "";
                      return (
                        <div
                          key={slugOf(c)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 9,
                            border: `1px solid ${k.color}26`,
                            background: `${k.color}0D`,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 999,
                                background: k.color,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 650,
                                color: appleVibe.text.primary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.phrase}
                            </span>
                            {a.source === "ai" && (
                              <Spark
                                style={{
                                  width: 10,
                                  height: 10,
                                  color: k.color,
                                  marginLeft: "auto",
                                  flexShrink: 0,
                                }}
                                strokeWidth={2.4}
                              />
                            )}
                          </div>
                          {summary && (
                            <div
                              style={{
                                marginTop: 3,
                                fontSize: 11,
                                lineHeight: 1.4,
                                color: appleVibe.text.tertiary,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {summary}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* remaining */}
              {answeredCount < deck.length && (
                <div>
                  <div style={microLabel}>Still to clarify</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {deck.map((c, i) =>
                      answeredOf(c) ? null : (
                        <button
                          key={slugOf(c)}
                          type="button"
                          onClick={() => setIndex(i)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 10px",
                            borderRadius: 9,
                            border: "none",
                            background: i === index ? `${ACCENT}0F` : "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {/* a quiet position dot — the active one lights up.
                              Replaces the old leverage mini-bar, which read as
                              an unexplained blue dash. */}
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 999,
                              flexShrink: 0,
                              background:
                                i === index ? ACCENT : "rgba(15,23,42,0.18)",
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: i === index ? 600 : 500,
                              color:
                                i === index
                                  ? appleVibe.text.primary
                                  : appleVibe.text.secondary,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.phrase}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
              </motion.div>
            )}
          </div>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}

// One calm, sentence-case section label for the whole modal — matches the
// module's `appleVibe.label` spec: hierarchy from weight + spacing, never
// all-caps shouting. Replaces the old 9.5px uppercase tracked treatment that
// drummed the same eyebrow style across seven sections.
const microLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.01em",
  color: "#475569",
  marginBottom: 10,
};

/** A bare text button (no border / fill) — the quiet secondary-action style
 *  for the minimal footer (Back, Let AI decide). */
function textBtn(color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "8px 12px",
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  };
}

/** A card in the deck peeking behind the active flashcard. Same size as the
 *  panel, nudged down + scaled in so only the bottom/side lip shows. Layer 1
 *  sits just behind; layer 2 a touch further back and fainter. */
function deckCard(layer: number): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    borderRadius: 24,
    background: "rgba(255,255,255,0.82)",
    border: `1px solid ${appleVibe.stroke.hairline}`,
    boxShadow: "0 18px 44px -24px rgba(11,18,40,0.28)",
    transform: `translateY(${layer * 12}px) scale(${1 - layer * 0.02})`,
    opacity: layer === 1 ? 0.85 : 0.62,
    zIndex: 0,
  };
}
function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    borderRadius: 999,
    border: "none",
    background: ACCENT,
    color: "white",
    fontSize: 12.5,
    fontWeight: 650,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.7 : 1,
    boxShadow: `0 8px 22px -10px ${ACCENT}66`,
  };
}

/** Five reactive bars driven by the mic level. */
function Waveform({ level, color }: { level: number; color: string }) {
  const factors = [0.5, 0.85, 1, 0.85, 0.5];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, marginLeft: 2 }}>
      {factors.map((f, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            height: Math.max(3, 3 + level * 12 * f),
            borderRadius: 999,
            background: color,
            transition: "height 90ms ease",
          }}
        />
      ))}
    </span>
  );
}

/** Confidence ring — fills as levers are resolved. */
function Ring({ value, color }: { value: number; color: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <svg width={46} height={46} viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
      <circle cx={23} cy={23} r={r} fill="none" stroke="rgba(15,23,42,0.10)" strokeWidth={4} />
      <circle
        cx={23}
        cy={23}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 23 23)"
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
      {/* Ambient fill, not a score. A big "0" at the start read as
          "you've done nothing" — the opposite of calm. The arc carries
          progress; a check lands only when every lever is clarified. */}
      {pct >= 1 && (
        <path
          d="M17 23.5 l4 4 l9 -9"
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
