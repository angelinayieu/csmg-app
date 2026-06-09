"use client";

// ── SeedChat ──
//
// The chatbox for the objective seed (OBJECTIVE_SEED_PLAN — "this could all be a
// chatbox"). It drives the Crucible interactively: the agent asks 1–3 sharp
// questions, the FOUNDER answers here (real input — the quality lever), the
// agent self-answers factual ones, and on convergence it triggers /seed enrich
// so the objective card surfaces the external deliverable. Opened from the
// objective card via the seed-chat signal. Non-occluding right rail.

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, Send, Search, Sparkles, CheckCircle2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { onOpenSeedChat } from "@/lib/objective-canvas/seed/seed-chat-signal";
import { startSeedAutoBuild } from "@/lib/objective-canvas/seed/seed-autobuild-signal";

interface EvalGap {
  biggestGap?: string;
  biggestGapKind?: "stop_ship" | "two_way_door";
  verdict?: string;
  call?: "go" | "refine_first";
  weightingRationale?: string;
}
interface CQ { id: string; text: string; audience: "user" | "research"; intent?: string; answered: boolean }
interface CA { questionId: string; text: string; via: "user" | "research"; citations?: { title: string; url: string }[]; auto?: { candidates: number; rationale?: string; runnerUp?: string } }
interface CState {
  status: string;
  round?: number;
  summary?: string;
  convergedReason?: string;
  questions?: CQ[];
  answers?: CA[];
}

