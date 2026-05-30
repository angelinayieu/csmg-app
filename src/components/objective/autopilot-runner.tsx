"use client";

// ── Autopilot Runner ──────────────────────────────────────────────
//
// Phase 7c — wires the room's "Autopilot" affordance to the
// existing Phase 4 (score) + Phase 5b (refine) routes. Iterates
// chains sequentially, scoring each chain's feature if needed, then
// refining it to propose 3 new IV candidates. Bumps a refreshSignal
// after each chain completes so the matching CategoryCard re-fetches
// its expanded_detail + the new candidates appear in the lineup.
//
// User-curated by design: autopilot proposes; it does NOT auto-elect.
// Every candidate still requires a user click to graduate from
// pending → elected. The runner just batches what the user would
// otherwise have to click through one card at a time.
//
// Cancellable: the runner checks a ref on each loop iteration so
// "Cancel" stops cleanly after the in-flight chain finishes.

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Loader2,
  Play,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";

type Status = "idle" | "running" | "done" | "cancelled";

type ChainResult = "ok" | "error" | "skipped";

interface Props {
  chains: ChainTriple[];
  /** Phase 10a — needed to log the autopilot_run event into the Lab
   *  Notebook before the loop starts. Both can be omitted for legacy
   *  mount sites that don't care about notebook integration; the run
   *  still works, just without the parent grouping in the timeline. */
  spaceId?: string;
  subObjectiveId?: string;
  /** Called after each chain completes successfully (or fails).
   *  Caller typically bumps a refreshSignal that triggers
   *  per-CategoryCard re-fetches so the new candidates appear
   *  immediately. */
  onChainComplete?: (chainId: string, result: ChainResult) => void;
  /** Called once the whole run finishes (or is cancelled). */
  onAllComplete?: () => void;
}

const FEATURES = appleVibe.stage.features;

