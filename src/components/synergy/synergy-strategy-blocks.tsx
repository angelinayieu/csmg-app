// ── Strategy block renderers (Phase 3.5e — living) ──
//
// Each block type ships:
//   1. A static read view
//   2. Hover-revealed AI ops that hit real endpoints (Expand, Challenge,
//      Find Evidence, Mitigate Further). Each op replaces the block in
//      parent state via onUpdate, or appends new blocks via onAppend.
//   3. Click-to-edit inline mode (textareas + Cmd+Enter to save / ESC
//      to cancel) for body + targeted meta fields.
//   4. Inline rendering of op-generated additions: sub_steps,
//      supporting_rationales, challenges, additional_mitigations, plus
//      a folded "Sources" group of any evidence blocks linked to this
//      block via meta.supports_block_id.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Beaker,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquareWarning,
  Pencil,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  challengeStrategyBlock,
  designTestForBlock,
  expandStrategyBlock,
  findEvidenceForBlock,
  mitigateStrategyBlock,
  updateStrategyBlock,
} from "@/lib/synergy/client";
import { getStepIcon, getStepMetadata } from "@/lib/synergy/step-icons";
import type {
  HypothesisMeta,
  PlanStepMeta,
  RiskMeta,
  SynergyStrategyBlock,
} from "@/lib/synergy/types";

// ── Shared types ──

export interface BlockCallbacks {
  onUpdate: (updated: SynergyStrategyBlock) => void;
  onAppendBlocks: (created: SynergyStrategyBlock[]) => void;
}

// ── Shared op-action row ──
//
// Each action renders a chip with optional busy state. The action's
// async fn is wrapped here so each chip can show its own spinner
// without lifting state into every block component.

type ActionDef = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  // The chip turns into a spinner while this resolves
  run: () => Promise<void>;
  // Optional: hide the chip rather than disable when not applicable
  hide?: boolean;
};

