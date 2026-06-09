"use client";

// ── CrucibleCardShapeUtil ─────────────────────────────────────────────
//
// The live interrogation card. Forks out below the objective right after
// promote and runs the Crucible loop: the Inquirer asks the founder 1–3 sharp
// questions per round, self-answers the factual ones via web search, and the
// Analyst classifies every answer into the running problem-model (landscape /
// solutions / constraints / variables). The end state is the substrate for
// leverage points + sub-objectives (later phases).
//
// LIVENESS without SSE: the card polls /crucible (action:"state"). When the
// loop is mid-flight ("working") it POSTs "continue" to advance the next
// autonomous round; when it's "awaiting_user" it renders an inline answer box;
// when "converged" it shows the synthesized summary. One in-flight POST at a
// time (a ref guard) so polls never stack calls.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { Loader2, Search, Sparkles, Send, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { deployObjectiveBriefCard } from "@/components/objective/board-bus";
import {
  pendingUserQuestions,
  type CrucibleAnswer,
  type CrucibleConstraint,
  type CrucibleQuestion,
  type CrucibleFeature,
  type CrucibleState,
  type CrucibleSubObjective,
  type CrucibleVariable,
  type FirstPrinciple,
  type LeveragePoint,
} from "@/lib/objective-canvas/crucible/crucible-types";
import { OPEN_CARD_DETAIL_EVENT } from "@/components/objective/canvas-interactions/object-detail-drawer";

export const CRUCIBLE_COLOR = "#7C3AED"; // violet — "reasoning / interrogation"

export type CrucibleCardShape = TLBaseShape<
  "crucible-card",
  {
    w: number;
    h: number;
    spaceId: string;
    color: string;
  }
>;

export class CrucibleCardShapeUtil extends BaseBoxShapeUtil<CrucibleCardShape> {
  static override type = "crucible-card" as const;
  static override props: RecordProps<CrucibleCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  getDefaultProps(): CrucibleCardShape["props"] {
    return { w: 392, h: 460, spaceId: "", color: CRUCIBLE_COLOR };
  }

  component(shape: CrucibleCardShape) {
    return <CrucibleCardRenderer shape={shape} />;
  }

