"use client";

// ── Unpack Reasoning Panel ──────────────────────────────────────────────
//
// Right-edge glass sidebar that opens the moment the user presses Unpack
// (UNPACK_PLAN Phase 3). Shows the full agent reasoning surface so the
// user can see HOW the AI got from their card to the deployed cluster —
// not just a flat grid of cards.
//
// Lifecycle (driven by events from canvas-operations.ts runUnpack):
//   STARTED → panel opens in "Reasoning…" state immediately.
//   RESULT  → renders: source card, inferred goal_frame, the reasoning_log
//             (fade-in line-by-line so it reads like the agent typing),
//             principles tree, variations grouped under each principle,
//             ranking.
//   FAILED  → renders the failure reason instead of pending.
//
// Chat refinement (bottom of the panel):
//   The user types "expand p2", "constrain to mobile", "drop the audience-X
//   variations" → the panel calls /unpack again with priorTurns + mode and
//   fires UNPACK_REFINE_DEPLOY_EVENT so whiteboard-base extends the same
//   cluster with delta cards + delta connectors.
//
// Joins the right-edge mutex (board-panel-signal) so opening it closes
// powerups / library / style, and vice versa. Tech Spec stays out of the
// mutex but its right-edge `right:` push reads `usePanel("unpack")` too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  Send,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { setPanel, usePanel } from "@/lib/objective-canvas/board-panel-signal";
import {
  UNPACK_STARTED_EVENT,
  UNPACK_RESULT_EVENT,
  UNPACK_FAILED_EVENT,
  UNPACK_REFINE_DEPLOY_EVENT,
  type UnpackStartedDetail,
  type UnpackResultDetail,
  type UnpackFailedDetail,
  type UnpackResultPayload,
  type UnpackRefineDeployDetail,
} from "@/lib/objective-canvas/unpack-events";

interface Props {
  spaceId: string;
  editor: Editor;
}

type State =
  | { phase: "closed" }
  | {
      phase: "running";
      cardId: string;
      cardTitle: string;
      sourceKind: string;
      /** Pre-result holding state for any prior result + turns the sidebar
       *  was already showing (so a refine click doesn't blank the panel). */
      result: UnpackResultPayload | null;
      turns: ChatTurn[];
      cardText: string;
    }
  | {
      phase: "result";
      cardId: string;
      cardTitle: string;
      sourceKind: string;
      cardText: string;
      result: UnpackResultPayload;
      turns: ChatTurn[];
    }
  | {
      phase: "error";
      cardId: string;
      cardTitle: string;
      reason: string;
      // Keep the prior result visible so a failed refine doesn't wipe the
      // user's working state.
      result: UnpackResultPayload | null;
      turns: ChatTurn[];
      cardText: string;
      sourceKind: string;
    };

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

type RefineMode = "refine" | "expand" | "constrain";

const RAIL_TOP = 96;
const RAIL_WIDTH = 384;

