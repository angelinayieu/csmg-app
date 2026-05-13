// ── Synergy Strategy Doc — main composition ──
//
// The converged endpoint of a brainstorm. Renders a single-column doc
// (max-width 720) with sections:
//   - Statement (the decisive one-liner)
//   - Pitch (elevator-pitch reframe)
//   - The Plan (numbered plan_step blocks)
//   - Upstream (brainstorm_components rows, kind = upstream)
//   - Downstream (brainstorm_components rows, kind = downstream)
//   - Risks (risk blocks)
//   - Hypotheses (hypothesis blocks)
//   - Collaborators (Phase 4 placeholder)
//
// Streaming feel: on first generation, sections fade-in with a
// stagger so the user feels the strategy crystallize. No real SSE —
// the LLM call returns a complete doc, the client orchestrates the
// reveal cascade with CSS animation delays.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Edit3,
  Loader2,
  Megaphone,
  RefreshCw,
  Share2,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { generateStrategy, updateStrategy } from "@/lib/synergy/client";
import type {
  BrainstormComponent,
  StrategyBundle,
  SynergyStrategy,
  SynergyStrategyBlock,
} from "@/lib/synergy/types";
import {
  EvidenceBlock,
  HypothesisBlock,
  NoteBlock,
  PlanStepBlock,
  RiskBlock,
} from "./synergy-strategy-blocks";
import { SynergyStrategyComponentList } from "./synergy-strategy-component-list";
import { SynergyStrategyShareModal } from "./synergy-strategy-share-modal";

interface Props {
  sessionId: string;
  sessionTitle: string;
  initialBundle: StrategyBundle;
  initialNodeCount: number;
  // Tier-1 polish: staleness signals so the doc can surface a soft
  // "re-extract" banner when the board has grown materially since
  // the last extraction.
  reextractAdvised?: boolean;
  lastExtractedNodeCount?: number;
  lastExtractedAt?: string | null;
}

export function SynergyStrategy({
  sessionId,
  sessionTitle,
  initialBundle,
  initialNodeCount,
  reextractAdvised = false,
  lastExtractedNodeCount = 0,
  lastExtractedAt = null,
}: Props) {
  const [bundle, setBundle] = useState<StrategyBundle>(initialBundle);
  const [generating, setGenerating] = useState(false);
  // Tracks whether the current render is the result of a fresh
  // generation in this browser session — drives the staggered fade-in.
  // Existing strategies loaded from server hydration get rendered
  // statically without animation (we don't want a fade-in on every
  // navigation back to the page).
  const [justGenerated, setJustGenerated] = useState(false);

  const onGenerate = async () => {
    if (generating) return;
    if (initialNodeCount === 0) {
      toast.info("Add some nodes to the board first.");
      return;
    }
    setGenerating(true);
    try {
      const fresh = await generateStrategy(sessionId);
      setBundle(fresh);
      setJustGenerated(true);
      // Stagger-reveal lasts ~2.4s — after that, settle into static mode
      // so subsequent edits don't re-animate.
      window.setTimeout(() => setJustGenerated(false), 2600);
      toast.success("Strategy crystallized");
    } catch (e) {
      toast.error("Generation failed", { description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  };

  // Empty state — no strategy generated yet
  if (!bundle.strategy) {
    return (
      <div className="mx-auto max-w-4xl py-12">
        <Header sessionId={sessionId} sessionTitle={sessionTitle} />
        <EmptyState
          generating={generating}
          hasNodes={initialNodeCount > 0}
          onGenerate={onGenerate}
        />
      </div>
    );
  }

  // Generating state replaces the doc with a "crystallizing" view to
  // sell the moment.
  if (generating) {
    return (
      <div className="mx-auto max-w-4xl py-12">
        <Header
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          strategyId={bundle.strategy.id}
        />
        <Crystallizing />
      </div>
    );
  }

  // Block update callback — replaces an existing block in state.
  // Wired into every block renderer's BlockActions and inline-edit flows.
  const handleBlockUpdate = useCallback((updated: SynergyStrategyBlock) => {
    setBundle((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === updated.id ? updated : b)),
    }));
  }, []);

  // Append new blocks (used by Find Evidence, which creates fresh blocks
  // rather than mutating the source one).
  const handleAppendBlocks = useCallback(
    (created: SynergyStrategyBlock[]) => {
      if (created.length === 0) return;
      setBundle((prev) => ({
        ...prev,
        blocks: [...prev.blocks, ...created].sort(
          (a, b) => a.sort_order - b.sort_order,
        ),
      }));
    },
    [],
  );

  // Inline edit of statement / pitch — saved via updateStrategy.
  const handleStrategyEdit = useCallback(
    async (patch: { statement?: string; pitch?: string }) => {
      if (!bundle.strategy) return;
      try {
        const updated = await updateStrategy(bundle.strategy.id, patch);
        setBundle((prev) => ({ ...prev, strategy: updated }));
      } catch (err) {
        toast.error("Save failed", { description: (err as Error).message });
      }
    },
    [bundle.strategy],
  );

  return (
    <div className="mx-auto max-w-4xl py-8">
      <Header
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        strategyId={bundle.strategy.id}
      />
      {reextractAdvised && (
        <ReextractBanner
          sessionId={sessionId}
          currentNodeCount={initialNodeCount}
          lastExtractedNodeCount={lastExtractedNodeCount}
          lastExtractedAt={lastExtractedAt}
          onReextracted={(components) =>
            setBundle((prev) => ({ ...prev, components }))
          }
        />
      )}
      <DocBody
        strategy={bundle.strategy}
        blocks={bundle.blocks}
        components={bundle.components}
        animate={justGenerated}
        onRegenerate={onGenerate}
        onBlockUpdate={handleBlockUpdate}
        onAppendBlocks={handleAppendBlocks}
        onStrategyEdit={handleStrategyEdit}
      />
    </div>
  );
}

