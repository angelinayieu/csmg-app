// ── Synergy AI rail (right side, 320px — Vision Pro chrome) ──
//
// Reads as a partner, not a control panel. From top to bottom:
//   1. AI Companion — context-aware "next move" suggestion that reads
//      the current board state (selected node, depth, what's been
//      explored) and proposes the highest-leverage augment to run now
//   2. Attach-target indicator — where the next idea will land
//   3. Mode actions — premium tile grid (Decompose, Questions,
//      Research) with subtle iconography and soft hover
//   4. Precision slider
//   5. Recent thoughts timeline
//   6. Last results per mode (rendered as glass cards, not dashed
//      borders)
//
// All glass surfaces route through the design tokens — no
// hand-rolled bg-white/80 anywhere.

"use client";

import {
  HelpCircle,
  Loader2,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trophy,
  Wand2,
} from "lucide-react";
import { SynergyPrecisionSlider } from "./synergy-precision-slider";
import { SynergyHistoryCard } from "./synergy-history-card";
import { SynergyAutopilotPanel } from "./synergy-autopilot-panel";
import type { AutopilotNewNode } from "@/hooks/synergy/use-autopilot";
import type {
  ClientNode,
  DecomposeResult,
  HistoryBucket,
  HistoryItem,
  NodeKind,
  ResearchDirection,
} from "@/lib/synergy/types";

interface Transcript {
  id: string;
  text: string;
  at: number;
}

interface Props {
  sessionId: string;

  selectedNode: ClientNode | null;
  seedNode: ClientNode | null;
  selectedHasVariations: boolean;
  precision: number;
  onPrecisionChange: (v: number) => void;

  transcripts: Transcript[];
  onClearTranscripts: () => void;

  aiBusy: string | null;
  onRunMode: (mode: "decompose" | "questions" | "research") => void;
  onRankSelected: () => void;

  decomp: DecomposeResult | null;
  questions: string[];
  research: ResearchDirection[];

  isPicked: (bucket: HistoryBucket, text: string) => boolean;
  onPick: (bucket: HistoryBucket, text: string, kind: NodeKind, meta?: string) => void;

  history: HistoryItem[];
  historyOpen: boolean;
  onToggleHistory: () => void;

  onAutopilotRound: (newNodes: AutopilotNewNode[]) => void;
}

