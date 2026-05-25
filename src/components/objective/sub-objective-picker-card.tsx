"use client";

// ── Sub-Objective Picker Card ──
//
// Apple-vibe multi-select carousel of AI-generated sub-objectives.
// Recommended top-3 are pre-checked. User can toggle picks, ask for
// a regeneration, then Confirm to advance the canvas into "main"
// stage (Phase 4 forks them onto the whiteboard).

import { useEffect, useState, useTransition } from "react";
import { ArrowRight, Check, RefreshCw } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { SubObjectiveBlock, SubObjectiveProposal } from "@/lib/objective-canvas/sub-objective-state";

interface Props {
  spaceId: string;
  /** Server-rendered initial block (if proposals already exist). */
  initial: SubObjectiveBlock | null;
  /** Called when confirm succeeds. Parent flips into "main" stage. */
  onConfirmed: () => void;
}

export function SubObjectivePickerCard({
  spaceId,
  initial,
  onConfirmed,
}: Props) {
  const [block, setBlock] = useState<SubObjectiveBlock | null>(initial);
  const [picked, setPicked] = useState<Set<string>>(() => {
    if (!initial) return new Set();
    if (initial.picked_proposal_ids.length > 0) {
      return new Set(initial.picked_proposal_ids);
    }
    // Pre-check the recommended trio
    return new Set(
      initial.proposals.filter((p) => p.recommended).map((p) => p.id),
    );
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [loading, setLoading] = useState(initial === null);

  // ── Auto-propose on mount if nothing is cached ──
  useEffect(() => {
    if (block !== null) return;
    void runAction("propose", { mode: "initial" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(
    kind: "propose" | "confirm",
    payload?: { mode?: "initial" | "regenerate" },
  ) {
    setError(null);
    startTransition(async () => {
      try {
        if (kind === "propose") {
          setLoading(block === null);
          const res = await fetch("/api/brainstorm/sub-objectives/propose", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              mode: payload?.mode ?? "initial",
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not propose sub-objectives.");
            setLoading(false);
            return;
          }
          const nextBlock = json.sub_objectives as SubObjectiveBlock;
          setBlock(nextBlock);
          // Reset picks to the new recommended trio on regenerate.
          setPicked(
            new Set(
              nextBlock.proposals
                .filter((p) => p.recommended)
                .map((p) => p.id),
            ),
          );
          setLoading(false);
        } else if (kind === "confirm") {
          if (!block || picked.size === 0) return;
          const res = await fetch("/api/brainstorm/sub-objectives/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              pickedProposalIds: Array.from(picked),
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not confirm picks.");
            return;
          }
          onConfirmed();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error. Try again.",
        );
        setLoading(false);
      }
    });
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Render ──
  if (loading) {
    return (
      <Shell>
        <SkeletonRows />
      </Shell>
    );
  }

  if (!block || block.proposals.length === 0) {
    return (
      <Shell>
        <Eyebrow>Sub-objectives</Eyebrow>
        <Heading>Nothing proposed yet</Heading>
        <p
          className="mt-2 text-[13.5px] font-light"
          style={{ color: appleVibe.text.secondary }}
        >
          Generate proposals from your refined objective.
        </p>
        <Primary
          label="Propose sub-objectives"
          onClick={() => runAction("propose", { mode: "initial" })}
          busy={busy}
        />
        {error && <ErrorRow message={error} />}
      </Shell>
    );
  }

  const recommendedCount = block.proposals.filter((p) => p.recommended).length;

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <Eyebrow>
          {block.proposals.length} {block.category || "proposed"}
        </Eyebrow>
        <button
          type="button"
          onClick={() => runAction("propose", { mode: "regenerate" })}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.secondary,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2} />
          Regenerate
        </button>
      </div>

      <Heading>Pick the ones you want to fork</Heading>
      <p
        className="mt-1.5 text-[12.5px] font-light"
        style={{ color: appleVibe.text.secondary }}
      >
        Top {recommendedCount} are pre-checked — feel free to swap or add
        more. Each pick becomes its own room with a Pain → Features →
        Outcomes → Objective layered analysis.
      </p>

      <ul className="mt-5 flex flex-col gap-2">
        {block.proposals.map((p) => (
          <ProposalRow
            key={p.id}
            proposal={p}
            picked={picked.has(p.id)}
            onToggle={() => togglePick(p.id)}
            disabled={busy}
          />
        ))}
      </ul>

      <div
        className="mt-5 flex items-center justify-between border-t pt-4"
        style={{ borderColor: appleVibe.stroke.hairline }}
      >
        <span
          className="text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {picked.size} of {block.proposals.length} picked
        </span>
        <button
          type="button"
          onClick={() => runAction("confirm")}
          disabled={busy || picked.size === 0}
          className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[13px] font-semibold"
          style={{
            background:
              picked.size > 0 && !busy
                ? appleVibe.accent.primary
                : appleVibe.surface.chip,
            color:
              picked.size > 0 && !busy
                ? appleVibe.text.onAccent
                : appleVibe.text.tertiary,
            borderRadius: appleVibe.radius.md,
            cursor:
              picked.size > 0 && !busy ? "pointer" : "not-allowed",
          }}
        >
          <span>{busy ? "Working…" : "Fork onto canvas"}</span>
          {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
        </button>
      </div>

      {error && <ErrorRow message={error} />}
    </Shell>
  );
}

// ── Row ────────────────────────────────────────────────────────────

function ProposalRow({
  proposal,
  picked,
  onToggle,
  disabled,
}: {
  proposal: SubObjectiveProposal;
  picked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const confidencePct = Math.round(proposal.confidence * 100);
  const confidenceDot =
    confidencePct >= 75 ? "#16A34A" : confidencePct >= 50 ? "#D97706" : "#DC2626";
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={picked}
        className="flex w-full items-start gap-3 rounded-2xl p-3.5 text-left transition-all"
        style={{
          background: picked
            ? "rgba(15,23,42,0.025)"
            : "rgba(255,255,255,0.55)",
          border: `1px solid ${
            picked ? "rgba(15,23,42,0.18)" : appleVibe.stroke.hairline
          }`,
          borderRadius: appleVibe.radius.md,
          cursor: disabled ? "wait" : "pointer",
        }}
      >
        {/* Compact checkbox — circle, slightly smaller */}
        <div
          className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: picked ? appleVibe.accent.primary : "transparent",
            border: `1px solid ${
              picked ? appleVibe.accent.primary : appleVibe.stroke.medium
            }`,
          }}
          aria-hidden
        >
          {picked && (
            <Check
              className="h-2.5 w-2.5"
              strokeWidth={3.5}
              style={{ color: appleVibe.text.onAccent }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Title + recommended chip — no numbering, single line */}
          <div className="flex items-baseline gap-1.5">
            <h3
              className="text-[14px] font-semibold leading-snug tracking-tight"
              style={{ color: appleVibe.text.primary, letterSpacing: "-0.005em" }}
            >
              {proposal.title}
            </h3>
            {proposal.recommended && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(124,58,237,0.08)",
                  color: "rgba(91,33,182,0.95)",
                }}
              >
                <Sparkle className="h-2 w-2" />
                Top
              </span>
            )}
          </div>

          {proposal.summary && (
            <p
              className="mt-1 line-clamp-2 text-[12px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {proposal.summary}
            </p>
          )}

          {/* Single compact meta line: confidence dot · pct · rationale */}
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: confidenceDot }}
              aria-hidden
            />
            <span
              className="font-mono text-[10px] font-medium"
              style={{ color: appleVibe.text.tertiary }}
            >
              {confidencePct}%
            </span>
            {proposal.rationale && (
              <>
                <span
                  className="text-[10px]"
                  style={{ color: appleVibe.text.faint }}
                >
                  ·
                </span>
                <span
                  className="line-clamp-1 text-[11px] font-light italic"
                  style={{ color: appleVibe.text.tertiary }}
                  title={proposal.rationale}
                >
                  {proposal.rationale}
                </span>
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

// ── Shared primitives (lighter-weight than clarifying-questions
//     card; intentional to keep file independent). ──

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-2xl rounded-3xl p-7"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: appleVibe.text.tertiary }}
    >
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight"
      style={{
        color: appleVibe.text.primary,
        fontFamily: appleVibe.font.display,
        letterSpacing: "-0.015em",
      }}
    >
      {children}
    </h2>
  );
}

function Primary({
  label,
  onClick,
  busy,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[13.5px] font-semibold"
      style={{
        background: appleVibe.accent.primary,
        color: appleVibe.text.onAccent,
        borderRadius: appleVibe.radius.md,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <span>{busy ? "Working…" : label}</span>
      {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      <div
        className="h-3 w-32 rounded-full"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div
        className="h-7 w-3/4 rounded-lg"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div className="mt-4 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 w-full rounded-2xl"
            style={{ background: appleVibe.surface.chip }}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl px-3.5 py-2.5 text-[12.5px]"
      style={{
        background: "rgba(220,38,38,0.06)",
        border: "1px solid rgba(220,38,38,0.18)",
        color: "rgba(127,29,29,0.95)",
      }}
    >
      {message}
    </div>
  );
}
