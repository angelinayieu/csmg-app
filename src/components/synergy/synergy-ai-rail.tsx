// ── Synergy AI rail (right side, 320px) ──
//
// Stitches together:
//   - "Adding to" status (which node a clicked suggestion will attach to)
//   - Inline "Rank this node's variations" CTA when applicable
//   - Precision slider
//   - Recent thoughts timeline (transcripts)
//   - 3-up mode buttons: Decompose / Questions / Research
//   - Conditional sections for each mode's last results
//   - History card (collapsible)
//
// All state lives in the parent SynergyWhiteboard — this component is
// pure presentation + callbacks.

"use client";

import {
  HelpCircle,
  Layers,
  Loader2,
  Mic,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Target,
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
  // The board's "seed" node (kind === "core") — used as the fallback
  // attach target when nothing is selected. Surfaced in the
  // "Will attach under" indicator so the user knows where the (+)
  // suggestion will land without guessing.
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

  return (
    <aside
      className="flex w-80 flex-col gap-4 overflow-y-auto p-4"
      style={{
        // Apple-style translucent sidebar (NSVisualEffectView analog).
        // Page content blurred through; subtle hairline left border.
        background: "rgba(252, 252, 253, 0.78)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderLeft: "1px solid rgba(0, 0, 0, 0.06)",
      }}
    >
      {/* No "AI augmentation" title bar — the sidebar just IS the AI
          surface. Apple sidebars don't announce themselves. */}

      <AttachTargetIndicator
        selectedNode={selectedNode}
        seedNode={seedNode}
        selectedHasVariations={selectedHasVariations}
        onRankSelected={onRankSelected}
      />

      <SynergyPrecisionSlider value={precision} onChange={onPrecisionChange} />

      {/* Thin separator before the action surface */}
      <div className="h-px w-full bg-black/5" />

      {/* The mode actions: text-link row, not button grid. Apple-style —
          the command bar (which lives in the parent voice dock) is the
          primary surface; these are quick shortcuts. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-gray-700">
        <ModeLink
          label="Decompose"
          busy={aiBusy === "decompose"}
          onClick={() => onRunMode("decompose")}
        />
        <span className="text-gray-300" aria-hidden>·</span>
        <ModeLink
          label="Questions"
          busy={aiBusy === "questions"}
          onClick={() => onRunMode("questions")}
        />
        <span className="text-gray-300" aria-hidden>·</span>
        <ModeLink
          label="Research"
          busy={aiBusy === "research"}
          onClick={() => onRunMode("research")}
        />
      </div>

      {transcripts.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              Recent thoughts
            </span>
            <button
              onClick={onClearTranscripts}
              className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-400 transition hover:text-gray-700"
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
                  className="rounded-md bg-white px-2 py-1.5 text-[11px] leading-snug text-gray-700"
                  style={{
                    boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.04)",
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
            dot="bg-blue-500"
            onPick={(t) => onPick("upstream", t, "branch")}
          />
          <ClickableBucket
            label="Downstream (produces)"
            items={decomp.downstream.filter((it) => !isPicked("downstream", it))}
            dot="bg-emerald-500"
            onPick={(t) => onPick("downstream", t, "action")}
          />
          <ClickableBucket
            label="First principles"
            items={decomp.first_principles.filter(
              (it) => !isPicked("first_principles", it),
            )}
            dot="bg-purple-500"
            onPick={(t) => onPick("first_principles", t, "insight")}
          />
          <ClickableBucket
            label="Variations"
            items={decomp.variations.filter((it) => !isPicked("variations", it))}
            dot="bg-fuchsia-500"
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
            <p className="rounded-md border border-dashed border-gray-300 bg-gray-50/60 p-3 text-center text-[11px] text-gray-500">
              All questions added — regenerate for fresh ones.
            </p>
          ) : (
            <ul className="space-y-2">
              {questions
                .filter((q) => !isPicked("question", q))
                .map((q, i) => (
                  <li key={i}>
                    <button
                      onClick={() => onPick("question", q, "question")}
                      className="group flex w-full items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs leading-relaxed text-gray-900 transition hover:border-blue-400 hover:bg-blue-50/30"
                    >
                      <Plus className="mt-0.5 h-3 w-3 shrink-0 text-gray-400 transition group-hover:text-blue-600" />
                      <span>{q}</span>
                    </button>
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
            <p className="rounded-md border border-dashed border-gray-300 bg-gray-50/60 p-3 text-center text-[11px] text-gray-500">
              All directions added — regenerate for fresh ones.
            </p>
          ) : (
            <ul className="space-y-2">
              {research
                .filter((r) => !isPicked("research", r.prompt))
                .map((r, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="mb-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
                      {r.angle}
                    </div>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(r.prompt)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-xs font-medium text-gray-900 hover:text-blue-700"
                    >
                      {r.prompt}
                    </a>
                    <p className="mt-1 text-[11px] text-gray-600">{r.why}</p>
                    <button
                      onClick={() =>
                        onPick("research", r.prompt, "insight", `[${r.angle}] ${r.why}`)
                      }
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[10px] text-gray-600 hover:border-blue-400 hover:text-gray-900"
                    >
                      <Plus className="h-3 w-3" /> Add to board
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {showEmpty && (
        <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-xs text-gray-500">
          <Wand2 className="mx-auto mb-2 h-5 w-5 text-blue-600" />
          Speak freely or run a mode above. Then click any generated idea to
          add it onto the board.
        </div>
      )}

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

// ── Attach-target indicator ──
//
// Always-visible status line that shows where the (+) suggestions in
// the rail buckets WILL land if clicked right now. Three cases:
//   1. A node is selected on the canvas → "Will attach under: [label]"
//      (the suggestion becomes a child of that card)
//   2. Nothing selected, seed exists → "Will attach under: [seed label]
//      (seed)" with a distinct "seed" tag (it's the central node)
//   3. No nodes at all → "Will create a new seed" (the (+) creates a
//      fresh core node and attaches the suggestion under it — see
//      addNodeFromPanel's empty-board branch in synergy-whiteboard.tsx)
//
// This replaces the prior bipolar "Adding to: X" / long-paragraph
// hint that obscured which fallback was in effect.
// ── Attach-target indicator (Apple-style soft card) ──
//
// Replaces the prior dashed-border noisy treatment with a soft white
// card. No icon color tint, no boxed badges — the source of truth is
// the label itself, with a mono-cap status line above. Subtle inner
// shadow for depth (no full border).

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
  const usingSeed = !selectedNode && !!seedNode;
  const usingSelection = !!selectedNode;
  const empty = !selectedNode && !seedNode;

  const label = usingSelection
    ? selectedNode!.label
    : usingSeed
      ? seedNode!.label
      : "A new seed";
  const statusKey = usingSelection
    ? "Selected card"
    : usingSeed
      ? "Seed · fallback"
      : "New";

  return (
    <div
      className="rounded-xl bg-white px-3 py-2.5"
      style={{
        boxShadow:
          "0 0 0 1px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
          Will attach under
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-400">
          {statusKey}
        </span>
      </div>
      <div className="mt-1 truncate text-[13px] font-medium text-gray-900">
        {label}
      </div>
      {usingSeed && (
        <p className="mt-1 text-[10.5px] leading-snug text-gray-500">
          Select a card on the canvas to attach under it instead.
        </p>
      )}
      {selectedHasVariations && (
        <button
          onClick={onRankSelected}
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 transition hover:text-gray-900"
        >
          <Trophy className="h-3 w-3" strokeWidth={1.5} />
          Rank this node&apos;s variations
        </button>
      )}
    </div>
  );
}

// ── ModeLink: text-link AI action ──
//
// Apple-style restraint — Decompose / Questions / Research are
// inline text links, not button cards. Underline on hover, spinner
// inline when busy. Used in the rail header row above the
// suggestion buckets.

function ModeLink({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="group inline-flex items-center gap-1 font-medium text-gray-700 transition hover:text-gray-900 disabled:opacity-60"
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />}
      <span className="underline-offset-4 group-hover:underline">{label}</span>
    </button>
  );
}

// Below: AIBtn / Section / RegenerateButton / ClickableBucket helpers
// used by the main rail above.

function AIBtn({
  icon: Icon,
  label,
  busy,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white p-2.5 text-[10px] font-medium text-gray-700 transition hover:border-blue-400 hover:bg-blue-50/30 hover:text-gray-900 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-900">
          <Icon className="h-3.5 w-3.5 text-blue-600" />
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
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600 transition hover:border-blue-400 hover:text-gray-900 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <RotateCcw className="h-2.5 w-2.5" />
      )}
      regen
    </button>
  );
}

function ClickableBucket({
  label,
  items,
  dot,
  onPick,
}: {
  label: string;
  items: string[];
  dot: string;
  onPick: (text: string) => void;
}) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i}>
            <button
              onClick={() => onPick(it)}
              className="group flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-[11px] leading-snug text-gray-800 transition hover:bg-white"
            >
              <Plus className="mt-0.5 h-3 w-3 shrink-0 text-gray-400 transition group-hover:text-blue-600" />
              <span>{it}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