export function SeedChatMount({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenSeedChat((id) => { if (id === spaceId) setOpen(true); }), [spaceId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return <SeedChatPanel spaceId={spaceId} onClose={() => setOpen(false)} />;
}

function SeedChatPanel({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const [state, setState] = useState<CState | null>(null);
  const [evalGap, setEvalGap] = useState<EvalGap | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const started = useRef(false);
  const enriched = useRef(false);
  const stateRef = useRef<CState | null>(null);
  stateRef.current = state;

  const post = useCallback(
    async (action: string, route: "crucible" | "seed", body: Record<string, unknown> = {}): Promise<CState | null> => {
      try {
        const r = await fetch(`/api/objective/${spaceId}/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...body }),
          cache: "no-store",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { state?: CState | null };
        return j.state ?? null;
      } catch {
        return null;
      }
    },
    [spaceId],
  );

  // The one-brain interweave: the evaluator's biggestGap leads the chat as the
  // decisive question. Pulled from the seed so the chat asks what the brain says
  // matters most — not a separate question stream.
  const fetchEval = useCallback(async () => {
    try {
      const r = await fetch(`/api/objective/${spaceId}/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get" }),
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as { seed?: { internal?: { evaluation?: EvalGap | null } } };
      const e = j.seed?.internal?.evaluation;
      if (e && (e.biggestGap || e.verdict)) setEvalGap(e);
    } catch {
      /* soft */
    }
  }, [spaceId]);

  useEffect(() => { void fetchEval(); }, [fetchEval]);

  // On convergence, build the seed once (so the card's deliverable refreshes),
  // then re-pull the evaluation so the decisive gap updates after the answers.
  const maybeEnrich = useCallback(
    (s: CState | null) => {
      if (s?.status === "converged" && !enriched.current) {
        enriched.current = true;
        void post("enrich", "seed").then(() => fetchEval());
      }
    },
    [post, fetchEval],
  );

  // Drive: start once, then advance research-only "working" rounds; pause on
  // awaiting_user for the founder.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function step(first: boolean) {
      if (!alive || busy.current) { schedule(); return; }
      busy.current = true;
      try {
        let next: CState | null;
        if (first && !started.current) {
          started.current = true;
          next = await post("start", "crucible");
        } else {
          const cur = await post("state", "crucible");
          next = cur?.status === "working" ? await post("continue", "crucible") : cur;
        }
        if (alive && next) { setState(next); maybeEnrich(next); }
      } finally {
        busy.current = false;
      }
      schedule();
    }
    function schedule() {
      if (!alive) return;
      const s = stateRef.current?.status;
      if (s === "converged" || s === "error") return;
      timer = setTimeout(() => step(false), s === "working" ? 1400 : 3500);
    }
    step(true);
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const pending = (state?.questions ?? []).filter((q) => q.audience === "user" && !q.answered);

  const submit = useCallback(async () => {
    if (submitting || busy.current) return;
    const answers = pending
      .map((q) => ({ questionId: q.id, text: (drafts[q.id] ?? "").trim() }))
      .filter((a) => a.text.length > 0);
    if (!answers.length) return;
    setSubmitting(true);
    busy.current = true;
    try {
      const next = await post("answer", "crucible", { answers });
      if (next) { setState(next); setDrafts({}); maybeEnrich(next); }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, [pending, drafts, post, submitting, maybeEnrich]);

  const status = state?.status;
  const working = status === "working" || !state;

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
      <div style={header}>
        <Sparkles style={{ width: 15, height: 15, color: CHAT_ACCENT }} strokeWidth={2.4} />
        <span style={titleStyle}>Refine the seed</span>
        {state?.round ? <span style={roundChip}>Round {state.round}</span> : null}
        <button type="button" title="Close" onClick={onClose} style={closeBtn}><X style={{ width: 16, height: 16 }} strokeWidth={2.2} /></button>
      </div>

      <div style={statusRow}>
        {working && <><Loader2 className="animate-spin" style={{ width: 12, height: 12, color: CHAT_ACCENT }} /> <span>Thinking…</span></>}
        {status === "awaiting_user" && <span style={{ color: CHAT_ACCENT, fontWeight: 700 }}>Your turn — answer to sharpen the seed</span>}
        {status === "converged" && <><CheckCircle2 style={{ width: 12, height: 12, color: "#059669" }} /> <span style={{ color: "#059669", fontWeight: 700 }}>Converged — building the deliverable</span></>}
      </div>

      <div style={scroll} onWheelCapture={(e) => e.stopPropagation()}>
        {evalGap?.biggestGap && (
          <div style={{ ...gapBox, borderColor: evalGap.biggestGapKind === "stop_ship" ? "rgba(220,38,38,0.28)" : "rgba(245,158,11,0.30)", background: evalGap.biggestGapKind === "stop_ship" ? "rgba(220,38,38,0.05)" : "rgba(245,158,11,0.06)" }}>
            <div style={{ ...gapLabel, color: evalGap.biggestGapKind === "stop_ship" ? "#DC2626" : "#B45309" }}>
              {evalGap.biggestGapKind === "stop_ship" ? "⛔ Decisive gap to close" : "🎯 The decisive question"}
            </div>
            <div style={gapText}>{evalGap.biggestGap}</div>
            {evalGap.weightingRationale && <div style={gapWhy}>{evalGap.weightingRationale}</div>}
          </div>
        )}
        {state?.summary && <div style={summaryBox}>{state.summary}</div>}

        {(state?.questions ?? []).map((q) => {
          const a = (state?.answers ?? []).find((x) => x.questionId === q.id);
          return (
            <div key={q.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={badge(q.audience)}>
                  {q.audience === "research" ? <><Search style={{ width: 9, height: 9 }} strokeWidth={2.6} /> researched</> : "for you"}
                </span>
                <span style={qText}>{q.text}</span>
              </div>
              {a && (
                <div style={{ marginLeft: 4, paddingLeft: 8, borderLeft: `2px solid ${a.auto ? "rgba(16,185,129,0.45)" : `${CHAT_ACCENT}33`}`, marginTop: 4 }}>
                  {a.auto && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: "#047857", background: "rgba(16,185,129,0.12)", padding: "1px 6px", borderRadius: 999 }}>
                        ⚡ auto · chose from {a.auto.candidates}
                      </span>
                      {a.auto.rationale && <span style={{ fontSize: 9.5, color: appleVibe.text.faint }}>{a.auto.rationale}</span>}
                    </div>
                  )}
                  <div style={aText}>{a.text}</div>
                  {a.auto?.runnerUp && (
                    <div style={{ fontSize: 9.5, color: appleVibe.text.faint, marginTop: 2 }}>runner-up: {a.auto.runnerUp}</div>
                  )}
                  {a.citations && a.citations.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                      {a.citations.slice(0, 4).map((c, i) => (
                        <a key={i} href={c.url} target="_blank" rel="noreferrer" style={citeChip} title={c.title || c.url}>{hostOf(c.url)}</a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {status === "awaiting_user" && pending.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {pending.map((q) => (
              <textarea
                key={q.id}
                value={drafts[q.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                placeholder="Your answer…"
                rows={2}
                style={input}
              />
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" onClick={submit} disabled={submitting} style={{ ...sendBtn, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : <Send style={{ width: 13, height: 13 }} strokeWidth={2.4} />}
                {submitting ? "Thinking…" : "Answer"}
              </button>
              <button
                type="button"
                onClick={() => { startSeedAutoBuild(spaceId); onClose(); }}
                title="Let the AI answer the rest itself (drafts options, ranks, picks the best)"
                style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#047857", fontFamily: appleVibe.font.stack }}
              >
                ⚡ Let AI finish
              </button>
            </div>
          </div>
        )}

        {status === "converged" && (
          <div style={{ ...summaryBox, borderColor: "rgba(5,150,105,0.25)", marginTop: 8 }}>
            {state?.convergedReason || "We've mapped the levers. The deliverable is updating on the objective card."}
          </div>
        )}
      </div>
    </div>
  );
}

const CHAT_ACCENT = "#7C3AED";
function hostOf(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; } }

const rail = { position: "fixed", top: 64, right: 16, bottom: 16, zIndex: 95, width: "min(400px, calc(100vw - 32px))", display: "flex", flexDirection: "column", minHeight: 0, borderRadius: appleVibe.radius.lg, background: "var(--glass-float-bg)", backdropFilter: "blur(var(--blur-float)) saturate(1.7)", WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)", border: "1px solid var(--glass-border)", boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 24px 60px -22px rgba(11,18,40,0.40)", fontFamily: appleVibe.font.stack } as const;
const header = { display: "flex", alignItems: "center", gap: 8, padding: "13px 14px 10px", borderBottom: "1px solid var(--glass-border)" } as const;
const titleStyle = { fontSize: 14, fontWeight: 700, color: appleVibe.text.primary, flex: 1 } as const;
const roundChip = { fontSize: 10, fontWeight: 700, color: CHAT_ACCENT, background: `${CHAT_ACCENT}14`, padding: "2px 7px", borderRadius: 999 } as const;
const closeBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: appleVibe.radius.sm, border: "none", background: "transparent", cursor: "pointer", color: appleVibe.text.tertiary } as const;
const statusRow = { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 11, color: appleVibe.text.tertiary, borderBottom: "1px solid var(--glass-border)" } as const;
const scroll = { flex: 1, overflowY: "auto", padding: "12px 14px 16px", minHeight: 0 } as const;
const summaryBox = { fontSize: 12, lineHeight: 1.5, color: appleVibe.text.primary, background: "rgba(15,23,42,0.03)", border: "1px solid rgba(15,23,42,0.06)", borderRadius: 12, padding: "9px 11px", marginBottom: 10 } as const;
const gapBox = { display: "flex", flexDirection: "column", gap: 4, border: "1px solid rgba(245,158,11,0.30)", borderRadius: 12, padding: "9px 11px", marginBottom: 12 } as const;
const gapLabel = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#B45309" } as const;
const gapText = { fontSize: 12.5, fontWeight: 650, lineHeight: 1.4, color: appleVibe.text.primary } as const;
const gapWhy = { fontSize: 10.5, lineHeight: 1.4, color: appleVibe.text.tertiary, marginTop: 1 } as const;
function badge(a: "user" | "research") { const research = a === "research"; return { display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase", color: research ? "#2563EB" : CHAT_ACCENT, background: research ? "rgba(37,99,235,0.10)" : `${CHAT_ACCENT}1a`, padding: "2px 6px", borderRadius: 999 } as const; }
const qText = { fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary, lineHeight: 1.35 } as const;
const aText = { fontSize: 12, color: appleVibe.text.secondary, lineHeight: 1.45 } as const;
const citeChip = { fontSize: 9.5, fontWeight: 600, color: appleVibe.text.tertiary, background: "rgba(15,23,42,0.04)", padding: "2px 7px", borderRadius: 999, textDecoration: "none" } as const;
const input = { width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.9)", fontSize: 12.5, lineHeight: 1.45, color: appleVibe.text.primary, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" } as const;
const sendBtn = { display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", height: 30, padding: "0 14px", borderRadius: 999, border: "none", background: CHAT_ACCENT, color: "#fff", fontSize: 12, fontWeight: 650, cursor: "pointer", fontFamily: appleVibe.font.stack } as const;