export function UnpackReasoningPanel({ spaceId, editor }: Props) {
  const open = usePanel("unpack");
  const [state, setState] = useState<State>({ phase: "closed" });

  // ── Lifecycle event wiring ──
  // STARTED / RESULT / FAILED carry the cardId so a stale result from a
  // canceled run gets dropped on the floor. The panel auto-opens on
  // STARTED so the user sees an immediate ack — no 15s of dead canvas.
  useEffect(() => {
    function onStarted(e: Event) {
      const d = (e as CustomEvent<UnpackStartedDetail>).detail;
      if (!d) return;
      // Pull the live card text once so chat turns can re-send context
      // without re-extracting. The shape may move/edit; that's fine —
      // we want the version that triggered THIS unpack.
      let cardText = d.cardTitle;
      try {
        const shape = editor.getShape(d.cardId as TLShapeId);
        const text = extractCardText(shape);
        if (text) cardText = text;
      } catch {
        /* defensive */
      }
      setState((prev) => {
        // If the user re-presses Unpack on the SAME card, keep the prior
        // result+turns visible while the new one loads (it's effectively
        // a refine). Different card → blank slate.
        if (
          prev.phase !== "closed" &&
          "cardId" in prev &&
          prev.cardId === d.cardId
        ) {
          return {
            phase: "running",
            cardId: d.cardId,
            cardTitle: d.cardTitle,
            sourceKind: d.sourceKind,
            // After the closed-guard above, every remaining state has both
            // result + turns (running carries them through; result/error
            // by definition).
            result: prev.result,
            turns: prev.turns,
            cardText,
          };
        }
        return {
          phase: "running",
          cardId: d.cardId,
          cardTitle: d.cardTitle,
          sourceKind: d.sourceKind,
          result: null,
          turns: [],
          cardText,
        };
      });
      setPanel("unpack", true);
    }
    function onResult(e: Event) {
      const d = (e as CustomEvent<UnpackResultDetail>).detail;
      if (!d) return;
      setState((prev) => {
        if (prev.phase === "closed") return prev;
        // Drop stale results that arrive after the user moved to another
        // card. Compare by cardId so refines on the same card update.
        if ("cardId" in prev && prev.cardId !== d.cardId) return prev;
        return {
          phase: "result",
          cardId: d.cardId,
          cardTitle:
            ("cardTitle" in prev && prev.cardTitle) ||
            d.cards[0]?.title ||
            "Unpack",
          sourceKind: "sourceKind" in prev ? prev.sourceKind : "",
          cardText: "cardText" in prev ? prev.cardText : "",
          result: {
            goal_frame: d.goal_frame,
            reasoning_log: d.reasoning_log,
            ranking: d.ranking,
            cards: d.cards,
            links: d.links,
          },
          turns: "turns" in prev ? prev.turns : [],
        };
      });
    }
    function onFailed(e: Event) {
      const d = (e as CustomEvent<UnpackFailedDetail>).detail;
      if (!d) return;
      setState((prev) => {
        if (prev.phase === "closed") return prev;
        if ("cardId" in prev && prev.cardId !== d.cardId) return prev;
        return {
          phase: "error",
          cardId: d.cardId,
          cardTitle: "cardTitle" in prev ? prev.cardTitle : "",
          reason: d.reason || "Unpack failed",
          result: "result" in prev ? prev.result : null,
          turns: "turns" in prev ? prev.turns : [],
          cardText: "cardText" in prev ? prev.cardText : "",
          sourceKind: "sourceKind" in prev ? prev.sourceKind : "",
        };
      });
    }
    window.addEventListener(UNPACK_STARTED_EVENT, onStarted);
    window.addEventListener(UNPACK_RESULT_EVENT, onResult);
    window.addEventListener(UNPACK_FAILED_EVENT, onFailed);
    return () => {
      window.removeEventListener(UNPACK_STARTED_EVENT, onStarted);
      window.removeEventListener(UNPACK_RESULT_EVENT, onResult);
      window.removeEventListener(UNPACK_FAILED_EVENT, onFailed);
    };
  }, [editor]);

  const handleClose = useCallback(() => {
    setPanel("unpack", false);
    // Keep the state (result + turns) so re-opening the panel restores
    // what the user was looking at. setState({ phase: "closed" }) would
    // wipe it.
  }, []);

  // Don't render anything when fully closed AND no prior state to restore.
  if (!open && state.phase === "closed") return null;

  return (
    <div
      style={{
        position: "fixed",
        top: RAIL_TOP,
        right: open ? 16 : -(RAIL_WIDTH + 32),
        bottom: 12,
        width: RAIL_WIDTH,
        zIndex: 92,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: appleVibe.radius.lg,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
        fontFamily: appleVibe.font.stack,
        transition: "right var(--dur-normal) var(--ease-spring-soft)",
      }}
    >
      <Header
        cardTitle={"cardTitle" in state ? state.cardTitle : ""}
        sourceKind={"sourceKind" in state ? state.sourceKind : ""}
        onClose={handleClose}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "12px 14px 4px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Body state={state} editor={editor} />
      </div>
      <ChatFooter
        state={state}
        spaceId={spaceId}
        editor={editor}
        setState={setState}
      />
    </div>
  );
}

// ── Header ──
function Header({
  cardTitle,
  sourceKind,
  onClose,
}: {
  cardTitle: string;
  sourceKind: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 14px 10px",
        borderBottom: "1px solid rgba(15,23,42,0.05)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 26,
          height: 26,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: "rgba(99,102,241,0.12)",
          color: "#6366F1",
          flexShrink: 0,
        }}
      >
        <Sparkles style={{ width: 14, height: 14 }} strokeWidth={2.4} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: appleVibe.text.tertiary,
          }}
        >
          Unpack · {sourceKind || "card"}
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 650,
            color: appleVibe.text.primary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {cardTitle || "Reasoning"}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 999,
          background: "transparent",
          color: appleVibe.text.tertiary,
          border: "none",
          cursor: "pointer",
        }}
      >
        <X style={{ width: 14, height: 14 }} strokeWidth={2.2} />
      </button>
    </div>
  );
}