export function SynergyAIRail({
  sessionId,
  selectedNode,
  seedNode,
  selectedHasVariations,
  precision,
  onPrecisionChange,
  transcripts,
  onClearTranscripts,
  aiBusy,
  onRunMode,
  onRankSelected,
  decomp,
  questions,
  research,
  isPicked,
  onPick,
  history,
  historyOpen,
  onToggleHistory,
  onAutopilotRound,
}: Props) {
  const showEmpty = !decomp && questions.length === 0 && research.length === 0;

  // Pick the highest-leverage next move based on what the user has
  // explored so far. The rail's "AI Companion" surface uses this to
  // recommend, not just list, what to run next.
  const nextMove = recommendNextMove({
    selectedNode,
    seedNode,
    decomp,
    questions,
    research,
    transcripts,
  });

  return (
    <aside
      className="flex w-80 flex-col gap-4 overflow-y-auto p-4"
      style={{
        background: "var(--glass-plate-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.6)",
        borderLeft: "1px solid var(--glass-hairline)",
        boxShadow: "inset 1px 0 0 var(--glass-highlight)",
      }}
    >
      <AICompanionCard
        nextMove={nextMove}
        busyMode={aiBusy}
        onRunMode={onRunMode}
      />

      <AttachTargetIndicator
        selectedNode={selectedNode}
        seedNode={seedNode}
        selectedHasVariations={selectedHasVariations}
        onRankSelected={onRankSelected}
      />

      {/* Precision slider — sits between WHERE/WHAT (above) and HOW
          (mode tiles below) as a calibration knob the user can rest
          their hand on while they think. */}
      <SynergyPrecisionSlider value={precision} onChange={onPrecisionChange} />

      {/* Mode tiles — premium replacement for the prior text-link row.
          Each tile carries an iconography that hints what it does, and
          the recommended mode lights up so the user's eye lands on it. */}
      <ModeTileRow
        busyMode={aiBusy}
        onRun={onRunMode}
        recommended={nextMove?.mode ?? null}
      />

      {transcripts.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span
              className="text-[11px] font-semibold tracking-[0.02em]"
              style={{ color: "rgba(15,23,42,0.55)" }}
            >
              Recent thoughts
            </span>
            <button
              onClick={onClearTranscripts}
              className="text-[10.5px] font-medium transition"
              style={{ color: "rgba(15,23,42,0.42)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "rgba(15,23,42,0.72)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "rgba(15,23,42,0.42)")
              }
            >
              clear
            </button>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {transcripts
              .slice()
              .reverse()
              .map((t) => (
                <li
                  key={t.id}
                  className="px-2.5 py-1.5 text-[11.5px] leading-snug"
                  style={{
                    background: "rgba(255,255,255,0.7)",
                    border: "1px solid var(--glass-hairline)",
                    borderRadius: 10,
                    color: "rgba(15,23,42,0.78)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                  }}
                >
                  {t.text}
                </li>
              ))}
          </ul>
        </section>
      )}

      {decomp && (
        <Section
          title="Decomposition"
          icon={Network}
          action={
            <RegenerateButton
              busy={aiBusy === "decompose"}
              onClick={() => onRunMode("decompose")}
            />
          }
        >
          <ClickableBucket
            label="Upstream (needs)"
            items={decomp.upstream.filter((it) => !isPicked("upstream", it))}
            dotColor="#0A84FF"
            onPick={(t) => onPick("upstream", t, "branch")}
          />
          <ClickableBucket
            label="Downstream (produces)"
            items={decomp.downstream.filter((it) => !isPicked("downstream", it))}
            dotColor="#10B981"
            onPick={(t) => onPick("downstream", t, "action")}
          />
          <ClickableBucket
            label="First principles"
            items={decomp.first_principles.filter(
              (it) => !isPicked("first_principles", it),
            )}
            dotColor="#A855F7"
            onPick={(t) => onPick("first_principles", t, "insight")}
          />
          <ClickableBucket
            label="Variations"
            items={decomp.variations.filter((it) => !isPicked("variations", it))}
            dotColor="#D946EF"
            onPick={(t) => onPick("variations", t, "variation")}
          />
        </Section>
      )}

      {questions.length > 0 && (
        <Section
          title="Sharper questions"
          icon={HelpCircle}
          action={
            <RegenerateButton
              busy={aiBusy === "questions"}
              onClick={() => onRunMode("questions")}
            />
          }
        >
          {questions.filter((q) => !isPicked("question", q)).length === 0 ? (
            <EmptyHint label="All questions added — regenerate for fresh ones." />
          ) : (
            <ul className="space-y-1.5">
              {questions
                .filter((q) => !isPicked("question", q))
                .map((q, i) => (
                  <li key={i}>
                    <PickButton onPick={() => onPick("question", q, "question")}>
                      {q}
                    </PickButton>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {research.length > 0 && (
        <Section
          title="Research directions"
          icon={Search}
          action={
            <RegenerateButton
              busy={aiBusy === "research"}
              onClick={() => onRunMode("research")}
            />
          }
        >
          {research.filter((r) => !isPicked("research", r.prompt)).length === 0 ? (
            <EmptyHint label="All directions added — regenerate for fresh ones." />
          ) : (
            <ul className="space-y-1.5">
              {research
                .filter((r) => !isPicked("research", r.prompt))
                .map((r, i) => (
                  <li
                    key={i}
                    className="p-3"
                    style={{
                      background: "rgba(255,255,255,0.78)",
                      border: "1px solid var(--glass-hairline)",
                      borderRadius: 12,
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                    }}
                  >
                    <div
                      className="mb-1 inline-block rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                      style={{
                        background: "rgba(10,132,255,0.10)",
                        color: "rgba(0,88,184,0.95)",
                      }}
                    >
                      {r.angle}
                    </div>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(r.prompt)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[12.5px] font-semibold leading-snug transition"
                      style={{ color: "rgba(15,23,42,0.92)" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.color = "rgba(0,88,184,0.95)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.color = "rgba(15,23,42,0.92)")
                      }
                    >
                      {r.prompt}
                    </a>
                    <p
                      className="mt-1 text-[11.5px] leading-snug"
                      style={{ color: "rgba(15,23,42,0.55)" }}
                    >
                      {r.why}
                    </p>
                    <button
                      onClick={() =>
                        onPick("research", r.prompt, "insight", `[${r.angle}] ${r.why}`)
                      }
                      className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition"
                      style={{
                        background: "rgba(15,23,42,0.04)",
                        color: "rgba(15,23,42,0.72)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(15,23,42,0.08)";
                        e.currentTarget.style.color = "rgba(15,23,42,0.92)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(15,23,42,0.04)";
                        e.currentTarget.style.color = "rgba(15,23,42,0.72)";
                      }}
                    >
                      <Plus className="h-3 w-3" strokeWidth={2.2} /> Add to board
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {showEmpty && <EmptyHero />}

      <SynergyHistoryCard
        history={history}
        open={historyOpen}
        onToggle={onToggleHistory}
        onPick={onPick}
      />

      <SynergyAutopilotPanel
        sessionId={sessionId}
        precision={precision}
        onRound={({ newNodes }) => onAutopilotRound(newNodes)}
      />
    </aside>
  );
}

// ── AI Companion — contextual next-move card ─────────────────────
//
// Reads the current board state and proposes the single highest-
// leverage augment to run right now. Reads as a quiet suggestion from
// a partner, not a sales banner.

type NextMove = {
  mode: "decompose" | "questions" | "research";
  copy: string;
  reason: string;
};

function recommendNextMove({
  selectedNode,
  seedNode,
  decomp,
  questions,
  research,
  transcripts,
}: {
  selectedNode: ClientNode | null;
  seedNode: ClientNode | null;
  decomp: DecomposeResult | null;
  questions: string[];
  research: ResearchDirection[];
  transcripts: Transcript[];
}): NextMove | null {
  const target = selectedNode ?? seedNode;
  if (!target) return null;

  // First-pass logic — heuristic, not ML. Picks the move that adds
  // the most-missing kind of thinking to the board.
  if (!decomp) {
    return {
      mode: "decompose",
      copy: `Decompose “${truncate(target.label, 28)}” into its parts`,
      reason: "You haven't broken this thought apart yet — start there.",
    };
  }
  if (questions.length === 0) {
    return {
      mode: "questions",
      copy: "Pull out sharper questions",
      reason: "What's still ambiguous? Surfacing questions opens the next layer.",
    };
  }
  if (research.length === 0) {
    return {
      mode: "research",
      copy: "Find directions to research",
      reason: "Ground the board in evidence — what would you need to look up?",
    };
  }
  // All three have run — recommend regenerating the thinnest area.
  // If the user has been talking, recommend Decompose on selection.
  if (transcripts.length > 3 && selectedNode && selectedNode.id !== seedNode?.id) {
    return {
      mode: "decompose",
      copy: `Decompose “${truncate(selectedNode.label, 24)}” specifically`,
      reason: "You've been speaking around this card — let me unpack it.",
    };
  }
  return null;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function AICompanionCard({
  nextMove,
  busyMode,
  onRunMode,
}: {
  nextMove: NextMove | null;
  busyMode: string | null;
  onRunMode: (mode: "decompose" | "questions" | "research") => void;
}) {
  if (!nextMove) {
    return (
      <div
        className="px-3.5 py-3"
        style={{
          background: "var(--glass-card-bg)",
          border: "1px solid var(--glass-hairline)",
          borderRadius: 14,
          boxShadow: "inset 0 1px 0 var(--glass-highlight)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 40%, rgba(10,132,255,0.20), rgba(124,58,237,0.10) 60%, transparent 80%)",
            }}
            aria-hidden
          >
            <Sparkles
              className="h-3 w-3"
              strokeWidth={1.75}
              style={{ color: "rgba(10,132,255,0.85)" }}
            />
          </span>
          <span
            className="text-[11px] font-semibold tracking-[0.02em]"
            style={{ color: "rgba(15,23,42,0.62)" }}
          >
            Companion
          </span>
        </div>
        <p
          className="mt-1.5 text-[12px] leading-snug"
          style={{ color: "rgba(15,23,42,0.62)" }}
        >
          Drop a thought on the board or speak one — I&apos;ll meet you there.
        </p>
      </div>
    );
  }

  const busy = busyMode === nextMove.mode;

  return (
    <div
      className="px-3.5 py-3"
      style={{
        background: "var(--glass-card-bg)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 14,
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 8px 22px -14px rgba(10,132,255,0.30)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, rgba(10,132,255,0.22), rgba(124,58,237,0.10) 60%, transparent 80%)",
          }}
          aria-hidden
        >
          <Sparkles
            className="h-3 w-3"
            strokeWidth={1.75}
            style={{ color: "rgba(10,132,255,0.92)" }}
          />
        </span>
        <span
          className="text-[11px] font-semibold tracking-[0.02em]"
          style={{ color: "rgba(15,23,42,0.62)" }}
        >
          Companion · next move
        </span>
      </div>
      <p
        className="mt-1.5 text-[12.5px] font-semibold leading-snug tracking-tight"
        style={{ color: "rgba(15,23,42,0.92)" }}
      >
        {nextMove.copy}
      </p>
      <p
        className="mt-0.5 text-[11.5px] leading-snug"
        style={{ color: "rgba(15,23,42,0.55)" }}
      >
        {nextMove.reason}
      </p>
      <button
        onClick={() => onRunMode(nextMove.mode)}
        disabled={busy}
        className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] active:scale-[0.97] disabled:cursor-wait"
        style={{
          background: busy
            ? "rgba(10,132,255,0.10)"
            : "linear-gradient(180deg, rgba(10,132,255,1) 0%, rgba(0,111,230,1) 100%)",
          color: busy ? "rgba(0,88,184,0.85)" : "white",
          boxShadow: busy
            ? "none"
            : "inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 16px -8px rgba(10,132,255,0.55)",
          letterSpacing: "-0.005em",
        }}
      >
        {busy ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.2} />
            Running…
          </>
        ) : (
          <>
            <Wand2 className="h-3 w-3" strokeWidth={2.2} />
            Run this
          </>
        )}
      </button>
    </div>
  );
}

// ── Attach-target indicator ──

function AttachTargetIndicator({
  selectedNode,
  seedNode,
  selectedHasVariations,
  onRankSelected,
}: {
  selectedNode: ClientNode | null;
  seedNode: ClientNode | null;
  selectedHasVariations: boolean;
  onRankSelected: () => void;
}) {
  const usingSelection = !!selectedNode;
  const usingSeed = !selectedNode && !!seedNode;
  const label = usingSelection
    ? selectedNode!.label
    : usingSeed
      ? seedNode!.label
      : "A new seed";
  const statusKey = usingSelection ? "Selected" : usingSeed ? "Seed" : "New";

  return (
    <div
      className="px-3.5 py-2.5"
      style={{
        background: "rgba(255,255,255,0.85)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 12,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10.5px] font-semibold tracking-[0.02em]"
          style={{ color: "rgba(15,23,42,0.55)" }}
        >
          Attaches under
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.04em]"
          style={{
            background: usingSelection
              ? "rgba(10,132,255,0.10)"
              : "rgba(15,23,42,0.05)",
            color: usingSelection
              ? "rgba(0,88,184,0.95)"
              : "rgba(15,23,42,0.55)",
          }}
        >
          {statusKey}
        </span>
      </div>
      <div
        className="mt-1 truncate text-[13px] font-semibold tracking-tight"
        style={{ color: "rgba(15,23,42,0.92)" }}
      >
        {label}
      </div>
      {usingSeed && (
        <p
          className="mt-1 text-[10.5px] leading-snug"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Tap a card on the canvas to attach under it.
        </p>
      )}
      {selectedHasVariations && (
        <button
          onClick={onRankSelected}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold transition"
          style={{
            background: "rgba(15,23,42,0.04)",
            color: "rgba(15,23,42,0.78)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(15,23,42,0.08)";
            e.currentTarget.style.color = "rgba(15,23,42,0.92)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(15,23,42,0.04)";
            e.currentTarget.style.color = "rgba(15,23,42,0.78)";
          }}
        >
          <Trophy className="h-3 w-3" strokeWidth={1.75} />
          Rank this node&apos;s variations
        </button>
      )}
    </div>
  );
}

// ── Mode tile row ──
// Premium replacement for the prior text-link "Decompose · Questions ·
// Research" row. Three pill-shaped tiles with subtle iconography. The
// recommended one carries a soft accent so the user's eye lands there.

function ModeTileRow({
  busyMode,
  onRun,
  recommended,
}: {
  busyMode: string | null;
  onRun: (mode: "decompose" | "questions" | "research") => void;
  recommended: "decompose" | "questions" | "research" | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <ModeTile
        label="Decompose"
        Icon={Network}
        busy={busyMode === "decompose"}
        highlighted={recommended === "decompose"}
        onClick={() => onRun("decompose")}
      />
      <ModeTile
        label="Questions"
        Icon={HelpCircle}
        busy={busyMode === "questions"}
        highlighted={recommended === "questions"}
        onClick={() => onRun("questions")}
      />
      <ModeTile
        label="Research"
        Icon={Search}
        busy={busyMode === "research"}
        highlighted={recommended === "research"}
        onClick={() => onRun("research")}
      />
    </div>
  );
}

function ModeTile({
  label,
  Icon,
  busy,
  highlighted,
  onClick,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  busy: boolean;
  highlighted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={`${label} — scoped to the current attach target`}
      className="group flex flex-col items-center justify-center gap-1.5 py-2.5 text-[10.5px] font-semibold transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
      style={{
        background: highlighted
          ? "linear-gradient(180deg, rgba(10,132,255,0.10) 0%, rgba(10,132,255,0.04) 100%)"
          : "rgba(255,255,255,0.7)",
        border: `1px solid ${highlighted ? "rgba(10,132,255,0.22)" : "var(--glass-hairline)"}`,
        color: highlighted ? "rgba(0,88,184,0.92)" : "rgba(15,23,42,0.72)",
        borderRadius: 12,
        boxShadow: highlighted
          ? "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 12px -6px rgba(10,132,255,0.35)"
          : "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
      onMouseEnter={(e) => {
        if (busy || highlighted) return;
        e.currentTarget.style.background = "rgba(255,255,255,0.95)";
        e.currentTarget.style.color = "rgba(15,23,42,0.92)";
      }}
      onMouseLeave={(e) => {
        if (busy || highlighted) return;
        e.currentTarget.style.background = "rgba(255,255,255,0.7)";
        e.currentTarget.style.color = "rgba(15,23,42,0.72)";
      }}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : (
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      )}
      {label}
    </button>
  );
}

// ── Section primitive ──

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="p-3"
      style={{
        background: "var(--glass-card-bg)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 14,
        boxShadow: "inset 0 1px 0 var(--glass-highlight)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-1.5 text-[12px] font-semibold tracking-tight"
          style={{ color: "rgba(15,23,42,0.92)" }}
        >
          <Icon
            className="h-3.5 w-3.5"
            strokeWidth={1.75}
          />
          {title}
        </div>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function RegenerateButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Regenerate with a fresh AI call"
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition disabled:opacity-60"
      style={{
        background: "rgba(15,23,42,0.04)",
        color: "rgba(15,23,42,0.62)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(15,23,42,0.08)";
        e.currentTarget.style.color = "rgba(15,23,42,0.92)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(15,23,42,0.04)";
        e.currentTarget.style.color = "rgba(15,23,42,0.62)";
      }}
    >
      {busy ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <RotateCcw className="h-2.5 w-2.5" strokeWidth={2} />
      )}
      regen
    </button>
  );
}

function ClickableBucket({
  label,
  items,
  dotColor,
  onPick,
}: {
  label: string;
  items: string[];
  dotColor: string;
  onPick: (text: string) => void;
}) {
  if (!items?.length) return null;
  return (
    <div>
      <div
        className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.02em]"
        style={{ color: "rgba(15,23,42,0.55)" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: dotColor }}
        />
        {label}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i}>
            <PickButton onPick={() => onPick(it)}>{it}</PickButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PickButton({
  onPick,
  children,
}: {
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onPick}
      className="group flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[12px] leading-snug transition"
      style={{
        background: "rgba(255,255,255,0.65)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 10,
        color: "rgba(15,23,42,0.85)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "white";
        e.currentTarget.style.borderColor = "rgba(10,132,255,0.25)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.65)";
        e.currentTarget.style.borderColor = "var(--glass-hairline)";
      }}
    >
      <Plus
        className="mt-0.5 h-3 w-3 shrink-0 transition"
        strokeWidth={2.2}
        style={{ color: "rgba(15,23,42,0.42)" }}
      />
      <span>{children}</span>
    </button>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <p
      className="px-3 py-2.5 text-center text-[11.5px]"
      style={{
        background: "rgba(255,255,255,0.5)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 10,
        color: "rgba(15,23,42,0.55)",
      }}
    >
      {label}
    </p>
  );
}

function EmptyHero() {
  return (
    <div
      className="px-5 py-6 text-center"
      style={{
        background: "rgba(255,255,255,0.55)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
      }}
    >
      <span
        className="mx-auto mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(10,132,255,0.18), rgba(124,58,237,0.08) 60%, transparent 80%)",
        }}
      >
        <Wand2
          className="h-4 w-4"
          strokeWidth={1.75}
          style={{ color: "rgba(10,132,255,0.92)" }}
        />
      </span>
      <p
        className="text-[12px] leading-snug"
        style={{ color: "rgba(15,23,42,0.62)" }}
      >
        Speak freely or run a mode above. Then tap any generated idea to
        land it onto the board.
      </p>
    </div>
  );
}
