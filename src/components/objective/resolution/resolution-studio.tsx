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
import { Mic, X, ChevronLeft, Check, CornerDownLeft } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { GlassPanel } from "@/components/ui/glass-panel";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { useVoiceRecorder } from "@/components/objective/voice/use-voice-recorder";
import {
  refreshSharpening,
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

  const finish = useCallback(async () => {
    if (saving) return;
    const res = buildResolutions();
    setSaving(true);
    try {
      if (res.length) {
        await fetch(`/api/objective/${detail.spaceId}/resolutions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolutions: res }),
        });
        // Phase 3 write-back: glossary + re-framed prompt, then refresh the
        // card and (re)build Variable/Feature cards from the resolved objective.
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
      }
    } catch {
      /* soft-fail — answers are still in state */
    }
    setSaving(false);
    onClose();
  }, [saving, buildResolutions, detail.spaceId, onClose]);

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
        background: "rgba(10,15,30,0.46)",
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.965, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.975, y: 8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1040px, 95vw)", maxHeight: "88vh" }}
      >
        <GlassPanel
          tier="modal"
          accent={ACCENT}
          radius={24}
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: "88vh",
            overflow: "hidden",
          }}
        >
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
            <Sparkle style={{ width: 16, height: 16, color: ACCENT }} strokeWidth={2.4} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
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
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: appleVibe.text.tertiary,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {answeredCount} / {deck.length} resolved
              </span>
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
                padding: "18px 22px 16px",
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
                  style={{ display: "flex", flexDirection: "column" }}
                >
                  {/* kind + meters */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: ks.color,
                        padding: "2px 7px",
                        borderRadius: 5,
                        background: `${ks.color}1A`,
                      }}
                    >
                      {ks.label}
                    </span>
                    {current.leverage >= 0.6 && current.uncertainty >= 0.5 && (
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          color: ks.color,
                        }}
                      >
                        ⚑ NEEDS MODELLING
                      </span>
                    )}
                  </div>

                  {/* phrase */}
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 23,
                      fontWeight: 700,
                      lineHeight: 1.22,
                      color: appleVibe.text.primary,
                      letterSpacing: "-0.01em",
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
                        <div style={microLabel}>
                          Which do you mean? · pick any
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {current.candidate_readings.map((r, i) => {
                            const sel = ans.chosen.includes(r);
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => toggleReading(r)}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 10,
                                  textAlign: "left",
                                  padding: "11px 13px",
                                  borderRadius: 12,
                                  cursor: "pointer",
                                  border: `1px solid ${sel ? ACCENT : appleVibe.stroke.soft}`,
                                  background: sel ? `${ACCENT}0F` : "rgba(255,255,255,0.6)",
                                  transition: "all 0.14s ease",
                                }}
                              >
                                <span
                                  style={{
                                    marginTop: 1,
                                    width: 17,
                                    height: 17,
                                    borderRadius: 6,
                                    flexShrink: 0,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: `1.5px solid ${sel ? ACCENT : appleVibe.stroke.medium}`,
                                    background: sel ? ACCENT : "transparent",
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
                                    fontSize: 12.5,
                                    lineHeight: 1.45,
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
                      <span>Or say it · type it</span>
                      {recorder.recording && (
                        <Waveform level={recorder.level} color={ACCENT} />
                      )}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        borderRadius: 12,
                        border: `1px solid ${recorder.recording ? ACCENT : appleVibe.stroke.soft}`,
                        background: "rgba(255,255,255,0.7)",
                        transition: "border 0.14s ease",
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
                        rows={3}
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
                                <Sparkle
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

              {/* footer actions */}
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={letAiDecide}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                    background: "rgba(255,255,255,0.6)",
                    color: appleVibe.text.secondary,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  title="Let AI pick the most likely answer"
                >
                  <Sparkle style={{ width: 12, height: 12 }} strokeWidth={2.4} />
                  Let AI decide
                </button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => go(-1)}
                      style={ghostBtn()}
                    >
                      <ChevronLeft style={{ width: 15, height: 15 }} strokeWidth={2.4} />
                      Back
                    </button>
                  )}
                  {!last && !isAnswered && (
                    <button type="button" onClick={() => go(1)} style={ghostBtn()}>
                      Skip
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
                      {isAnswered ? "Next" : "Next"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Scope rail ── */}
            <div
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
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Ring value={deck.length ? answeredCount / deck.length : 0} color={ACCENT} />
                <div>
                  <div style={microLabel}>Your scope</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: appleVibe.text.primary,
                    }}
                  >
                    Sharpening
                  </div>
                  <div style={{ fontSize: 11, color: appleVibe.text.tertiary }}>
                    {answeredCount} of {deck.length} levers nailed
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
                  <div style={microLabel}>Resolved</div>
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
                              <Sparkle
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
                  <div style={microLabel}>Still to nail</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {deck.map((c, i) =>
                      answeredOf(c) ? null : (
                        <button
                          key={slugOf(c)}
                          type="button"
                          onClick={() => setIndex(i)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: "none",
                            background:
                              i === index ? "rgba(37,99,235,0.08)" : "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 500,
                              color: appleVibe.text.secondary,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.phrase}
                          </span>
                          <span
                            style={{
                              marginLeft: "auto",
                              width: 28,
                              height: 3,
                              borderRadius: 999,
                              background: "rgba(15,23,42,0.08)",
                              overflow: "hidden",
                              flexShrink: 0,
                            }}
                          >
                            <span
                              style={{
                                display: "block",
                                height: "100%",
                                width: `${Math.round(c.leverage * 100)}%`,
                                background: ACCENT,
                              }}
                            />
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}

const microLabel: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
  marginBottom: 8,
};

function ghostBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "8px 14px",
    borderRadius: 999,
    border: `1px solid ${appleVibe.stroke.soft}`,
    background: "rgba(255,255,255,0.6)",
    color: appleVibe.text.secondary,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
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
    boxShadow: `0 8px 20px -6px ${ACCENT}80`,
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
      <text
        x={23}
        y={27}
        textAnchor="middle"
        fontSize={12}
        fontWeight={700}
        fill={color}
        fontFamily={appleVibe.font.stack}
      >
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}