// ── Body ──
function Body({ state, editor }: { state: State; editor: Editor }) {
  if (state.phase === "running" && !state.result) {
    return <RunningPlaceholder />;
  }
  if (state.phase === "error" && !state.result) {
    return (
      <ErrorBlock reason={(state as { reason: string }).reason} />
    );
  }
  // Either running-with-prior-result, result, or error-with-prior-result.
  const result = "result" in state ? state.result : null;
  if (!result) return null;
  const turns = "turns" in state ? state.turns : [];
  const phaseBadge =
    state.phase === "running" ? "Refining…" : state.phase === "error" ? "Failed" : null;
  return (
    <>
      {phaseBadge && <RefineBanner badge={phaseBadge} reason={
        state.phase === "error" ? (state as { reason: string }).reason : null
      } />}
      <GoalFrameBlock goal={result.goal_frame} />
      <ReasoningLogBlock log={result.reasoning_log} />
      <PrinciplesBlock result={result} editor={editor} />
      <RankingBlock ranking={result.ranking} cards={result.cards} />
      {turns.length > 0 && <TurnsBlock turns={turns} />}
    </>
  );
}

// ── Running placeholder ──
function RunningPlaceholder() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        gap: 10,
        color: appleVibe.text.tertiary,
        padding: "40px 0",
      }}
    >
      <Loader2
        className="animate-spin"
        style={{ width: 22, height: 22, color: appleVibe.accent.primary }}
        strokeWidth={2.4}
      />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary }}>
        Reasoning through the card…
      </span>
      <span style={{ fontSize: 11.5, textAlign: "center", maxWidth: 220 }}>
        Reading your micros, intake factors, and the parent objective. Opus
        is composing the principles + variations.
      </span>
    </div>
  );
}

function ErrorBlock({ reason }: { reason: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        gap: 10,
        padding: "40px 0",
      }}
    >
      <AlertTriangle
        style={{ width: 22, height: 22, color: "#DC2626" }}
        strokeWidth={2.4}
      />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: appleVibe.text.primary }}>
        Unpack failed
      </span>
      <span
        style={{
          fontSize: 11.5,
          color: appleVibe.text.tertiary,
          textAlign: "center",
          maxWidth: 260,
        }}
      >
        {reason}
      </span>
    </div>
  );
}

function RefineBanner({ badge, reason }: { badge: string; reason: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 10,
        background:
          badge === "Failed" ? "rgba(220,38,38,0.06)" : "rgba(99,102,241,0.06)",
        border: `1px solid ${
          badge === "Failed" ? "rgba(220,38,38,0.18)" : "rgba(99,102,241,0.18)"
        }`,
      }}
    >
      {badge === "Failed" ? (
        <AlertTriangle style={{ width: 12, height: 12, color: "#DC2626" }} strokeWidth={2.4} />
      ) : (
        <Loader2 className="animate-spin" style={{ width: 12, height: 12, color: "#6366F1" }} strokeWidth={2.4} />
      )}
      <span style={{ fontSize: 11.5, fontWeight: 650, color: appleVibe.text.primary }}>
        {badge}
      </span>
      {reason && (
        <span
          style={{
            fontSize: 11,
            color: appleVibe.text.tertiary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
          }}
          title={reason}
        >
          · {reason}
        </span>
      )}
    </div>
  );
}

// ── Goal frame block ──
function GoalFrameBlock({ goal }: { goal: { goal: string; evidence: string } }) {
  if (!goal.goal) return null;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.18)",
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 1.1,
          textTransform: "uppercase",
          color: "#6366F1",
        }}
      >
        Goal frame
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 650,
          color: appleVibe.text.primary,
          letterSpacing: "-0.01em",
          marginTop: 2,
        }}
      >
        {goal.goal}
      </div>
      {goal.evidence && (
        <div
          style={{
            fontSize: 11,
            color: appleVibe.text.tertiary,
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          {goal.evidence}
        </div>
      )}
    </div>
  );
}