// ── Header (sticky-ish navigation row) ──

function Header({
  sessionId,
  sessionTitle,
  strategyId,
}: {
  sessionId: string;
  sessionTitle: string;
  strategyId?: string;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <header className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link
          href={`/app/synergy/${sessionId}/process`}
          className="inline-flex items-center gap-2 text-sm text-gray-600 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to processing
        </Link>
        <span className="text-gray-300">·</span>
        <span className="text-sm text-gray-500">{sessionTitle}</span>
      </div>
      <div className="flex items-center gap-2">
        {strategyId && (
          <button
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-medium text-blue-700 transition hover:scale-[1.02] hover:border-blue-400"
            title="Mint a read-only link"
          >
            <Share2 className="h-3 w-3" />
            Share
          </button>
        )}
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
          <Target className="h-3 w-3 text-blue-600" /> Strategy
        </div>
      </div>
      {strategyId && (
        <SynergyStrategyShareModal
          strategyId={strategyId}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}
    </header>
  );
}

// ── Empty CTA ──

function EmptyState({
  generating,
  hasNodes,
  onGenerate,
}: {
  generating: boolean;
  hasNodes: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
        <Sparkles className="h-5 w-5 text-blue-600" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-gray-900">
        Crystallize your strategy
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
        Turn your brainstorm into a living strategy doc — statement, plan,
        risks, hypotheses, upstream needs, downstream products. The artifact
        you take with you and share.
      </p>
      <button
        onClick={onGenerate}
        disabled={generating || !hasNodes}
        title={!hasNodes ? "Add nodes to your board first" : "Generate strategy"}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:scale-[1.02] disabled:opacity-60"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        Generate strategy doc
      </button>
    </div>
  );
}

// ── Re-extract banner (Tier-1 polish) ──
//
// Soft amber-tinted nudge that appears above the doc when the board
// has grown ≥30% or it's been >7 days since the last extraction.
// One click re-runs extract; the freshly-returned components replace
// the local bundle. Auto-dismisses on success.

function ReextractBanner({
  sessionId,
  currentNodeCount,
  lastExtractedNodeCount,
  lastExtractedAt,
  onReextracted,
}: {
  sessionId: string;
  currentNodeCount: number;
  lastExtractedNodeCount: number;
  lastExtractedAt: string | null;
  onReextracted: (components: BrainstormComponent[]) => void;
}) {
  const [running, setRunning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const grew = currentNodeCount - lastExtractedNodeCount;
  const ageDays = lastExtractedAt
    ? Math.round((Date.now() - new Date(lastExtractedAt).getTime()) / 86_400_000)
    : null;

  const onClick = async () => {
    if (running) return;
    setRunning(true);
    try {
      const { extractComponents } = await import("@/lib/synergy/client");
      const components = await extractComponents(sessionId);
      onReextracted(components);
      toast.success(`Re-extracted ${components.length} components`);
      setDismissed(true);
    } catch (err) {
      toast.error("Re-extraction failed", {
        description: (err as Error).message,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 ring-1 ring-amber-200">
          <RefreshCw className="h-4 w-4 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-amber-900">
            Your board has grown since the last extraction
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800">
            {grew > 0
              ? `${grew} new node${grew === 1 ? "" : "s"} since the last run`
              : "Extraction is stale"}
            {ageDays !== null && ageDays > 0 ? ` · ${ageDays}d ago` : ""}
            {". Components feeding the matcher and strategy doc may not reflect the latest content."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onClick}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Re-extract now
          </button>
          <button
            onClick={() => setDismissed(true)}
            disabled={running}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Crystallizing splash ──
// Shown during generation. Multiple shimmer bars cascade. ~3-6s of
// "thinking out loud" while the LLM call completes.

function Crystallizing() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-12">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <div>
          <div className="text-lg font-semibold text-gray-900">
            Crystallizing your strategy…
          </div>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Reading the board, weighing what stuck, drafting the plan.
          </p>
        </div>
      </div>
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-3 overflow-hidden rounded bg-gray-100"
            style={{
              animation: `shimmer 1.8s ease-in-out infinite`,
              animationDelay: `${i * 0.15}s`,
              background:
                "linear-gradient(90deg, rgba(243,244,246,0.6) 0%, rgba(219,234,254,0.9) 50%, rgba(243,244,246,0.6) 100%)",
              backgroundSize: "200% 100%",
            }}
          />
        ))}
      </div>
      <style jsx>{`
        @keyframes shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}

// ── Doc body (the main artifact) ──

function DocBody({
  strategy,
  blocks,
  components,
  animate,
  onRegenerate,
  onBlockUpdate,
  onAppendBlocks,
  onStrategyEdit,
}: {
  strategy: SynergyStrategy;
  blocks: SynergyStrategyBlock[];
  components: BrainstormComponent[];
  animate: boolean;
  onRegenerate: () => void;
  onBlockUpdate: (updated: SynergyStrategyBlock) => void;
  onAppendBlocks: (created: SynergyStrategyBlock[]) => void;
  onStrategyEdit: (patch: { statement?: string; pitch?: string }) => void;
}) {
  const planSteps = blocks.filter((b) => b.block_type === "plan_step");
  const risks = blocks.filter((b) => b.block_type === "risk");
  const hypotheses = blocks.filter((b) => b.block_type === "hypothesis");
  const evidence = blocks.filter((b) => b.block_type === "evidence");
  const notes = blocks.filter((b) => b.block_type === "note");

  // Standalone evidence blocks = those NOT linked to a source block via
  // meta.supports_block_id. Linked evidence renders inline under its
  // source via the SupportingEvidence carousel inside each block.
  const evidenceBySource = new Map<string, SynergyStrategyBlock[]>();
  const standaloneEvidence: SynergyStrategyBlock[] = [];
  for (const e of evidence) {
    const sup = (e.meta as { supports_block_id?: string }).supports_block_id;
    if (sup) {
      const list = evidenceBySource.get(sup) ?? [];
      list.push(e);
      evidenceBySource.set(sup, list);
    } else {
      standaloneEvidence.push(e);
    }
  }
  const evidenceFor = (id: string) => evidenceBySource.get(id) ?? [];

  return (
    // ── Outer surface ──
    // Frosted-glass panel that picks up the scene background behind it
    // (the discover/rooms/profile pages set the SynergySceneBackground
    // at the layout level; here we just let it bleed through). No
    // cyan glow, no hard border — a barely-visible inner ring + a
    // soft neutral shadow does the lifting.
    <article
      className="relative overflow-hidden rounded-3xl bg-white/85 ring-1 ring-black/[0.04] backdrop-blur-2xl"
      style={{
        boxShadow: animate
          ? "0 24px 60px -24px rgba(15,23,42,0.18), 0 1px 0 rgba(255,255,255,0.6) inset"
          : "0 16px 40px -20px rgba(15,23,42,0.12), 0 1px 0 rgba(255,255,255,0.6) inset",
        transition: "box-shadow 600ms ease",
      }}
    >
      {/* Subtle top-edge highlight — visionOS "light from above" cue */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent"
      />

      {/* Floating Regenerate — circular icon, top-right of the card.
          Hover reveals the label via a tooltip-style pill. */}
      <button
        onClick={onRegenerate}
        title="Regenerate the whole strategy from the current board"
        aria-label="Regenerate strategy"
        className="group absolute right-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-full bg-white/70 px-2.5 text-[12px] font-medium text-gray-600 ring-1 ring-black/[0.06] backdrop-blur-md transition hover:bg-white hover:text-gray-900 hover:ring-black/[0.1]"
      >
        <RefreshCw
          className="h-3.5 w-3.5 transition group-hover:rotate-[-90deg]"
          strokeWidth={1.75}
        />
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[120px] group-hover:pr-1 group-hover:opacity-100">
          Regenerate
        </span>
      </button>

      <div className="px-10 pb-10 pt-12">
        {/* Statement — the document headline. No "STATEMENT" label
            cluttering it; the title carries itself at display size. */}
        <StaggerSection animate={animate} delay={0}>
          <EditableTitle
            value={strategy.statement ?? ""}
            placeholder="(no statement yet)"
            onSave={(v) => onStrategyEdit({ statement: v })}
          />
        </StaggerSection>

        {/* Pitch — promoted to a lead paragraph. A 3px blue accent rail
            at the left edge is the only chrome; no fill, no border. The
            megaphone glyph sits inline as a discreet marker. */}
        {strategy.pitch !== null && (
          <StaggerSection animate={animate} delay={1}>
            <div className="relative mt-6 pl-5">
              <span
                aria-hidden
                className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-blue-600/80"
              />
              <div className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
                <Megaphone className="h-3 w-3" strokeWidth={1.5} />
                Elevator pitch
              </div>
              <EditablePitch
                value={strategy.pitch ?? ""}
                onSave={(v) => onStrategyEdit({ pitch: v })}
              />
            </div>
          </StaggerSection>
        )}

        <Divider />

        {/* The Plan */}
        <StaggerSection animate={animate} delay={2}>
          <SectionTitle
            icon={Target}
            label="The Plan"
            sub={`${planSteps.length} step${planSteps.length === 1 ? "" : "s"}`}
          />
          <div className="space-y-1">
            {planSteps.length === 0 ? (
              <EmptyHint message="No plan steps yet." />
            ) : (
              planSteps.map((b, i) => (
                <PlanStepBlock
                  key={b.id}
                  block={b}
                  index={i}
                  supportingEvidence={evidenceFor(b.id)}
                  onUpdate={onBlockUpdate}
                  onAppendBlocks={onAppendBlocks}
                />
              ))
            )}
          </div>
        </StaggerSection>

        <Divider />

        {/* Upstream */}
        <StaggerSection animate={animate} delay={3}>
          <SynergyStrategyComponentList kind="upstream" components={components} />
        </StaggerSection>

        <Divider />

        {/* Downstream */}
        <StaggerSection animate={animate} delay={4}>
          <SynergyStrategyComponentList kind="downstream" components={components} />
        </StaggerSection>

        <Divider />

        {/* Risks */}
        <StaggerSection animate={animate} delay={5}>
          <SectionTitle
            icon={Target}
            label="Risks"
            sub={`${risks.length} to watch`}
          />
          <div className="space-y-2">
            {risks.length === 0 ? (
              <EmptyHint message="No risks identified yet." />
            ) : (
              risks.map((b) => (
                <RiskBlock
                  key={b.id}
                  block={b}
                  supportingEvidence={evidenceFor(b.id)}
                  onUpdate={onBlockUpdate}
                  onAppendBlocks={onAppendBlocks}
                />
              ))
            )}
          </div>
        </StaggerSection>

        <Divider />

        {/* Hypotheses */}
        <StaggerSection animate={animate} delay={6}>
          <SectionTitle
            icon={Sparkles}
            label="Hypotheses"
            sub="what we're betting on"
          />
          <div className="space-y-2">
            {hypotheses.length === 0 ? (
              <EmptyHint message="No hypotheses surfaced yet." />
            ) : (
              hypotheses.map((b) => (
                <HypothesisBlock
                  key={b.id}
                  block={b}
                  supportingEvidence={evidenceFor(b.id)}
                  onUpdate={onBlockUpdate}
                  onAppendBlocks={onAppendBlocks}
                />
              ))
            )}
          </div>
        </StaggerSection>

        {/* Standalone evidence section — only renders blocks NOT linked
            to a source (linked ones surface under their parent block). */}
        {standaloneEvidence.length > 0 && (
          <>
            <Divider />
            <StaggerSection animate={animate} delay={7}>
              <SectionTitle icon={Sparkles} label="Evidence" sub="research backing" />
              <div className="space-y-2">
                {standaloneEvidence.map((b) => (
                  <EvidenceBlock key={b.id} block={b} />
                ))}
              </div>
            </StaggerSection>
          </>
        )}

        {notes.length > 0 && (
          <>
            <Divider />
            <StaggerSection animate={animate} delay={7.5}>
              <SectionTitle icon={Edit3} label="Notes" sub="" />
              <div className="space-y-2">
                {notes.map((b) => (
                  <NoteBlock key={b.id} block={b} onUpdate={onBlockUpdate} />
                ))}
              </div>
            </StaggerSection>
          </>
        )}

        <Divider />

        {/* Collaborators (Phase 4 hook) */}
        <StaggerSection animate={animate} delay={8}>
          <CollaboratorsSection
            components={components}
            sessionId={strategy.session_id}
          />
        </StaggerSection>

        <Divider />

        {/* Footer actions */}
        <StaggerSection animate={animate} delay={9}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => exportMarkdown(strategy, blocks, components)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400 hover:text-gray-900"
            >
              <Download className="h-3 w-3" /> Export markdown
            </button>
            <button
              onClick={() =>
                toast.info("Share link coming with Phase 5 polish", {
                  description: "Read-only link with redacted private sections",
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400 hover:text-gray-900"
            >
              <Share2 className="h-3 w-3" /> Share read-only link
            </button>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700">
              <Check className="h-3 w-3" /> {strategy.status}
            </span>
          </div>
        </StaggerSection>
      </div>
    </article>
  );
}

// ── Helpers ──

function StaggerSection({
  animate,
  delay,
  children,
}: {
  animate: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  if (!animate) return <div>{children}</div>;
  return (
    <div
      style={{
        animation: "synergyStrategyStaggerIn 600ms ease both",
        animationDelay: `${delay * 220}ms`,
        opacity: 0,
      }}
    >
      {children}
      <style jsx>{`
        @keyframes synergyStrategyStaggerIn {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    // Section header — quieter than before. The icon shrinks to 12px
    // and goes neutral (no blue accent), the label drops to 15px
    // medium, the sub-count moves to a mono caps pill so it reads as
    // metadata rather than narration.
    <div className="mb-5 flex items-center gap-2.5">
      <Icon className="h-3 w-3 text-gray-500" />
      <h3 className="text-[15px] font-medium tracking-tight text-gray-900">
        {label}
      </h3>
      {sub && (
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
          {sub}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return (
    <div className="my-8 h-px w-full bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 bg-white p-3 text-[11px] text-gray-500">
      {message}
    </p>
  );
}

// ── Markdown export ──
//
// Client-side stringify of the strategy doc into a copy-pasteable
// markdown blob. Renders into a textarea inside a modal so the user
// can select-all + copy. No server round-trip needed.

function exportMarkdown(
  strategy: SynergyStrategy,
  blocks: SynergyStrategyBlock[],
  components: BrainstormComponent[],
) {
  const lines: string[] = [];
  lines.push(`# ${strategy.statement || "(untitled strategy)"}`);
  lines.push("");
  if (strategy.pitch) {
    lines.push(`> ${strategy.pitch}`);
    lines.push("");
  }

  const planSteps = blocks.filter((b) => b.block_type === "plan_step");
  if (planSteps.length > 0) {
    lines.push("## The Plan");
    lines.push("");
    planSteps.forEach((b, i) => {
      const meta = b.meta as { title?: string; sub_steps?: Array<{ title: string; detail: string }> };
      lines.push(`### ${i + 1}. ${meta.title ?? "Step"}`);
      lines.push("");
      lines.push(b.body);
      if (meta.sub_steps?.length) {
        lines.push("");
        for (const s of meta.sub_steps) {
          lines.push(`- **${s.title}** — ${s.detail}`);
        }
      }
      lines.push("");
    });
  }

  const upstream = components.filter((c) => c.kind === "upstream");
  if (upstream.length > 0) {
    lines.push("## Upstream (needs)");
    lines.push("");
    for (const c of upstream) {
      lines.push(`- **${c.label_public}** — ${c.description_public}`);
    }
    lines.push("");
  }

  const downstream = components.filter((c) => c.kind === "downstream");
  if (downstream.length > 0) {
    lines.push("## Downstream (produces)");
    lines.push("");
    for (const c of downstream) {
      lines.push(`- **${c.label_public}** — ${c.description_public}`);
    }
    lines.push("");
  }

  const risks = blocks.filter((b) => b.block_type === "risk");
  if (risks.length > 0) {
    lines.push("## Risks");
    lines.push("");
    for (const b of risks) {
      const meta = b.meta as { title?: string; severity?: string; mitigation?: string };
      lines.push(`- **${meta.title ?? "Risk"}** _(${meta.severity ?? "medium"})_ — ${b.body}`);
      if (meta.mitigation) lines.push(`  - Mitigation: ${meta.mitigation}`);
    }
    lines.push("");
  }

  const hypotheses = blocks.filter((b) => b.block_type === "hypothesis");
  if (hypotheses.length > 0) {
    lines.push("## Hypotheses");
    lines.push("");
    for (const b of hypotheses) {
      const meta = b.meta as { rationale?: string };
      lines.push(`- **${b.body}**`);
      if (meta.rationale) lines.push(`  - Why: ${meta.rationale}`);
    }
    lines.push("");
  }

  const md = lines.join("\n");

  // Copy to clipboard if available, else fall back to a prompt.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(md)
      .then(() => toast.success("Markdown copied to clipboard"))
      .catch(() => {
        window.prompt("Copy the markdown below:", md);
      });
  } else {
    window.prompt("Copy the markdown below:", md);
  }
}

// ── Editable headline + pitch ──
// Click-to-edit textareas with Cmd+Enter / blur to save, ESC to cancel.

function EditableTitle({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing, value]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [draft]);

  if (!editing) {
    return (
      <h1
        onClick={() => setEditing(true)}
        title="Click to edit"
        className="font-display-tight -mx-1.5 cursor-text rounded-lg px-1.5 text-[34px] font-semibold leading-[1.12] tracking-tight text-gray-900 transition hover:bg-black/[0.02]"
      >
        {value || placeholder}
      </h1>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      placeholder={placeholder}
      rows={2}
      className="font-display-tight -mx-1.5 w-[calc(100%+0.75rem)] resize-none rounded-lg bg-white/80 px-1.5 py-1 text-[34px] font-semibold leading-[1.12] tracking-tight text-gray-900 outline-none ring-1 ring-black/[0.08] focus:ring-2 focus:ring-blue-500/40"
    />
  );
}

function EditablePitch({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing, value]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [draft]);

  if (!editing) {
    return (
      <p
        onClick={() => setEditing(true)}
        title="Click to edit"
        className="-mx-1 cursor-text rounded-lg px-1 text-[17px] font-normal leading-[1.55] text-gray-700 transition hover:bg-black/[0.02]"
      >
        {value || "(no pitch yet — click to add)"}
      </p>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      rows={3}
      className="-mx-1 w-[calc(100%+0.5rem)] resize-none rounded-lg bg-white/80 px-1 py-1 text-[17px] font-normal leading-[1.55] text-gray-700 outline-none ring-1 ring-black/[0.08] focus:ring-2 focus:ring-blue-500/40"
    />
  );
}

function CollaboratorsSection({
  components,
  sessionId,
}: {
  components: BrainstormComponent[];
  sessionId: string;
}) {
  const matchable = components.filter(
    (c) => c.visibility === "matchable_only" || c.visibility === "public",
  );
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{
    persisted: number;
    considered: number;
  } | null>(null);

  const runMatch = async () => {
    if (running) return;
    if (matchable.length === 0) {
      toast.info("No matchable components — mark some as matchable first.");
      return;
    }
    setRunning(true);
    try {
      // Lazy-import to avoid pulling the matching client into every
      // synergy bundle that doesn't need it.
      const { runSessionMatch } = await import("@/lib/synergy/match-client");
      const result = await runSessionMatch(sessionId);
      setLastResult({
        persisted: result.matches_persisted_total,
        considered: result.candidates_considered_total,
      });
      toast.success(
        result.matches_persisted_total > 0
          ? `Found ${result.matches_persisted_total} match${result.matches_persisted_total === 1 ? "" : "es"}`
          : "Matcher ran — no strong matches in the current pool",
      );
    } catch (e) {
      toast.error("Match run failed", { description: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <SectionTitle
        icon={Users}
        label="Collaborators needed"
        sub="live matches across the community"
      />
      <div className="rounded-xl border border-gray-200 bg-blue-50/40 p-4">
        <p className="text-[12px] leading-relaxed text-gray-700">
          {matchable.length === 0
            ? "Mark some components as matchable to start finding collaborators."
            : `${matchable.length} component${matchable.length === 1 ? " is" : "s are"} indexed for the matching marketplace.`}
          {lastResult && (
            <span className="ml-1 text-gray-600">
              Last run considered {lastResult.considered} candidate
              {lastResult.considered === 1 ? "" : "s"} and persisted{" "}
              {lastResult.persisted} match{lastResult.persisted === 1 ? "" : "es"}.
            </span>
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {matchable.slice(0, 6).map((c) => (
            <span
              key={c.id}
              className="rounded-full bg-white px-2 py-1 text-[11px] text-gray-700 ring-1 ring-blue-100"
            >
              {c.label_public}
            </span>
          ))}
          {matchable.length > 6 && (
            <span className="rounded-full bg-white/60 px-2 py-1 font-mono text-[10px] text-gray-500">
              +{matchable.length - 6}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={runMatch}
            disabled={running || matchable.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {running ? "Running matcher…" : "Find collaborators"}
          </button>
          <Link
            href="/app/synergy/discover"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-blue-700 transition hover:border-blue-400"
          >
            Browse matches
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