function BlockActions({ actions }: { actions: ActionDef[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const visible = actions.filter((a) => !a.hide);
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
      {visible.map((a) => (
        <button
          key={a.label}
          disabled={!!busy}
          onClick={async () => {
            if (busy) return;
            setBusy(a.label);
            try {
              await a.run();
            } catch (err) {
              toast.error(`${a.label} failed`, {
                description: (err as Error).message,
              });
            } finally {
              setBusy(null);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 transition hover:border-blue-400 hover:text-gray-900 disabled:opacity-60"
        >
          {busy === a.label ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <a.icon className="h-3 w-3" />
          )}
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ── Inline edit textarea ──
// Auto-resizes; Cmd+Enter saves; ESC cancels; click-out saves.

function EditTextarea({
  initialValue,
  onSave,
  onCancel,
  placeholder,
  rows = 2,
  className = "",
  multiline = true,
}: {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  multiline?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Auto-resize
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onSave(value.trim());
        } else if (!multiline && e.key === "Enter") {
          e.preventDefault();
          onSave(value.trim());
        }
      }}
      onBlur={() => {
        // Save on blur if value changed; else cancel
        if (value.trim() !== initialValue.trim()) onSave(value.trim());
        else onCancel();
      }}
      className={[
        "w-full resize-none rounded-md border border-blue-300 bg-white px-2 py-1.5 outline-none ring-2 ring-blue-100",
        className,
      ].join(" ")}
    />
  );
}

// ── Supporting evidence group ──
// When a plan_step / hypothesis / risk has linked evidence blocks
// (block_type='evidence', meta.supports_block_id === this block id),
// render them collapsed beneath the block with a "Sources (N)" toggle.

function SupportingEvidence({
  evidence,
}: {
  evidence: SynergyStrategyBlock[];
}) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500 transition hover:text-gray-900"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Sources ({evidence.length})
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {evidence.map((e) => {
            const m = e.meta as {
              source_title?: string;
              source_kind?: string;
              summary?: string;
              search_query?: string;
              url?: string;
            };
            const href = m.url
              ? m.url
              : m.search_query
                ? `https://www.google.com/search?q=${encodeURIComponent(m.search_query)}`
                : null;
            return (
              <li
                key={e.id}
                className="rounded-md border border-gray-200 bg-gray-50/60 px-2.5 py-1.5"
              >
                <div className="flex items-start gap-2">
                  <Search className="mt-0.5 h-3 w-3 shrink-0 text-gray-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-900 hover:text-blue-700"
                        >
                          {m.source_title || "Source"}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-[12px] font-semibold text-gray-900">
                          {m.source_title || "Source"}
                        </span>
                      )}
                      {m.source_kind && (
                        <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
                          {m.source_kind}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
                      {m.summary || e.body}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Challenges rendering ──
// In-place red-tinted callouts beneath the block.

const CHALLENGE_SEVERITY: Record<string, { bar: string; text: string }> = {
  high: { bar: "bg-rose-500", text: "text-rose-600" },
  medium: { bar: "bg-amber-500", text: "text-amber-600" },
  low: { bar: "bg-gray-300", text: "text-gray-500" },
};

function ChallengesGroup({
  challenges,
}: {
  challenges: Array<{ weakness: string; severity: string; suggestion: string }>;
}) {
  if (!challenges?.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {challenges.map((c, i) => {
        const tone =
          CHALLENGE_SEVERITY[c.severity] ?? CHALLENGE_SEVERITY.medium;
        return (
          <div
            key={i}
            className="relative overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-1.5 pl-3.5"
          >
            <span
              aria-hidden
              className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full ${tone.bar}`}
            />
            <div className="flex items-start gap-2">
              <MessageSquareWarning
                className={`mt-0.5 h-3 w-3 shrink-0 ${tone.text}`}
              />
              <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${tone.text}`}>
                    Challenge
                  </span>
                  <span
                    className={`font-mono text-[8px] uppercase tracking-[0.15em] ${tone.text}`}
                  >
                    {c.severity}
                  </span>
                </div>
                <p className="mt-0.5 text-gray-800">{c.weakness}</p>
                <p className="mt-0.5 italic text-gray-600">
                  → {c.suggestion}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Experiment card (renders inside HypothesisBlock when meta.experiment is set) ──

// Effort is a quiet dot+caps pair, not a colored pill. Hours = calm
// gray, weeks = warmer accent. Read as metadata.
const EFFORT_TONE: Record<string, string> = {
  hours: "bg-emerald-500",
  days: "bg-amber-500",
  weeks: "bg-rose-500",
};

function ExperimentCard({
  experiment,
}: {
  experiment: {
    title: string;
    design: string;
    steps: string[];
    success_signal: string;
    refute_signal: string;
    effort: string;
  };
}) {
  const effortDot = EFFORT_TONE[experiment.effort] ?? EFFORT_TONE.days;
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/40 p-3">
      <div className="mb-1 flex items-center gap-2">
        <Beaker className="h-3.5 w-3.5 text-gray-500" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          Experiment
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${effortDot}`} />
          {experiment.effort}
        </span>
      </div>
      <div className="text-[13px] font-semibold text-gray-900">
        {experiment.title}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
        {experiment.design}
      </p>
      {experiment.steps.length > 0 && (
        <ol className="mt-2 space-y-1 border-l border-gray-200 pl-3">
          {experiment.steps.map((s, i) => (
            <li
              key={i}
              className="text-[11.5px] leading-relaxed text-gray-700"
            >
              <span className="font-numerical mr-1 font-mono text-[10px] font-semibold tabular-nums text-gray-500">
                {String(i + 1).padStart(2, "0")}.
              </span>
              {s}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-1.5 pl-3.5">
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-emerald-500"
          />
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-emerald-600">
            supports if
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
            {experiment.success_signal}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-1.5 pl-3.5">
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-rose-500"
          />
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-rose-600">
            refutes if
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
            {experiment.refute_signal}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── plan_step ──

export function PlanStepBlock({
  block,
  index,
  supportingEvidence,
  onUpdate,
  onAppendBlocks,
}: {
  block: SynergyStrategyBlock;
  index: number;
  supportingEvidence: SynergyStrategyBlock[];
} & BlockCallbacks) {
  const meta = block.meta as PlanStepMeta & {
    sub_steps?: Array<{ title: string; detail: string }>;
    challenges?: Array<{
      weakness: string;
      severity: string;
      suggestion: string;
    }>;
  };
  const [editing, setEditing] = useState<null | "title" | "body">(null);
  // Tier 2c — progressive disclosure. Sub-steps, challenges, supporting
  // evidence, and the per-step AI actions are hidden by default so the
  // doc reads like a 5-step outline. Tap the chevron underneath the
  // body to reveal them all together. When the step has no detail yet
  // (fresh strategy, no expand/challenge/find-evidence runs yet), we
  // skip the chevron and show the action chips inline so the user can
  // trigger them without a wasted click.
  const [expanded, setExpanded] = useState(false);

  const saveTitle = async (next: string) => {
    setEditing(null);
    if (next === (meta.title ?? "")) return;
    try {
      const updated = await updateStrategyBlock(block.id, {
        meta_patch: { title: next },
      });
      onUpdate(updated);
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    }
  };

  const saveBody = async (next: string) => {
    setEditing(null);
    if (next === block.body) return;
    try {
      const updated = await updateStrategyBlock(block.id, { body: next });
      onUpdate(updated);
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    }
  };

  // ── Tier 2a + 2b: per-step icon + metadata pills ──
  // Rule-based classifier in @/lib/synergy/step-icons. Inferred from
  // the step's title + body — no LLM round trip, runs at render. If
  // we later add an LLM-tagged `category` field to PlanStepMeta this
  // becomes a fallback only.
  const StepIcon = getStepIcon(meta.title ?? "", block.body);
  const pills = getStepMetadata(block.body);

  return (
    // ── Step row ──
    // Apple-style restraint: drop the loud blue numbered circle for a
    // mono "STEP 0N" caps label + a small glyph tile that wears the
    // step's activity kind (calendar / book / users / code / radio).
    // The vertical connector becomes a faint dotted spine — present
    // enough to imply sequence, quiet enough not to compete with
    // content.
    <div className="group relative grid grid-cols-[24px_1fr] gap-4 pl-1 transition">
      {/* Dashed spine + icon tile — the line threads behind the tile
          on its way down to the next step. Mask fades the line near
          the bottom of the row so it softly hands off to the next. */}
      <div className="relative flex justify-center">
        <div
          aria-hidden
          className="absolute top-9 bottom-[-16px] w-px"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(15,23,42,0.16) 50%, transparent 50%)",
            backgroundSize: "1px 7px",
            backgroundRepeat: "repeat-y",
            maskImage:
              "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
          }}
        />
        {/* Glyph tile — 24×24 rounded square wearing the inferred icon.
            Subtle inset highlight + soft drop shadow gives it the
            "engraved chip" feel that visionOS controls use. */}
        <div
          className="relative z-10 mt-[2px] inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white text-gray-600 ring-1 ring-black/[0.06] transition group-hover:text-gray-900 group-hover:ring-black/[0.12]"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.04)",
          }}
        >
          <StepIcon className="h-3 w-3" />
        </div>
      </div>

      <div className="pb-5">
        {/* STEP 0N caps label — mono, very small, gray-400. Tells you
            sequence without making it the loudest pixel on the page. */}
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
          Step {String(index + 1).padStart(2, "0")}
        </div>

        {editing === "title" ? (
          <EditTextarea
            initialValue={meta.title ?? ""}
            onSave={saveTitle}
            onCancel={() => setEditing(null)}
            placeholder="Step title"
            multiline={false}
            rows={1}
            className="text-[16px] font-semibold leading-snug text-gray-900"
          />
        ) : (
          <div
            onClick={() => setEditing("title")}
            className="-mx-1 cursor-text rounded-md px-1 text-[16px] font-semibold leading-snug tracking-tight text-gray-900 transition hover:bg-black/[0.025]"
            title="Click to edit"
          >
            {meta.title || "Step"}
          </div>
        )}

        {/* Metadata pills — small mono caps badges (time/cadence/mode/
            tools) extracted from the body. Empty array hides entirely. */}
        {pills.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pills.map((pill, i) => {
              const PillIcon = pill.icon;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]"
                >
                  <PillIcon className="h-2.5 w-2.5" />
                  {pill.label}
                </span>
              );
            })}
          </div>
        )}

        {editing === "body" ? (
          <EditTextarea
            initialValue={block.body}
            onSave={saveBody}
            onCancel={() => setEditing(null)}
            placeholder="What does this step entail?"
            className="mt-2 text-[14px] leading-[1.6] text-gray-600"
          />
        ) : (
          <p
            onClick={() => setEditing("body")}
            className="-mx-1 mt-2 cursor-text rounded-md px-1 text-[14px] leading-[1.6] text-gray-600 transition hover:bg-black/[0.025]"
            title="Click to edit"
          >
            {block.body}
          </p>
        )}

        {/* ── Progressive disclosure (Tier 2c) ──
            Counts what's currently hidden. If the step has any
            sub-steps, challenges, or supporting evidence we show a
            quiet chevron link with a "what's behind it" label
            ("2 sub-steps · 1 challenge · 3 sources"). Tapping reveals
            everything inside an animated panel. If the step has none
            of those yet, we skip the chevron entirely and surface the
            action chips inline — the actions are how the user GETS
            content, so hiding them when there's nothing else here
            would be a usability foot-gun. */}
        {(() => {
          const subStepCount = meta.sub_steps?.length ?? 0;
          const challengeCount = meta.challenges?.length ?? 0;
          const evidenceCount = supportingEvidence.length;
          const hasDetail =
            subStepCount + challengeCount + evidenceCount > 0;

          const actions = (
            <BlockActions
              actions={[
                {
                  icon: Maximize2,
                  label: meta.sub_steps?.length ? "Re-expand" : "Expand",
                  run: async () => {
                    const updated = await expandStrategyBlock(block.id);
                    onUpdate(updated);
                    toast.success("Expanded into sub-steps");
                  },
                },
                {
                  icon: Search,
                  label: "Find evidence",
                  run: async () => {
                    const created = await findEvidenceForBlock(block.id);
                    onAppendBlocks(created);
                    toast.success(`Found ${created.length} sources`);
                  },
                },
                {
                  icon: MessageSquareWarning,
                  label: meta.challenges?.length ? "Re-challenge" : "Challenge",
                  run: async () => {
                    const updated = await challengeStrategyBlock(block.id);
                    onUpdate(updated);
                    toast.success("Challenges surfaced");
                  },
                },
                {
                  icon: Pencil,
                  label: "Edit",
                  run: async () => {
                    setEditing("body");
                  },
                },
              ]}
            />
          );

          // ── No detail yet — actions live inline ──
          if (!hasDetail) {
            return <div className="mt-3">{actions}</div>;
          }

          // ── Has detail — render chevron + collapsible panel ──
          const counterParts: string[] = [];
          if (subStepCount > 0) {
            counterParts.push(
              `${subStepCount} sub-step${subStepCount === 1 ? "" : "s"}`,
            );
          }
          if (challengeCount > 0) {
            counterParts.push(
              `${challengeCount} challenge${challengeCount === 1 ? "" : "s"}`,
            );
          }
          if (evidenceCount > 0) {
            counterParts.push(
              `${evidenceCount} source${evidenceCount === 1 ? "" : "s"}`,
            );
          }
          const counterLabel = counterParts.join(" · ");

          return (
            <>
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-gray-500 transition hover:bg-black/[0.03] hover:text-gray-900"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  strokeWidth={1.75}
                />
                {expanded ? "Hide details" : counterLabel}
              </button>

              {/* Grid-rows height animation — no JS lib needed. The
                  inner overflow-hidden div is what visually clips
                  the content while the grid row collapses 0fr → 1fr. */}
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{
                  gridTemplateRows: expanded ? "1fr" : "0fr",
                }}
                aria-hidden={!expanded}
              >
                <div className="overflow-hidden">
                  {subStepCount > 0 && (
                    <ul className="mt-3 space-y-1.5 border-l border-gray-200 pl-3">
                      {meta.sub_steps!.map((s, i) => (
                        <li key={i} className="text-[12px] leading-relaxed">
                          <div className="font-semibold text-gray-800">
                            {s.title}
                          </div>
                          <div className="text-gray-600">{s.detail}</div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <ChallengesGroup challenges={meta.challenges ?? []} />
                  <SupportingEvidence evidence={supportingEvidence} />

                  <div className="mt-3">{actions}</div>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── risk ──

// Severity is signaled by a 3px left-edge accent bar plus colored
// mono caps text, not by a wash of color across the whole card. This
// keeps the page calm — the eye can scan severity at a glance via
// the bar, but the card itself reads as content, not alarm.
const RISK_SEVERITY_TONE: Record<
  string,
  { bar: string; text: string }
> = {
  high: { bar: "bg-rose-500", text: "text-rose-600" },
  medium: { bar: "bg-amber-500", text: "text-amber-600" },
  low: { bar: "bg-gray-300", text: "text-gray-500" },
};

// Mitigation kind reads as a small lowercase tag — the kind itself
// (prevent / detect / respond) is information, not visual hierarchy.
const MITIGATION_KIND_TONE: Record<string, string> = {
  prevent: "text-blue-600",
  detect: "text-purple-600",
  respond: "text-emerald-600",
};

export function RiskBlock({
  block,
  supportingEvidence,
  onUpdate,
  onAppendBlocks,
}: {
  block: SynergyStrategyBlock;
  supportingEvidence: SynergyStrategyBlock[];
} & BlockCallbacks) {
  const meta = block.meta as RiskMeta & {
    additional_mitigations?: Array<{ tactic: string; kind: string }>;
    challenges?: never;
  };
  const tone = RISK_SEVERITY_TONE[meta.severity ?? "medium"] ?? RISK_SEVERITY_TONE.medium;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<null | "title" | "body" | "mitigation">(null);

  const save = async (
    field: "title" | "body" | "mitigation",
    value: string,
  ) => {
    setEditing(null);
    if (
      (field === "title" && value === (meta.title ?? "")) ||
      (field === "body" && value === block.body) ||
      (field === "mitigation" && value === (meta.mitigation ?? ""))
    ) {
      return;
    }
    try {
      const updated =
        field === "body"
          ? await updateStrategyBlock(block.id, { body: value })
          : await updateStrategyBlock(block.id, {
              meta_patch: { [field]: value },
            });
      onUpdate(updated);
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-3 pl-4 transition hover:border-gray-300">
      {/* Severity accent bar — the only color the card carries. */}
      <span
        aria-hidden
        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${tone.bar}`}
      />
      <div className="flex items-start gap-2">
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editing === "title" ? (
              <EditTextarea
                initialValue={meta.title ?? ""}
                onSave={(v) => save("title", v)}
                onCancel={() => setEditing(null)}
                placeholder="Risk title"
                multiline={false}
                rows={1}
                className="font-semibold"
              />
            ) : (
              <div
                onClick={() => setEditing("title")}
                className="cursor-text rounded font-semibold text-gray-900 transition hover:bg-gray-50"
                title="Click to edit"
              >
                {meta.title || "Risk"}
              </div>
            )}
            <span
              className={`font-mono text-[9px] uppercase tracking-[0.15em] ${tone.text}`}
            >
              {meta.severity ?? "medium"}
            </span>
          </div>
          {editing === "body" ? (
            <EditTextarea
              initialValue={block.body}
              onSave={(v) => save("body", v)}
              onCancel={() => setEditing(null)}
              className="mt-1 text-[12px] leading-relaxed text-gray-700"
            />
          ) : (
            <p
              onClick={() => setEditing("body")}
              className="mt-1 cursor-text rounded text-[12px] leading-relaxed text-gray-700 transition hover:bg-gray-50"
              title="Click to edit"
            >
              {block.body}
            </p>
          )}

          {meta.mitigation && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-gray-500 transition hover:text-gray-900"
            >
              <ShieldCheck className="h-3 w-3" />
              {open ? "Hide mitigation" : "Show mitigation"}
            </button>
          )}
          {open && meta.mitigation && (
            <div className="mt-1.5">
              {editing === "mitigation" ? (
                <EditTextarea
                  initialValue={meta.mitigation}
                  onSave={(v) => save("mitigation", v)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <p
                  onClick={() => setEditing("mitigation")}
                  className="cursor-text rounded bg-gray-50 p-2 text-[12px] leading-relaxed text-gray-800 transition hover:bg-gray-100"
                  title="Click to edit"
                >
                  {meta.mitigation}
                </p>
              )}
            </div>
          )}

          {meta.additional_mitigations && meta.additional_mitigations.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-gray-500">
                Further mitigations
              </div>
              <ul className="space-y-1">
                {meta.additional_mitigations.map((m, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md bg-gray-50 px-2 py-1"
                  >
                    <span
                      className={`shrink-0 font-mono text-[8px] uppercase tracking-[0.15em] ${MITIGATION_KIND_TONE[m.kind] ?? "text-gray-500"}`}
                    >
                      {m.kind}
                    </span>
                    <span className="text-[12px] leading-relaxed text-gray-800">
                      {m.tactic}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <SupportingEvidence evidence={supportingEvidence} />

          <BlockActions
            actions={[
              {
                icon: Search,
                label: "Research",
                run: async () => {
                  const created = await findEvidenceForBlock(block.id);
                  onAppendBlocks(created);
                  toast.success(`Found ${created.length} sources`);
                },
              },
              {
                icon: ShieldCheck,
                label: meta.additional_mitigations?.length
                  ? "More mitigations"
                  : "Mitigate further",
                run: async () => {
                  const updated = await mitigateStrategyBlock(block.id);
                  onUpdate(updated);
                  toast.success("Additional mitigations added");
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

// ── hypothesis ──

export function HypothesisBlock({
  block,
  supportingEvidence,
  onUpdate,
  onAppendBlocks,
}: {
  block: SynergyStrategyBlock;
  supportingEvidence: SynergyStrategyBlock[];
} & BlockCallbacks) {
  const meta = block.meta as HypothesisMeta & {
    supporting_rationales?: string[];
    challenges?: Array<{ weakness: string; severity: string; suggestion: string }>;
    experiment?: {
      title: string;
      design: string;
      steps: string[];
      success_signal: string;
      refute_signal: string;
      effort: "hours" | "days" | "weeks";
    };
  };
  const [editing, setEditing] = useState<null | "body" | "rationale">(null);

  const save = async (field: "body" | "rationale", value: string) => {
    setEditing(null);
    if (
      (field === "body" && value === block.body) ||
      (field === "rationale" && value === (meta.rationale ?? ""))
    ) {
      return;
    }
    try {
      const updated =
        field === "body"
          ? await updateStrategyBlock(block.id, { body: value })
          : await updateStrategyBlock(block.id, {
              meta_patch: { rationale: value },
            });
      onUpdate(updated);
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-3 pl-4 transition hover:border-gray-300">
      {/* Hairline left rule — quiet hypothesis accent. */}
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-gray-300"
      />
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
        <div className="min-w-0 flex-1">
          {editing === "body" ? (
            <EditTextarea
              initialValue={block.body}
              onSave={(v) => save("body", v)}
              onCancel={() => setEditing(null)}
              className="font-semibold text-gray-900"
            />
          ) : (
            <div
              onClick={() => setEditing("body")}
              className="cursor-text rounded font-semibold text-gray-900 transition hover:bg-gray-50"
              title="Click to edit"
            >
              {block.body}
            </div>
          )}

          <div className="mt-1 text-[12px] leading-relaxed text-gray-700">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
              why
            </span>{" "}
            {editing === "rationale" ? (
              <EditTextarea
                initialValue={meta.rationale ?? ""}
                onSave={(v) => save("rationale", v)}
                onCancel={() => setEditing(null)}
                className="mt-0.5"
              />
            ) : (
              <span
                onClick={() => setEditing("rationale")}
                className="cursor-text rounded transition hover:bg-gray-50"
                title="Click to edit"
              >
                {meta.rationale || "(no rationale)"}
              </span>
            )}
          </div>

          {meta.supporting_rationales && meta.supporting_rationales.length > 0 && (
            <ul className="mt-2 space-y-1 border-l border-gray-200 pl-3">
              {meta.supporting_rationales.map((r, i) => (
                <li key={i} className="text-[12px] leading-relaxed text-gray-700">
                  {r}
                </li>
              ))}
            </ul>
          )}

          {meta.evidence_status && (
            <span className="mt-2 inline-block rounded-full bg-gray-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
              {meta.evidence_status}
            </span>
          )}

          <ChallengesGroup challenges={meta.challenges ?? []} />
          {meta.experiment && <ExperimentCard experiment={meta.experiment} />}
          <SupportingEvidence evidence={supportingEvidence} />

          <BlockActions
            actions={[
              {
                icon: Maximize2,
                label: meta.supporting_rationales?.length
                  ? "Re-deepen"
                  : "Deepen",
                run: async () => {
                  const updated = await expandStrategyBlock(block.id);
                  onUpdate(updated);
                  toast.success("Rationales deepened");
                },
              },
              {
                icon: Search,
                label: "Find evidence",
                run: async () => {
                  const created = await findEvidenceForBlock(block.id);
                  onAppendBlocks(created);
                  toast.success(`Found ${created.length} sources`);
                },
              },
              {
                icon: Beaker,
                label: meta.experiment ? "Redesign test" : "Design test",
                run: async () => {
                  const updated = await designTestForBlock(block.id);
                  onUpdate(updated);
                  toast.success("Experiment designed");
                },
              },
              {
                icon: MessageSquareWarning,
                label: meta.challenges?.length ? "Re-challenge" : "Challenge",
                run: async () => {
                  const updated = await challengeStrategyBlock(block.id);
                  onUpdate(updated);
                  toast.success("Challenges surfaced");
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

// ── evidence (standalone block — also rendered inline under source blocks) ──

export function EvidenceBlock({ block }: { block: SynergyStrategyBlock }) {
  const meta = block.meta as {
    source_title?: string;
    url?: string;
    summary?: string;
    source_kind?: string;
    search_query?: string;
  };
  const href = meta.url
    ? meta.url
    : meta.search_query
      ? `https://www.google.com/search?q=${encodeURIComponent(meta.search_query)}`
      : null;
  return (
    <div className="group rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-900 hover:text-blue-700"
              >
                {meta.source_title || "Source"}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <div className="text-[12px] font-semibold text-gray-900">
                {meta.source_title || "Source"}
              </div>
            )}
            {meta.source_kind && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
                {meta.source_kind}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
            {meta.summary || block.body}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── note (free-form) ──

export function NoteBlock({
  block,
  onUpdate,
}: {
  block: SynergyStrategyBlock;
} & Pick<BlockCallbacks, "onUpdate">) {
  const [editing, setEditing] = useState(false);
  const save = async (value: string) => {
    setEditing(false);
    if (value === block.body) return;
    try {
      const updated = await updateStrategyBlock(block.id, { body: value });
      onUpdate(updated);
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    }
  };
  return (
    <div className="group rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2">
      {editing ? (
        <EditTextarea
          initialValue={block.body}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="cursor-text text-[13px] leading-relaxed text-gray-800"
          title="Click to edit"
        >
          {block.body}
        </p>
      )}
    </div>
  );
}

// Export Check icon for callers that need it without re-importing lucide
export { Check };