// ── Reasoning log — fade-in line-by-line ──
function ReasoningLogBlock({ log }: { log: string[] }) {
  const [visibleCount, setVisibleCount] = useState(0);
  // Re-arm on a new log (refine path).
  useEffect(() => {
    setVisibleCount(0);
    if (!log.length) return;
    let i = 0;
    const tick = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= log.length) window.clearInterval(tick);
    }, 280);
    return () => window.clearInterval(tick);
  }, [log]);
  if (!log.length) return null;
  return (
    <div>
      <SectionLabel>Reasoning</SectionLabel>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        {log.map((line, i) => {
          const shown = i < visibleCount;
          return (
            <li
              key={i}
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
                color: appleVibe.text.secondary,
                paddingLeft: 12,
                position: "relative",
                opacity: shown ? 1 : 0,
                transform: shown ? "translateY(0)" : "translateY(4px)",
                transition: "opacity 220ms ease-out, transform 220ms ease-out",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: 6,
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: appleVibe.text.faint,
                }}
              />
              {line}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Principles + variations tree ──
function PrinciplesBlock({
  result,
  editor,
}: {
  result: UnpackResultPayload;
  editor: Editor;
}) {
  const principles = result.cards.filter((c) => c.kind === "first_principle");
  const variations = result.cards.filter((c) => c.kind === "variation");

  // Variations grouped by their first cited principle slug. Multi-principle
  // variations show under their FIRST parent (the strongest one); the rest
  // are referenced via the edges drawn on the board, which is the
  // canonical record of "this variation actually derives from these N".
  const variationsByPrinciple = useMemo(() => {
    const m = new Map<string, typeof variations>();
    for (const v of variations) {
      const parent = (v.from_principles ?? [])[0] ?? "_orphan";
      const arr = m.get(parent) ?? [];
      arr.push(v);
      m.set(parent, arr);
    }
    return m;
  }, [variations]);

  if (!principles.length && !variations.length) return null;

  return (
    <div>
      <SectionLabel>
        {principles.length} principle{principles.length === 1 ? "" : "s"} · {variations.length} variation{variations.length === 1 ? "" : "s"}
      </SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {principles.map((p) => (
          <PrincipleRow
            key={p.slug}
            principle={p}
            variations={variationsByPrinciple.get(p.slug) ?? []}
            editor={editor}
          />
        ))}
      </div>
    </div>
  );
}

function PrincipleRow({
  principle,
  variations,
  editor,
}: {
  principle: UnpackResultPayload["cards"][number];
  variations: UnpackResultPayload["cards"];
  editor: Editor;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.06)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.5)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        onDoubleClick={() => focusCardOnBoard(editor, principle.objectId)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "8px 10px",
          width: "100%",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
        }}
        title="Click to collapse · Double-click to focus on board"
      >
        <span
          style={{
            display: "inline-flex",
            width: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
            color: appleVibe.text.tertiary,
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {expanded ? (
            <ChevronDown style={{ width: 13, height: 13 }} strokeWidth={2.4} />
          ) : (
            <ChevronRight style={{ width: 13, height: 13 }} strokeWidth={2.4} />
          )}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: 1.1,
              textTransform: "uppercase",
              color: "#0EA5A4",
            }}
          >
            First principle
          </span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 650,
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
            }}
          >
            {principle.title}
          </span>
          <span
            style={{
              fontSize: 11,
              color: appleVibe.text.tertiary,
              lineHeight: 1.45,
            }}
          >
            {principle.body}
          </span>
          {principle.cites_factors && principle.cites_factors.length > 0 && (
            <ChipRow chips={principle.cites_factors} color="#6366F1" />
          )}
        </span>
      </button>
      {expanded && variations.length > 0 && (
        <div
          style={{
            paddingLeft: 26,
            paddingRight: 10,
            paddingBottom: 8,
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          {variations.map((v) => (
            <VariationRow key={v.slug} variation={v} editor={editor} />
          ))}
        </div>
      )}
    </div>
  );
}