  indicator(shape: CrucibleCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

// ── Renderer ──

function CrucibleCardRenderer({ shape }: { shape: CrucibleCardShape }) {
  const { w, h, spaceId, color } = shape.props;
  const [state, setState] = useState<CrucibleState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // One POST in flight at a time — polls must never stack continue/answer calls.
  const busyRef = useRef(false);
  const startedRef = useRef(false);
  // Latest state, read by the polling closure without re-subscribing the loop.
  const stateRef = useRef<CrucibleState | null>(null);
  stateRef.current = state;

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<CrucibleState | null> => {
      if (!spaceId) return null;
      try {
        const r = await fetch(`/api/objective/${spaceId}/crucible`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { state?: CrucibleState | null };
        return j.state ?? null;
      } catch {
        return null;
      }
    },
    [spaceId],
  );

  // Kick the loop off once, then poll. The poll drives autonomous rounds
  // ("working" → continue) and stops at awaiting_user / converged / error.
  useEffect(() => {
    if (!spaceId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function step(first: boolean) {
      if (!alive || busyRef.current) {
        schedule();
        return;
      }
      busyRef.current = true;
      try {
        let next: CrucibleState | null;
        if (first && !startedRef.current) {
          startedRef.current = true;
          next = await post({ action: "start" });
        } else {
          // Read state; advance autonomous rounds when mid-flight.
          const cur = await post({ action: "state" });
          if (cur?.status === "working") {
            next = await post({ action: "continue" });
          } else {
            next = cur;
          }
        }
        if (alive && next) setState(next);
      } finally {
        busyRef.current = false;
      }
      schedule();
    }

    function schedule() {
      if (!alive) return;
      // Poll faster while the agent is actively working; idle when waiting on
      // the user or done.
      const s = stateRef.current?.status;
      const delay = s === "working" ? 1500 : s === "awaiting_user" ? 4000 : 6000;
      // Stop polling entirely once converged (nothing left to advance).
      if (s === "converged") return;
      timer = setTimeout(() => step(false), delay);
    }

    step(true);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const pending = state ? pendingUserQuestions(state) : [];

  const submitAnswers = useCallback(async () => {
    if (submitting || busyRef.current) return;
    const answers = pending
      .map((q) => ({ questionId: q.id, text: (drafts[q.id] ?? "").trim() }))
      .filter((a) => a.text.length > 0);
    if (answers.length === 0) return;
    setSubmitting(true);
    busyRef.current = true;
    try {
      const next = await post({ action: "answer", answers });
      if (next) {
        setState(next);
        setDrafts({});
      }
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }, [pending, drafts, post, submitting]);

  const status = state?.status;
  const working = status === "working" || (!state && !!spaceId);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onPointerDown={stopEventPropagation}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          background:
            "linear-gradient(165deg, rgba(255,255,255,0.99) 0%, rgba(249,247,253,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 20px 50px -20px ${color}55, 0 8px 22px -12px rgba(11,18,40,0.16)`,
          fontFamily: appleVibe.font.stack,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(15,23,42,0.06)",
          }}
        >
          <Sparkles style={{ width: 15, height: 15, color }} strokeWidth={2.4} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: appleVibe.text.primary }}>
            Finding your leverage
          </span>
          {state && state.round > 0 && (
            <span style={roundChip(color)}>Round {state.round}</span>
          )}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
            {working && (
              <>
                <Loader2 className="animate-spin" style={{ width: 13, height: 13, color }} />
                <span style={statusText}>Asking…</span>
              </>
            )}
            {status === "awaiting_user" && <span style={statusText}>Your turn</span>}
            {status === "converged" && (
              <>
                <CheckCircle2 style={{ width: 13, height: 13, color: "#059669" }} />
                <span style={{ ...statusText, color: "#059669" }}>Converged</span>
              </>
            )}
            {status === "error" && (
              <>
                <AlertCircle style={{ width: 13, height: 13, color: "#DC2626" }} />
                <span style={{ ...statusText, color: "#DC2626" }}>Error</span>
              </>
            )}
          </span>
        </div>

        {/* Body — scrolls */}
        <div
          className="crucible-scroll"
          onWheelCapture={(e) => e.stopPropagation()}
          style={{ flex: 1, overflowY: "auto", padding: "10px 14px 12px", minHeight: 0 }}
        >
          {!state && (
            <div style={emptyHint}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Studying your
              objective…
            </div>
          )}

          {state && (
            <>
              {/* Running summary — what we've learned + where headed. */}
              {state.summary && <div style={summaryBox}>{state.summary}</div>}

              {/* Problem-model chips. */}
              {(state.landscape.length > 0 ||
                state.constraints.length > 0 ||
                state.variables.length > 0) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {state.landscape.length > 0 && (
                    <span style={modelChip("#2563EB")}>{state.landscape.length} landscape</span>
                  )}
                  {state.constraints.length > 0 && (
                    <span style={modelChip("#D97706")}>{state.constraints.length} constraints</span>
                  )}
                  {state.variables.length > 0 && (
                    <span style={modelChip("#069494")}>{state.variables.length} variables</span>
                  )}
                </div>
              )}

              {/* Variables in play. */}
              {state.variables.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={sectionLabel}>Variables in play</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                    {state.variables.map((v) => (
                      <div key={v.slug} style={{ fontSize: 12, color: appleVibe.text.primary }}>
                        <span style={{ fontWeight: 600 }}>{v.label}</span>
                        {v.note && (
                          <span style={{ color: appleVibe.text.tertiary }}> — {v.note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transcript. */}
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {state.questions.map((q) => (
                  <QuestionRow
                    key={q.id}
                    q={q}
                    answer={state.answers.find((a) => a.questionId === q.id)}
                    color={color}
                  />
                ))}
              </div>

              {/* Inline answer box for pending user questions. */}
              {status === "awaiting_user" && pending.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {pending.map((q) => (
                    <textarea
                      key={q.id}
                      value={drafts[q.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [q.id]: e.target.value }))
                      }
                      onPointerDown={stopEventPropagation}
                      placeholder="Your answer…"
                      rows={2}
                      style={answerInput}
                    />
                  ))}
                  <button
                    type="button"
                    onPointerDown={stopEventPropagation}
                    onClick={submitAnswers}
                    disabled={submitting}
                    style={{ ...submitBtn(color), opacity: submitting ? 0.6 : 1 }}
                  >
                    {submitting ? (
                      <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                    ) : (
                      <Send style={{ width: 13, height: 13 }} strokeWidth={2.4} />
                    )}
                    {submitting ? "Thinking…" : "Answer"}
                  </button>
                </div>
              )}

              {status === "converged" && (
                <ConvergedView
                  state={state}
                  spaceId={spaceId}
                  onSynthesize={() => post({ action: "converge" }).then((n) => n && setState(n))}
                />
              )}

              {status === "error" && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#DC2626" }}>
                  {state.error || "Something went wrong."}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

function QuestionRow({
  q,
  answer,
  color,
}: {
  q: CrucibleQuestion;
  answer: CrucibleAnswer | undefined;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={audienceBadge(q.audience)}>
          {q.audience === "research" ? (
            <>
              <Search style={{ width: 9, height: 9 }} strokeWidth={2.6} /> researched
            </>
          ) : (
            "for you"
          )}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary, lineHeight: 1.35 }}>
          {q.text}
        </span>
      </div>
      {answer && (
        <div style={{ paddingLeft: 4, borderLeft: `2px solid ${color}33`, marginLeft: 2 }}>
          <div style={{ fontSize: 12, color: appleVibe.text.secondary, lineHeight: 1.45, paddingLeft: 8 }}>
            {answer.text}
          </div>
          {answer.citations && answer.citations.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 8, marginTop: 3 }}>
              {answer.citations.slice(0, 4).map((c, i) => (
                <a
                  key={i}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  onPointerDown={stopEventPropagation}
                  style={citationChip}
                  title={c.title || c.url}
                >
                  {hostOf(c.url)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function openObject(objectId: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail: { objectId } }),
  );
}

// ── Converged view (Phase 2): ranked leverage points + constraints ──

function ConvergedView({
  state,
  spaceId,
  onSynthesize,
}: {
  state: CrucibleState;
  spaceId: string;
  onSynthesize: () => void;
}) {
  const levers = state.leveragePoints ?? [];
  const principles = state.firstPrinciples ?? [];
  const subObjectives = state.subObjectives ?? [];
  const features = state.features ?? [];
  const constraints = state.constraintObjects ?? [];
  const varLabel = new Map<string, string>(
    (state.variables ?? []).map((v: CrucibleVariable) => [v.slug, v.label]),
  );
  const leverLabel = new Map<string, string>(levers.map((l) => [l.slug, l.label]));

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...summaryBox, borderColor: "rgba(5,150,105,0.25)" }}>
        {state.convergedReason || "We've mapped the landscape, constraints, and key levers."}
      </div>

      {/* Compose the everything-together brief — the final product. */}
      <button
        type="button"
        onPointerDown={stopEventPropagation}
        onClick={() => deployObjectiveBriefCard({ spaceId })}
        style={composeBriefBtn}
        title="Assemble the objective + first principles + leverage points + constraints + decisions into one swappable brief"
      >
        <FileText style={{ width: 13, height: 13 }} strokeWidth={2.4} /> Compose brief
      </button>

      {/* The primary output. */}
      {levers.length > 0 ? (
        <div>
          <div style={sectionLabel}>Leverage points · {levers.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {levers.map((lp, i) => (
              <LeveragePointRow key={lp.slug} lp={lp} rank={i + 1} varLabel={varLabel} />
            ))}
          </div>
        </div>
      ) : (
        // Converged but synthesis hasn't landed (or soft-failed) → manual retry.
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={onSynthesize}
          style={submitBtn("#7C3AED")}
        >
          <Sparkles style={{ width: 13, height: 13 }} strokeWidth={2.4} /> Synthesize leverage points
        </button>
      )}

      {/* First principles — the irreducible truths the levers rest on. */}
      {principles.length > 0 && (
        <div>
          <div style={sectionLabel}>First principles · {principles.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {principles.map((fp) => (
              <FirstPrincipleRow key={fp.slug} fp={fp} leverLabel={leverLabel} />
            ))}
          </div>
        </div>
      )}

      {/* Sub-objectives — coined branches pursuing leverage clusters. */}
      {subObjectives.length > 0 && (
        <div>
          <div style={sectionLabel}>Sub-objectives · {subObjectives.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {subObjectives.map((so: CrucibleSubObjective) => {
              const levs = so.leverageSlugs.map((s) => leverLabel.get(s) || s).filter(Boolean);
              const clickable = !!so.objectId;
              return (
                <div
                  key={so.slug}
                  onPointerDown={clickable ? stopEventPropagation : undefined}
                  onClick={clickable ? () => openObject(so.objectId!) : undefined}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: "rgba(14,165,233,0.06)",
                    border: "1px solid rgba(14,165,233,0.20)",
                    cursor: clickable ? "pointer" : "default",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: appleVibe.text.primary }}>
                    {so.title}
                  </span>
                  {so.rationale && (
                    <span style={{ fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.secondary }}>
                      {so.rationale}
                    </span>
                  )}
                  {levs.length > 0 && (
                    <span style={{ fontSize: 10.5, color: appleVibe.text.tertiary }}>
                      via: {levs.join(" · ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Seed features — concrete builds the user expands next. */}
      {features.length > 0 && (
        <div>
          <div style={sectionLabel}>Seed features · {features.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
            {features.map((f: CrucibleFeature) => {
              const lever = leverLabel.get(f.leverageSlug) || f.leverageSlug;
              const clickable = !!f.objectId;
              return (
                <div
                  key={f.slug}
                  onPointerDown={clickable ? stopEventPropagation : undefined}
                  onClick={clickable ? () => openObject(f.objectId!) : undefined}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: "rgba(37,99,235,0.05)",
                    border: "1px solid rgba(37,99,235,0.18)",
                    cursor: clickable ? "pointer" : "default",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                  title={clickable ? "Open — expand this feature further" : undefined}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: appleVibe.text.primary }}>
                    {f.title}
                  </span>
                  {f.description && (
                    <span style={{ fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.secondary }}>
                      {f.description}
                    </span>
                  )}
                  {lever && (
                    <span style={{ fontSize: 10.5, color: appleVibe.text.tertiary }}>
                      operationalizes: {lever}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Constraints. */}
      {constraints.length > 0 && (
        <div>
          <div style={sectionLabel}>Constraints · {constraints.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {constraints.map((c: CrucibleConstraint) => (
              <div key={c.slug} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={constraintKindBadge(c.kind)}>{c.kind}</span>
                <span style={{ fontSize: 12, color: appleVibe.text.primary }}>
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  {c.why && <span style={{ color: appleVibe.text.tertiary }}> — {c.why}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LeveragePointRow({
  lp,
  rank,
  varLabel,
}: {
  lp: LeveragePoint;
  rank: number;
  varLabel: Map<string, string>;
}) {
  const targets = lp.targetsVariableSlugs
    .map((s) => varLabel.get(s) || s)
    .filter(Boolean);
  const clickable = !!lp.objectId;
  return (
    <div
      onPointerDown={clickable ? stopEventPropagation : undefined}
      onClick={clickable ? () => openObject(lp.objectId!) : undefined}
      style={{
        padding: "9px 11px",
        borderRadius: 12,
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.20)",
        cursor: clickable ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={rankBadge}>{rank}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: appleVibe.text.primary, flex: 1, minWidth: 0 }}>
          {lp.label}
        </span>
        <span style={scoreChip} title="Leverage score (Meadows · binding · fan-out · Pareto · feasibility)">
          {lp.score}
        </span>
      </div>
      {/* Score bar. */}
      <div style={scoreTrack}>
        <div style={{ ...scoreFill, width: `${Math.max(4, Math.min(100, lp.score))}%` }} />
      </div>
      {lp.rationale && (
        <div style={{ fontSize: 11.5, lineHeight: 1.45, color: appleVibe.text.secondary }}>
          {lp.rationale}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {lp.meadowsLevel && <span style={meadowsChip}>{lp.meadowsLevel}</span>}
        {targets.length > 0 && (
          <span style={{ fontSize: 10.5, color: appleVibe.text.tertiary }}>
            moves: {targets.join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

function FirstPrincipleRow({
  fp,
  leverLabel,
}: {
  fp: FirstPrinciple;
  leverLabel: Map<string, string>;
}) {
  const grounds = fp.groundsLeverageSlugs
    .map((s) => leverLabel.get(s) || s)
    .filter(Boolean);
  const clickable = !!fp.objectId;
  return (
    <div
      onPointerDown={clickable ? stopEventPropagation : undefined}
      onClick={clickable ? () => openObject(fp.objectId!) : undefined}
      style={{
        padding: "9px 11px",
        borderRadius: 12,
        background: "rgba(124,58,237,0.05)",
        border: "1px solid rgba(124,58,237,0.20)",
        cursor: clickable ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: appleVibe.text.primary, flex: 1, minWidth: 0 }}>
          {fp.label}
        </span>
        <span style={{ ...scoreChip, color: "#6D28D9" }} title="First-principle score (irreducibility · counterfactual · necessity · sufficiency · 5-whys)">
          {fp.score}
        </span>
      </div>
      {fp.statement && (
        <div style={{ fontSize: 11.5, lineHeight: 1.45, color: appleVibe.text.secondary }}>
          {fp.statement}
        </div>
      )}
      {grounds.length > 0 && (
        <span style={{ fontSize: 10.5, color: appleVibe.text.tertiary }}>
          grounds: {grounds.join(" · ")}
        </span>
      )}
    </div>
  );
}

// ── styles ──

const statusText = { fontSize: 10.5, fontWeight: 600, color: appleVibe.text.tertiary } as const;

function roundChip(color: string) {
  return {
    fontSize: 10,
    fontWeight: 700,
    color,
    background: `${color}14`,
    padding: "2px 7px",
    borderRadius: 999,
  } as const;
}

function modelChip(color: string) {
  return {
    fontSize: 10.5,
    fontWeight: 650,
    color,
    background: `${color}12`,
    padding: "3px 9px",
    borderRadius: 999,
  } as const;
}

function audienceBadge(audience: "user" | "research") {
  const research = audience === "research";
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: research ? "#2563EB" : "#7C3AED",
    background: research ? "rgba(37,99,235,0.10)" : "rgba(124,58,237,0.10)",
    padding: "2px 6px",
    borderRadius: 999,
  } as const;
}

const summaryBox = {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 1.5,
  color: appleVibe.text.primary,
  background: "rgba(15,23,42,0.03)",
  border: "1px solid rgba(15,23,42,0.06)",
  borderRadius: 12,
  padding: "9px 11px",
} as const;

const sectionLabel = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
} as const;

const emptyHint = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  color: appleVibe.text.tertiary,
  padding: "10px 2px",
} as const;

const answerInput = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "rgba(255,255,255,0.9)",
  fontSize: 12.5,
  lineHeight: 1.45,
  color: appleVibe.text.primary,
  resize: "vertical",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
} as const;

function submitBtn(color: string) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    height: 30,
    padding: "0 14px",
    borderRadius: 999,
    border: "none",
    background: color,
    color: "white",
    fontSize: 12,
    fontWeight: 650,
    cursor: "pointer",
    fontFamily: appleVibe.font.stack,
  } as const;
}

// "Compose brief" — indigo, the synthesis CTA on the converged card.
const composeBriefBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  alignSelf: "flex-start",
  height: 30,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid rgba(79,70,229,0.35)",
  background: "rgba(79,70,229,0.08)",
  color: "#4F46E5",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
} as const;

const citationChip = {
  fontSize: 9.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  background: "rgba(15,23,42,0.04)",
  padding: "2px 7px",
  borderRadius: 999,
  textDecoration: "none",
} as const;

const rankBadge = {
  display: "inline-grid",
  placeItems: "center",
  width: 18,
  height: 18,
  borderRadius: 999,
  background: "#F59E0B",
  color: "white",
  fontSize: 10,
  fontWeight: 800,
  flexShrink: 0,
} as const;

const scoreChip = {
  fontSize: 11,
  fontWeight: 800,
  color: "#B45309",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
} as const;

const scoreTrack = {
  height: 4,
  borderRadius: 999,
  background: "rgba(245,158,11,0.18)",
  overflow: "hidden",
} as const;

const scoreFill = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #F59E0B, #D97706)",
} as const;

const meadowsChip = {
  fontSize: 9.5,
  fontWeight: 700,
  color: "#B45309",
  background: "rgba(245,158,11,0.14)",
  padding: "2px 7px",
  borderRadius: 999,
} as const;

function constraintKindBadge(kind: "hard" | "soft") {
  const hard = kind === "hard";
  return {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: hard ? "#E11D48" : "#D97706",
    background: hard ? "rgba(225,29,72,0.10)" : "rgba(217,119,6,0.10)",
    padding: "2px 6px",
    borderRadius: 999,
  } as const;
}
