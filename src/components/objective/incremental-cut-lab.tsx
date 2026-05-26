"use client";

// ── Incremental Cut Lab ────────────────────────────────────────────
//
// Post-confirm affordance on the main canvas. Lets the user add ONE
// more sub-objective after the initial set has already been picked
// and rooms have started generating — for the "now that I see the
// rooms, I realize I want a different cut" moment.
//
// Architecturally it's a thin wrapper around the same variant lab
// backend the picker uses. Differences:
//   • Compact UI — collapsed by default, expands inline when the
//     user clicks "+ Add a cut"
//   • Single-batch quota per click — generate one batch, pick one,
//     done. No election of multiple at once.
//   • Calls /api/brainstorm/sub-objectives/add (not /confirm) so
//     stage stays "main" and only ONE goal row is inserted.
//
// Carries the same suggested-intent logic as the picker so the
// user's revealed preferences keep influencing suggestions here too.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  SubObjectiveBlock,
  SubObjectiveIntent,
  SubObjectiveProposal,
} from "@/lib/objective-canvas/sub-objective-state";

const INTENT_LABEL: Record<SubObjectiveIntent, string> = {
  initial: "Initial",
  creative: "Creative",
  concrete: "Concrete",
  contrarian: "Contrarian",
  gap_fill: "Fill gaps",
  ambitious: "Ambitious",
  wildcard: "Wildcard",
};

const INTENT_DESCRIPTION: Record<SubObjectiveIntent, string> = {
  initial: "Default decomposition.",
  creative: "Distant-domain analogies; surprising cuts.",
  concrete: "Implementation-anchored, ship-in-2-weeks.",
  contrarian: "Inverts a shared assumption of the existing set.",
  gap_fill: "Targets lens readings nothing else covers.",
  ambitious: "6+ month horizon, compounding payoff.",
  wildcard: "One deliberately-weird cut + reasoned justification.",
};