function VariationRow({
  variation,
  editor,
}: {
  variation: UnpackResultPayload["cards"][number];
  editor: Editor;
}) {
  return (
    <button
      type="button"
      onClick={() => focusCardOnBoard(editor, variation.objectId)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "6px 8px",
        borderRadius: 7,
        background: "rgba(15,23,42,0.025)",
        border: "1px solid rgba(15,23,42,0.04)",
        textAlign: "left",
        cursor: "pointer",
      }}
      title="Click to focus on board"
    >
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 1.1,
          textTransform: "uppercase",
          color: "#F59E0B",
        }}
      >
        Variation
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: appleVibe.text.primary,
          letterSpacing: "-0.01em",
        }}
      >
        {variation.title}
      </span>
      <span
        style={{
          fontSize: 11,
          color: appleVibe.text.tertiary,
          lineHeight: 1.45,
        }}
      >
        {variation.body}
      </span>
      {variation.tradeoff && (
        <span
          style={{
            fontSize: 10.5,
            color: appleVibe.text.faint,
            lineHeight: 1.4,
            marginTop: 1,
          }}
        >
          ⇄ {variation.tradeoff}
        </span>
      )}
      {variation.optimizes_for && variation.optimizes_for.length > 0 && (
        <ChipRow chips={variation.optimizes_for} color="#F59E0B" />
      )}
    </button>
  );
}

function ChipRow({ chips, color }: { chips: string[]; color: string }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
      {chips.map((c) => (
        <span
          key={c}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 7px",
            borderRadius: 999,
            background: `${color}1f`,
            color,
            letterSpacing: 0.1,
          }}
        >
          {c}
        </span>
      ))}
    </span>
  );
}