export function AutopilotRunner({
  chains,
  spaceId,
  subObjectiveId,
  onChainComplete,
  onAllComplete,
}: Props) {
  // Status state machine. Started always at idle. Transitions:
  //   idle → running     (user clicks Run)
  //   running → done     (all chains processed)
  //   running → cancelled (user cancels)
  //   done | cancelled → idle (user resets / re-runs)
  const [status, setStatus] = useState<Status>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<Map<string, ChainResult>>(new Map());
  // Cancel via ref so the runner loop sees the latest value
  // without depending on React state closure semantics.
  const cancelRef = useRef(false);
  // Dropdown open state — only relevant when status is idle.
  const [open, setOpen] = useState(false);

  async function runAutopilot() {
    if (chains.length === 0) return;
    setStatus("running");
    setOpen(false);
    cancelRef.current = false;
    setResults(new Map());
    setCurrentIndex(0);

    // Phase 10a — fire-and-forget log of the autopilot_run header.
    // Notebook timestamp-groups the subsequent score / rd_iterate
    // events under this row. Errors silently — the run continues
    // regardless of whether logging succeeds.
    if (spaceId && subObjectiveId) {
      void fetch(
        `/api/brainstorm/sub-objectives/${subObjectiveId}/autopilot/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            chainIds: chains.map((c) => c.id),
          }),
        },
      ).catch(() => undefined);
    }

    for (let i = 0; i < chains.length; i++) {
      if (cancelRef.current) {
        setStatus("cancelled");
        onAllComplete?.();
        return;
      }
      setCurrentIndex(i);
      const chain = chains[i];
      const featureId = chain.featureId;
      let result: ChainResult = "error";
      try {
        // Step 1: score the mechanism. The route is cache-aware —
        // if the feature already has an effectiveness_envelope it
        // re-scores cheaply; otherwise it runs the full Monte Carlo.
        const scoreRes = await fetch(
          "/api/brainstorm/item/variation/score",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entityId: featureId }),
          },
        );
        const scoreJson = (await scoreRes
          .json()
          .catch(() => ({}))) as { status?: string };

        // If scoring resolved a target pain, proceed to refine.
        // Otherwise mark this chain as skipped (e.g. lever_unreachable,
        // no_target — common when the room hasn't been correlated).
        if (
          scoreRes.ok &&
          scoreJson.status === "ok" &&
          !cancelRef.current
        ) {
          const refineRes = await fetch(
            "/api/brainstorm/item/variation/refine",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ entityId: featureId }),
            },
          );
          const refineJson = (await refineRes
            .json()
            .catch(() => ({}))) as { status?: string };
          result = refineRes.ok && refineJson.status === "ok" ? "ok" : "error";
        } else {
          result = "skipped";
        }
      } catch {
        result = "error";
      }
      setResults((prev) => {
        const next = new Map(prev);
        next.set(chain.id, result);
        return next;
      });
      onChainComplete?.(chain.id, result);
    }
    setStatus("done");
    onAllComplete?.();
  }

  function cancelAutopilot() {
    cancelRef.current = true;
  }

  function reset() {
    setStatus("idle");
    setResults(new Map());
    setCurrentIndex(0);
    setOpen(false);
  }

  // Disabled state — autopilot has nothing to run on empty chain
  // lists. Surface a subtle hint via the button title.
  const hasWork = chains.length > 0;

  // ── IDLE — pill button + optional dropdown ──
  if (status === "idle") {
    return (
      <div className="relative">
        <motion.button
          type="button"
          onClick={() => hasWork && setOpen((v) => !v)}
          whileHover={hasWork ? { y: -1 } : undefined}
          whileTap={hasWork ? { y: 0.5 } : undefined}
          disabled={!hasWork}
          className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: appleVibe.surface.card,
            color: appleVibe.text.primary,
            border: `1px solid ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.pill,
            padding: "5px 12px",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow: appleVibe.shadow.chip,
            fontFamily: appleVibe.font.stack,
          }}
          title={
            hasWork
              ? `Run experiments on ${chains.length} chain${chains.length === 1 ? "" : "s"}`
              : "No chains to run autopilot on yet"
          }
        >
          <Sparkle
            className="h-3 w-3"
            strokeWidth={2}
            style={{ color: FEATURES }}
          />
          Autopilot
        </motion.button>
        {open && (
          <AutopilotDropdown
            chains={chains}
            onRun={runAutopilot}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    );
  }

  // ── RUNNING — progress chip ──
  if (status === "running") {
    const chain = chains[currentIndex];
    const progressPct = Math.round(((currentIndex + 1) / chains.length) * 100);
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="inline-flex items-center gap-2"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${FEATURES}40`,
          borderRadius: appleVibe.radius.pill,
          padding: "4px 4px 4px 12px",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.02em",
          boxShadow: appleVibe.shadow.chip,
          fontFamily: appleVibe.font.stack,
          color: appleVibe.text.primary,
        }}
      >
        <Loader2
          className="h-3 w-3 flex-shrink-0 animate-spin"
          style={{ color: FEATURES }}
          strokeWidth={2}
        />
        <span>
          Running {currentIndex + 1}/{chains.length}
        </span>
        <span
          className="font-light italic"
          style={{ color: appleVibe.text.tertiary }}
          title={chain?.featureName ?? ""}
        >
          · {(chain?.featureName ?? "").slice(0, 26)}
          {(chain?.featureName ?? "").length > 26 ? "…" : ""}
        </span>
        {/* Inline mini progress bar */}
        <div
          className="relative h-1 w-12 flex-shrink-0 overflow-hidden"
          style={{
            background: `${FEATURES}22`,
            borderRadius: appleVibe.radius.pill,
          }}
        >
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
            style={{
              width: `${progressPct}%`,
              background: FEATURES,
              borderRadius: appleVibe.radius.pill,
            }}
          />
        </div>
        <button
          type="button"
          onClick={cancelAutopilot}
          className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.06)]"
          title="Cancel — stops cleanly after the current chain finishes"
          aria-label="Cancel autopilot"
        >
          <X
            className="h-3 w-3"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
        </button>
      </motion.div>
    );
  }

  // ── DONE / CANCELLED — summary chip ──
  const okCount = Array.from(results.values()).filter((r) => r === "ok")
    .length;
  const skippedCount = Array.from(results.values()).filter(
    (r) => r === "skipped",
  ).length;
  const errorCount = Array.from(results.values()).filter((r) => r === "error")
    .length;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="inline-flex items-center gap-2"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.pill,
        padding: "4px 4px 4px 12px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
        color: appleVibe.text.primary,
      }}
    >
      {status === "cancelled" ? (
        <X
          className="h-3 w-3 flex-shrink-0"
          style={{ color: appleVibe.text.tertiary }}
          strokeWidth={2.5}
        />
      ) : (
        <Check
          className="h-3 w-3 flex-shrink-0"
          style={{ color: appleVibe.stage.outcomes }}
          strokeWidth={2.5}
        />
      )}
      <span>{status === "cancelled" ? "Cancelled" : "Done"}</span>
      <span
        className="font-light"
        style={{ color: appleVibe.text.tertiary }}
      >
        · {okCount} refined
        {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        {errorCount > 0 ? ` · ${errorCount} failed` : ""}
      </span>
      <button
        type="button"
        onClick={reset}
        className="ml-1 inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold transition-colors hover:bg-[rgba(15,23,42,0.06)]"
        style={{ color: appleVibe.text.tertiary }}
      >
        reset
      </button>
    </motion.div>
  );
}

// ── Idle dropdown — confirmation surface ──
//
// Pops below the Autopilot button to confirm before firing the loop.
// Times-out estimate is ~30s per chain (score + refine + persist).
// Restrained: no fanfare, just the action + count + a cancel-out.

function AutopilotDropdown({
  chains,
  onRun,
  onClose,
}: {
  chains: ChainTriple[];
  onRun: () => void;
  onClose: () => void;
}) {
  const estSeconds = chains.length * 30;
  const estStr =
    estSeconds < 60
      ? `~${estSeconds}s`
      : `~${Math.round(estSeconds / 60)} min`;

  return (
    <>
      {/* Click-outside catcher */}
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="absolute right-0 z-40 mt-2 w-72"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.md,
          boxShadow: appleVibe.shadow.card,
          fontFamily: appleVibe.font.stack,
        }}
      >
        <div className="px-3.5 py-3">
          <div className="flex items-center gap-1.5">
            <Sparkle
              className="h-3 w-3 flex-shrink-0"
              strokeWidth={2}
              style={{ color: FEATURES }}
            />
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.secondary }}
            >
              Autopilot
            </span>
          </div>
          <h3
            className="mt-1 text-[13.5px] font-semibold leading-tight tracking-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
            }}
          >
            Run experiments on all {chains.length} chains
          </h3>
          <p
            className="mt-1.5 text-[11.5px] leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            Scores each mechanism + proposes 3 fresh IV candidates per
            chain targeting its weakest pain gap. You curate
            elections — autopilot proposes, never auto-elects.
          </p>
          <div
            className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
            style={{
              background: appleVibe.surface.chip,
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            <span
              className="text-[10px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              estimated {estStr}
            </span>
          </div>
        </div>
        <div
          className="flex items-center justify-end gap-2 px-3.5 py-2"
          style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-[10.5px] font-medium underline-offset-2 hover:underline"
            style={{ color: appleVibe.text.tertiary }}
          >
            cancel
          </button>
          <motion.button
            type="button"
            onClick={onRun}
            whileHover={{ y: -1 }}
            whileTap={{ y: 0.5 }}
            className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out"
            style={{
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              borderRadius: appleVibe.radius.pill,
              padding: "4px 12px",
              fontSize: "10.5px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              boxShadow: appleVibe.shadow.chip,
            }}
          >
            <Play className="h-2.5 w-2.5" strokeWidth={2.5} />
            Run
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}