const REGEN_INTENTS: SubObjectiveIntent[] = [
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

interface Props {
  spaceId: string;
  /** User's revealed top-preferred intent (from decision log).
   *  When null, defaults to "creative" — same fallback as the picker. */
  preferredIntent?: SubObjectiveIntent | null;
}

export function IncrementalCutLab({
  spaceId,
  preferredIntent = null,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<SubObjectiveIntent>(
    preferredIntent ?? "creative",
  );
  const [proposals, setProposals] = useState<SubObjectiveProposal[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // proposal id being added
  const [, startTransition] = useTransition();

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/brainstorm/sub-objectives/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          mode: "variant",
          intent,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Could not generate variants.");
        setGenerating(false);
        return;
      }
      const block = json.sub_objectives as SubObjectiveBlock;
      // Show only the new batch's proposals — the batches[] array's
      // last entry is the freshly generated one.
      const lastBatch =
        block.batches && block.batches.length > 0
          ? block.batches[block.batches.length - 1]
          : null;
      setProposals(lastBatch ? lastBatch.proposals : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setGenerating(false);
    }
  }

  function addProposal(p: SubObjectiveProposal) {
    setError(null);
    setAdding(p.id);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/sub-objectives/add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            proposalId: p.id,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error ?? "Could not add the cut.");
          setAdding(null);
          return;
        }
        // Refresh the page so the new sub-objective card appears
        // alongside the existing ones, and (in autopilot) the room
        // generator can pick it up on first visit.
        router.refresh();
        // Reset UI so the lab is ready for another add if desired.
        setProposals([]);
        setOpen(false);
        setAdding(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
        setAdding(null);
      }
    });
  }

  if (!open) {
    return (
      <div className="mx-auto mt-8 flex w-full max-w-5xl justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[12.5px] font-semibold transition-all hover:bg-[rgba(15,23,42,0.04)]"
          style={{
            borderColor: appleVibe.stroke.medium,
            color: appleVibe.text.secondary,
            background: "rgba(255,255,255,0.7)",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
          Add another cut
        </button>
      </div>
    );
  }

  return (
    <div
      className="mx-auto mt-8 w-full max-w-2xl rounded-3xl p-5"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Add another cut
          </span>
          {preferredIntent && (
            <span
              className="text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              · suggested: {INTENT_LABEL[preferredIntent]} (matches your past picks)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setProposals([]);
            setError(null);
          }}
          className="text-[10.5px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
        >
          close
        </button>
      </div>

      {/* Intent picker — chips */}
      {proposals.length === 0 && (
        <div className="mt-3">
          <div
            className="text-[10.5px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            Pick a direction for this cut:
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REGEN_INTENTS.map((id) => {
              const active = intent === id;
              const isPref = preferredIntent === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setIntent(id)}
                  disabled={generating}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
                  style={{
                    background: active
                      ? "rgba(124,58,237,0.10)"
                      : "rgba(255,255,255,0.85)",
                    color: active
                      ? "rgba(91,33,182,0.95)"
                      : appleVibe.text.secondary,
                    border: `1px solid ${
                      active
                        ? "rgba(124,58,237,0.35)"
                        : isPref
                          ? "rgba(124,58,237,0.20)"
                          : appleVibe.stroke.hairline
                    }`,
                    cursor: generating ? "wait" : "pointer",
                    opacity: generating ? 0.6 : 1,
                  }}
                  title={INTENT_DESCRIPTION[id]}
                >
                  {INTENT_LABEL[id]}
                  {isPref && (
                    <span
                      className="ml-0.5 text-[9px] font-semibold"
                      style={{ color: "rgba(91,33,182,0.95)" }}
                    >
                      ★
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p
            className="mt-2 text-[11px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            {INTENT_DESCRIPTION[intent]}
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="mt-3 inline-flex items-center gap-1.5 rounded-2xl px-3.5 py-2 text-[12px] font-semibold"
            style={{
              background:
                generating ? appleVibe.surface.chip : appleVibe.accent.primary,
              color: generating ? appleVibe.text.tertiary : appleVibe.text.onAccent,
              borderRadius: appleVibe.radius.md,
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" strokeWidth={2} />
                Generate variants
              </>
            )}
          </button>
        </div>
      )}

      {/* Proposal list — user picks one to add */}
      {proposals.length > 0 && (
        <div className="mt-3">
          <div
            className="flex items-center justify-between text-[10.5px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            <span>
              Generated {proposals.length} via {INTENT_LABEL[intent]} —
              pick one to add:
            </span>
            <button
              type="button"
              onClick={() => setProposals([])}
              className="inline-flex items-center gap-1 text-[10.5px] font-medium"
              style={{ color: appleVibe.text.tertiary }}
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
              Try different intent
            </button>
          </div>
          <ul className="mt-2.5 flex flex-col gap-2">
            {proposals.map((p) => {
              const isAdding = adding === p.id;
              return (
                <li
                  key={p.id}
                  className="rounded-2xl border p-3"
                  style={{
                    background: "rgba(255,255,255,0.7)",
                    borderColor: appleVibe.stroke.hairline,
                    borderRadius: appleVibe.radius.md,
                    opacity: adding && !isAdding ? 0.5 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[13px] font-semibold leading-snug"
                        style={{ color: appleVibe.text.primary }}
                      >
                        {p.title}
                      </div>
                      {p.summary && (
                        <p
                          className="mt-0.5 text-[11.5px] font-light leading-snug"
                          style={{ color: appleVibe.text.secondary }}
                        >
                          {p.summary}
                        </p>
                      )}
                      {p.rationale && (
                        <p
                          className="mt-1 text-[10.5px] font-light italic"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {p.rationale}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => addProposal(p)}
                      disabled={adding !== null}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        background: isAdding
                          ? appleVibe.surface.chip
                          : appleVibe.accent.primary,
                        color: isAdding
                          ? appleVibe.text.tertiary
                          : appleVibe.text.onAccent,
                        cursor:
                          adding === null ? "pointer" : "wait",
                        opacity: adding && !isAdding ? 0.5 : 1,
                      }}
                    >
                      {isAdding ? "Adding…" : "Add"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl px-3 py-2 text-[11.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