function RankingBlock({
  ranking,
  cards,
}: {
  ranking: { slug: string; score: number; why: string }[];
  cards: UnpackResultPayload["cards"];
}) {
  if (!ranking.length) return null;
  const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
  return (
    <div>
      <SectionLabel>Ranking</SectionLabel>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {ranking.slice(0, 8).map((r) => {
          const card = cardBySlug.get(r.slug);
          return (
            <li
              key={r.slug}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 8px",
                background: "rgba(15,23,42,0.025)",
                borderRadius: 7,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: appleVibe.text.tertiary,
                  width: 28,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {Math.round(r.score)}
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: appleVibe.text.primary,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {card?.title ?? r.slug}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: appleVibe.text.tertiary,
                    lineHeight: 1.35,
                  }}
                >
                  {r.why}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TurnsBlock({ turns }: { turns: ChatTurn[] }) {
  return (
    <div>
      <SectionLabel>Chat</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {turns.map((t, i) => (
          <div
            key={i}
            style={{
              padding: "7px 9px",
              borderRadius: 9,
              background:
                t.role === "user"
                  ? "rgba(99,102,241,0.06)"
                  : "rgba(15,23,42,0.04)",
              border:
                t.role === "user"
                  ? "1px solid rgba(99,102,241,0.18)"
                  : "1px solid rgba(15,23,42,0.06)",
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: 1.1,
                textTransform: "uppercase",
                color: appleVibe.text.tertiary,
                marginBottom: 3,
              }}
            >
              {t.role === "user" ? "You" : "AI"}
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.4,
                color: appleVibe.text.primary,
                whiteSpace: "pre-wrap",
              }}
            >
              {t.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: appleVibe.text.faint,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

// ── Chat footer ──
//
// The refinement loop. Always-mode-refine for MVP; the route also accepts
// `expand` + `constrain` which we surface as one-click prefix buttons that
// pre-fill the input. The POST returns delta cards/links; the panel
// appends them to its local result AND fires UNPACK_REFINE_DEPLOY_EVENT
// so whiteboard-base extends the on-board cluster.
function ChatFooter({
  state,
  spaceId,
  editor: _editor,
  setState,
}: {
  state: State;
  spaceId: string;
  editor: Editor;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<RefineMode>("refine");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Disable when there's no result yet to refine against.
  const disabled =
    state.phase === "closed" ||
    (state.phase === "running" && !("result" in state ? state.result : null));

  async function submit() {
    if (disabled || busy) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    // `disabled` already short-circuits when phase==="closed"; TS narrows
    // state to running | result | error by this point. Just guard on
    // cardId presence.
    if (!("cardId" in state) || !state.cardId) return;
    setBusy(true);
    const userTurn: ChatTurn = { role: "user", text: trimmed };
    setState((prev) => {
      if (prev.phase === "closed") return prev;
      const prevTurns = "turns" in prev ? prev.turns : [];
      const prevResult = "result" in prev ? prev.result : null;
      return {
        phase: "running",
        cardId: prev.cardId,
        cardTitle: "cardTitle" in prev ? prev.cardTitle : "",
        sourceKind: "sourceKind" in prev ? prev.sourceKind : "",
        result: prevResult,
        turns: [...prevTurns, userTurn],
        cardText: "cardText" in prev ? prev.cardText : "",
      };
    });
    try {
      const res = await fetch(`/api/objective/${spaceId}/unpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:
            ("cardText" in state ? state.cardText : "") ||
            ("cardTitle" in state ? state.cardTitle : ""),
          cardId: state.cardId,
          sourceKind: "sourceKind" in state ? state.sourceKind : "",
          mode,
          priorTurns: [
            ...("turns" in state ? state.turns : []),
            userTurn,
          ].map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      if (!res.ok) {
        const why = `unpack refine failed (${res.status})`;
        setState((prev) => {
          if (prev.phase === "closed") return prev;
          return {
            phase: "error",
            cardId: prev.cardId,
            cardTitle: "cardTitle" in prev ? prev.cardTitle : "",
            reason: why,
            result: "result" in prev ? prev.result : null,
            turns: "turns" in prev ? prev.turns : [],
            cardText: "cardText" in prev ? prev.cardText : "",
            sourceKind: "sourceKind" in prev ? prev.sourceKind : "",
          };
        });
        return;
      }
      const json = (await res.json()) as UnpackResultPayload;
      // Merge delta into the panel's result. Cards/links are de-duped by
      // slug so a re-run that re-emits the same principle replaces it
      // (the route is idempotent on source_ref:slug too).
      setState((prev) => {
        if (prev.phase === "closed") return prev;
        const prior = "result" in prev ? prev.result : null;
        const mergedCards = prior
          ? mergeBySlug(prior.cards, json.cards)
          : json.cards;
        const mergedLinks = prior
          ? mergeLinks(prior.links, json.links)
          : json.links;
        return {
          phase: "result",
          cardId: prev.cardId,
          cardTitle: "cardTitle" in prev ? prev.cardTitle : "",
          sourceKind: "sourceKind" in prev ? prev.sourceKind : "",
          cardText: "cardText" in prev ? prev.cardText : "",
          result: {
            goal_frame: json.goal_frame ?? (prior?.goal_frame ?? { goal: "", evidence: "" }),
            reasoning_log: json.reasoning_log ?? [],
            ranking: json.ranking ?? [],
            cards: mergedCards,
            links: mergedLinks,
          },
          turns: [
            ...("turns" in prev ? prev.turns : []),
            {
              role: "assistant",
              text: summarizeAssistantTurn(json),
            },
          ],
        };
      });
      // Tell whiteboard-base to deploy the DELTA — just the cards/links
      // that weren't in the prior result. The deploy bridge keeps anchoring
      // to the same source shape so refinements extend the same cluster.
      if (typeof window !== "undefined") {
        const priorCards = (state as { result: UnpackResultPayload | null }).result?.cards ?? [];
        const priorLinks = (state as { result: UnpackResultPayload | null }).result?.links ?? [];
        const newCards = json.cards.filter(
          (c) => !priorCards.some((p) => p.slug === c.slug),
        );
        const newLinks = json.links.filter(
          (l) =>
            !priorLinks.some(
              (p) =>
                p.fromSlug === l.fromSlug &&
                p.toSlug === l.toSlug &&
                p.relation === l.relation,
            ),
        );
        if (newCards.length > 0) {
          try {
            window.dispatchEvent(
              new CustomEvent<UnpackRefineDeployDetail>(
                UNPACK_REFINE_DEPLOY_EVENT,
                {
                  detail: {
                    cardId: state.cardId,
                    deltaLabel:
                      mode === "expand"
                        ? "Expanded"
                        : mode === "constrain"
                          ? "Constrained"
                          : "Refined",
                    goal_frame: json.goal_frame,
                    reasoning_log: json.reasoning_log,
                    ranking: json.ranking,
                    cards: newCards,
                    links: newLinks,
                  },
                },
              ),
            );
          } catch {
            /* defensive */
          }
        }
      }
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: "10px 12px 12px",
        borderTop: "1px solid rgba(15,23,42,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {(["refine", "expand", "constrain"] as RefineMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              inputRef.current?.focus();
            }}
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 999,
              border: "1px solid",
              borderColor:
                m === mode ? "rgba(99,102,241,0.4)" : "rgba(15,23,42,0.1)",
              background:
                m === mode ? "rgba(99,102,241,0.08)" : "transparent",
              color: m === mode ? "#6366F1" : appleVibe.text.tertiary,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          padding: "6px 8px",
          borderRadius: 10,
          background: "rgba(15,23,42,0.03)",
          border: "1px solid rgba(15,23,42,0.06)",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || busy}
          placeholder={
            mode === "refine"
              ? "Tighten the set — e.g. drop weak variations, sharpen labels…"
              : mode === "expand"
                ? "Expand one item — e.g. expand p2 into 3 sub-variations…"
                : "Add a constraint — e.g. constrain to mobile-only…"
          }
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            background: "transparent",
            fontSize: 12,
            color: appleVibe.text.primary,
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
            lineHeight: 1.4,
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || busy || !input.trim()}
          aria-label="Send"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 999,
            background:
              !disabled && !busy && input.trim()
                ? appleVibe.accent.primary
                : "rgba(15,23,42,0.1)",
            color:
              !disabled && !busy && input.trim() ? "white" : appleVibe.text.faint,
            border: "none",
            cursor: !disabled && !busy && input.trim() ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          {busy ? (
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} strokeWidth={2.4} />
          ) : (
            <ArrowRight style={{ width: 14, height: 14 }} strokeWidth={2.6} />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──

/** Center the board on a library_object's tldraw card. */
function focusCardOnBoard(editor: Editor, objectId: string | null): void {
  if (!objectId) return;
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const meta = (s.meta ?? {}) as { objectId?: unknown };
      if (typeof meta.objectId === "string" && meta.objectId === objectId) {
        const b = editor.getShapePageBounds(s.id);
        if (b) {
          editor.select(s.id);
          editor.centerOnPoint(
            { x: b.midX, y: b.midY },
            { animation: { duration: 320 } },
          );
        }
        return;
      }
      // oc-cards carry objectId in props rather than meta.
      const props = (s.props ?? {}) as { objectId?: unknown };
      if (typeof props.objectId === "string" && props.objectId === objectId) {
        const b = editor.getShapePageBounds(s.id);
        if (b) {
          editor.select(s.id);
          editor.centerOnPoint(
            { x: b.midX, y: b.midY },
            { animation: { duration: 320 } },
          );
        }
        return;
      }
    }
  } catch {
    /* defensive */
  }
}

/** Pull the card's text out of whichever shape it is. Best-effort — used
 *  to populate the chat refinement's `text` field. */
function extractCardText(shape: { type?: string; props?: unknown } | undefined): string {
  if (!shape) return "";
  const p = (shape.props ?? {}) as Record<string, unknown>;
  const candidates = [p.title, p.name, p.text, p.body, p.subtitle];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 6000);
  }
  return "";
}

/** Merge two card arrays by slug — the second wins on collisions (the
 *  fresh result has the latest titles + rationales). */
function mergeBySlug(
  prior: UnpackResultPayload["cards"],
  next: UnpackResultPayload["cards"],
): UnpackResultPayload["cards"] {
  const m = new Map<string, UnpackResultPayload["cards"][number]>();
  for (const c of prior) m.set(c.slug, c);
  for (const c of next) m.set(c.slug, c);
  return Array.from(m.values());
}

function mergeLinks(
  prior: UnpackResultPayload["links"],
  next: UnpackResultPayload["links"],
): UnpackResultPayload["links"] {
  const key = (l: { fromSlug: string; toSlug: string; relation: string }) =>
    `${l.fromSlug}->${l.toSlug}:${l.relation}`;
  const m = new Map<string, UnpackResultPayload["links"][number]>();
  for (const l of prior) m.set(key(l), l);
  for (const l of next) m.set(key(l), l);
  return Array.from(m.values());
}

function summarizeAssistantTurn(json: UnpackResultPayload): string {
  const p = json.cards.filter((c) => c.kind === "first_principle").length;
  const v = json.cards.filter((c) => c.kind === "variation").length;
  const goal = json.goal_frame?.goal ? ` (${json.goal_frame.goal})` : "";
  return `Updated cluster${goal}: ${p} principle${p === 1 ? "" : "s"}, ${v} variation${v === 1 ? "" : "s"}.`;
}
