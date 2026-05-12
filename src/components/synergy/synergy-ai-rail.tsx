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
    <aside className="flex w-80 flex-col gap-3 overflow-y-auto border-l border-gray-200 bg-white/80 p-4 backdrop-blur">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">AI augmentation</span>
        </div>
      </header>

      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-3 py-2 text-[11px] text-gray-600">
        {selectedNode ? (
          <>
            Adding to:{" "}
            <span className="font-medium text-gray-900">
              {selectedNode.label.slice(0, 40)}
            </span>
          </>
        ) : (
          <>
            Click any item below to drop it onto the board (linked to your
            seed). Select a node on the board to add under it.
          </>
        )}
        {selectedHasVariations && (
          <button
            onClick={onRankSelected}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-orange-100 px-2 py-1 text-orange-800 ring-1 ring-orange-200 hover:bg-orange-200"
          >
            <Trophy className="h-3 w-3" /> Rank this node&apos;s variations
          </button>
        )}
      </div>

      <SynergyPrecisionSlider value={precision} onChange={onPrecisionChange} />

      {transcripts.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-900">
              <Mic className="h-3.5 w-3.5 text-blue-600" /> Recent thoughts
            </div>
            <button
              onClick={onClearTranscripts}
              className="font-mono text-[9px] uppercase tracking-wider text-gray-500 transition hover:text-gray-900"
            >
              clear
            </button>
          </div>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {transcripts
              .slice()
              .reverse()
              .map((t) => (
                <li
                  key={t.id}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] leading-snug text-gray-700"
                >
                  {t.text}
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-3 gap-2">
        <AIBtn
          icon={Layers}
          label="Decompose"
          busy={aiBusy === "decompose"}
          onClick={() => onRunMode("decompose")}
        />
        <AIBtn
          icon={HelpCircle}
          label="Questions"
          busy={aiBusy === "questions"}
          onClick={() => onRunMode("questions")}
        />
        <AIBtn
          icon={Search}
          label="Research"
          busy={aiBusy === "research"}
          onClick={() => onRunMode("research")}
        />
      </div>

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
        defaultPrecision={precision}
        onRound={({ newNodes }) => onAutopilotRound(newNodes)}
      />
    </aside>
  );
}

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
