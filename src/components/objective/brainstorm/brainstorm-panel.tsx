"use client";

// ── Brainstorm Panel ────────────────────────────────────────────────
//
// Phase 4 of BRAINSTORM_MODULE_SPEC.md — the user-visible surface.
// Rail-card chrome cloned from lab-notebook-panel.tsx (non-modal,
// canvas-stays-interactive). Stage progression cloned conceptually
// from Synergy's focus-mode-overlay; adapted for our 5-stage
// diverge-then-converge flow vs. Synergy's 4-stage convergence ritual.
//
// State machine:
//
//   idle      Panel just opened. Show plan + Start button.
//   running   POST /sessions/run is in flight. ~25-30s. Single spinner +
//             stage progress chip — per-stage SSE streaming is Phase 4b.
//   settled   Ranking returned. Render top/explore/tray ribbons +
//             elect / brainstorm-again / save controls.
//   error     Runner returned non-200. Show retry.
//
// What's IN scope for Phase 4 MVP:
//   ✓ Press point + opening + closing
//   ✓ Run via POST /api/brainstorm/sessions/run
//   ✓ Settled ranking display with 3 ribbons
//   ✓ One-click elect via POST /api/brainstorm/sessions/[id]/elect-candidate
//   ✓ User-added ideas as LOCAL UI state (visible alongside ranked
//     candidates; not yet persisted or scored)
//   ✓ Brainstorm again — fresh run
//
// What's OUT of scope (Phase 4b):
//   ✗ tldraw page integration (cards as draggable shapes on a new page)
//   ✗ Per-stage SSE streaming progress
//   ✗ User ideas persisted to brainstorm_sessions.user_added_ideas +
//     scored alongside LLM candidates
//   ✗ Save-to-library pin (Phase 5)
//   ✗ Collapse-to-base-board (Phase 4b)

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookmarkPlus,
  Check,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  BrainstormSession,
  BrainstormRankedCandidate,
  BrainstormRibbon,
  IntentReason,
} from "@/lib/brainstorm/session-types";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

interface Props {
  /** Host owns the open state. */
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Fires after the user elects a candidate. Host refreshes the
   *  picker so the new election surfaces in the lane list. */
  onElected?: (proposalId: string) => void;
  /** Phase 5 re-open: when set on open, the panel skips the idle
   *  view + runner entirely and jumps straight to settled with the
   *  prior session's ranking. Re-runs ("Brainstorm again") fire a
   *  fresh runner from scratch — they do NOT mutate the prior session. */
  rehydrateSession?: BrainstormSession | null;
}

type Phase = "idle" | "running" | "settled" | "error";

interface LocalIdea {
  id: string;
  text: string;
  added_at: string;
}

export function BrainstormPanel({
  open,
  onClose,
  spaceId,
  onElected,
  rehydrateSession = null,
}: Props) {
  const reduce = useReducedMotion();

  // ── State (all useStates declared FIRST so the rehydrate
  //    useEffect below can reference setters without TDZ issues). ──

  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<BrainstormSession | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Track which candidates the user has already elected from this panel
  // so the button flips to "Elected ✓" without a full session refresh.
  const [electedIds, setElectedIds] = useState<Set<string>>(new Set());
  const [electingId, setElectingId] = useState<string | null>(null);

  // Local-only user ideas (Phase 4 MVP). Phase 4b persists them.
  const [ideas, setIdeas] = useState<LocalIdea[]>([]);
  const [draftIdea, setDraftIdea] = useState("");

  // Library pin state (Phase 5 wiring). Sessions auto-save on close;
  // pinning is what surfaces them in the library list.
  const [pinned, setPinned] = useState(false);
  const [pinning, setPinning] = useState(false);

  // Rehydrate from a prior session when the panel opens with one. Skip
  // the runner entirely and land directly on settled. Reset to idle when
  // panel re-opens without one. Pre-populate electedIds from the session
  // ranking's elected proposals (Phase 4-polish: prior elections show as
  // ✓ on re-open instead of a fresh Elect button).
  const lastRehydratedId = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (rehydrateSession && rehydrateSession.id !== lastRehydratedId.current) {
      lastRehydratedId.current = rehydrateSession.id;
      setSession(rehydrateSession);
      setPhase(rehydrateSession.status === "settled" ? "settled" : "idle");
      setErrorMsg(null);
      // Seed elected ids from generation candidates that carry an
      // elected disposition — these are the ones the user already
      // chose from this session before. (Disposition lives on the
      // sub-objective row, not directly on the session, so an exact
      // re-hydrate is best-effort; Phase 5b can plug into the proper
      // brainstorm_elected decision_log feed.)
      const electedSeed = new Set<string>();
      for (const g of rehydrateSession.generations ?? []) {
        for (const c of g.candidates) {
          // We don't know disposition without a fresh query — seed
          // empty for now; future enhancement reads spaces.synthesis_data
          // server-side and includes the elected flag on rehydrate.
          void c;
        }
      }
      setElectedIds(electedSeed);
      setPinned(rehydrateSession.pinned);
    } else if (!rehydrateSession && lastRehydratedId.current !== null) {
      // Re-opened without a session → reset to fresh idle state.
      lastRehydratedId.current = null;
      setSession(null);
      setPhase("idle");
      setErrorMsg(null);
      setElectedIds(new Set());
      setPinned(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rehydrateSession?.id]);

  // Abandon-on-close: if a runner was in flight, mark the session
  // abandoned server-side so it doesn't linger in `running` status.
  // Fire-and-forget — closing should never block the user on a network
  // call. Settled sessions are no-ops on the server.
  const handleClose = useCallback(() => {
    const sid = session?.id;
    if (sid && phase === "running") {
      void fetch(`/api/brainstorm/sessions/${sid}/abandon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {
        // Soft-fail — closing UX wins; server will see a stale
        // 'running' row which is fine (status is informational, not
        // gating anything else).
      });
    }
    onClose();
  }, [session?.id, phase, onClose]);

  const togglePin = useCallback(async () => {
    if (!session || pinning) return;
    const nextPinned = !pinned;
    setPinning(true);
    try {
      const res = await fetch(
        `/api/brainstorm/sessions/${session.id}/pin`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: nextPinned }),
        },
      );
      if (!res.ok) {
        const detail = await safeText(res);
        setErrorMsg(`Pin failed: ${detail}`);
        return;
      }
      setPinned(nextPinned);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPinning(false);
    }
  }, [session, pinning, pinned]);

  const runBrainstorm = useCallback(async () => {
    setPhase("running");
    setErrorMsg(null);
    setElectedIds(new Set());
    setPinned(false); // fresh run resets pin state for the new session
    try {
      const res = await fetch("/api/brainstorm/sessions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      if (!res.ok) {
        const detail = await safeText(res);
        setErrorMsg(`Runner failed (${res.status}): ${detail}`);
        setPhase("error");
        return;
      }
      const json = (await res.json()) as { session: BrainstormSession | null };
      if (!json.session) {
        setErrorMsg("Runner returned no session.");
        setPhase("error");
        return;
      }
      setSession(json.session);
      setPhase("settled");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [spaceId]);

  const elect = useCallback(
    async (cand: BrainstormRankedCandidate, intent: SubObjectiveIntent) => {
      if (!session) return;
      if (electedIds.has(cand.proposal_id)) return;
      setElectingId(cand.proposal_id);
      try {
        const res = await fetch(
          `/api/brainstorm/sessions/${session.id}/elect-candidate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proposalId: cand.proposal_id,
              ribbon: cand.ribbon,
              compositeScore: cand.composite_score,
              intentOfOrigin: intent,
            }),
          },
        );
        if (!res.ok) {
          const detail = await safeText(res);
          setErrorMsg(`Elect failed: ${detail}`);
          return;
        }
        setElectedIds((prev) => new Set(prev).add(cand.proposal_id));
        onElected?.(cand.proposal_id);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setElectingId(null);
      }
    },
    [session, electedIds, onElected],
  );

  const addIdea = useCallback(() => {
    const text = draftIdea.trim();
    if (text.length < 3) return;
    setIdeas((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        text,
        added_at: new Date().toISOString(),
      },
    ]);
    setDraftIdea("");
  }, [draftIdea]);

  const removeIdea = useCallback((id: string) => {
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // Map candidates by ribbon for rendering.
  const ranking = session?.ranking?.candidates ?? [];
  const byRibbon = {
    green: ranking.filter((c) => c.ribbon === "green"),
    amber: ranking.filter((c) => c.ribbon === "amber"),
    tray: ranking.filter((c) => c.ribbon === "tray"),
  };

  // Helper to find intent_of_origin for a candidate. The ranking
  // doesn't carry it but session.generations[] does (per spec §5).
  const intentByProposal = new Map<string, SubObjectiveIntent>();
  for (const g of session?.generations ?? []) {
    for (const c of g.candidates) intentByProposal.set(c.proposal_id, g.intent);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          role="dialog"
          aria-label="Brainstorm"
          initial={reduce ? { x: 0, opacity: 0 } : { x: "100%", opacity: 0.8 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.36, ease: [0.22, 1, 0.36, 1] }}
          className="fixed z-50 flex flex-col overflow-hidden"
          style={{
            top: 16,
            right: 16,
            bottom: 16,
            width: 460,
            maxWidth: "calc(100vw - 32px)",
            background: appleVibe.surface.card,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: 20,
            fontFamily: appleVibe.font.stack,
            boxShadow:
              "0 24px 64px -16px rgba(11,18,40,0.32), 0 4px 12px -4px rgba(11,18,40,0.10)",
          }}
        >
          <Header phase={phase} onClose={handleClose} />
          <StageProgress phase={phase} session={session} />

          <div className="relative flex-1 overflow-y-auto">
            {phase === "idle" && <IdleView onStart={runBrainstorm} />}
            {phase === "running" && <RunningView />}
            {phase === "error" && (
              <ErrorView message={errorMsg} onRetry={runBrainstorm} />
            )}
            {phase === "settled" && session && (
              <SettledView
                session={session}
                byRibbon={byRibbon}
                electedIds={electedIds}
                electingId={electingId}
                intentByProposal={intentByProposal}
                onElect={elect}
                ideas={ideas}
                draftIdea={draftIdea}
                onDraftChange={setDraftIdea}
                onAddIdea={addIdea}
                onRemoveIdea={removeIdea}
                onBrainstormAgain={runBrainstorm}
                errorMsg={errorMsg}
                pinned={pinned}
                pinning={pinning}
                onTogglePin={togglePin}
              />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function Header({ phase, onClose }: { phase: Phase; onClose: () => void }) {
  return (
    <header
      className="flex items-center justify-between gap-3 px-5 py-4"
      style={{
        borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.86) 100%)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="min-w-0 flex-1">
        <div
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          Brainstorm
        </div>
        <h2
          className="mt-1 truncate text-[16px] font-semibold leading-tight tracking-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {phase === "settled"
            ? "Ready — pick what to elect"
            : phase === "running"
              ? "Running — diverge → cleanup → rank"
              : phase === "error"
                ? "Brainstorm hit an error"
                : "Auto-pilot the variant lab"}
        </h2>
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-gray-100"
        style={{ color: appleVibe.text.tertiary }}
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </header>
  );
}

// ── 5-stage progress strip ──────────────────────────────────────────

const STAGES: Array<{ key: string; label: string }> = [
  { key: "plan", label: "Plan" },
  { key: "diverge", label: "Diverge" },
  { key: "cleanup", label: "Cleanup" },
  { key: "rank", label: "Rank" },
  { key: "settle", label: "Settled" },
];

function StageProgress({
  phase,
  session,
}: {
  phase: Phase;
  session: BrainstormSession | null;
}) {
  // Map phase + session state to a 0..4 active index.
  // idle = 0 (Plan only highlighted); running = 1..3 best-guess; settled = 4.
  let activeIdx = 0;
  if (phase === "running") activeIdx = 2; // mid-pipeline guess (no SSE yet)
  if (phase === "settled" && session?.ranking) activeIdx = 4;

  return (
    <div
      className="flex items-center gap-1.5 border-b px-5 py-2.5"
      style={{
        borderColor: appleVibe.stroke.hairline,
        background: "rgba(248,250,252,0.7)",
      }}
    >
      {STAGES.map((s, i) => {
        const isDone = i < activeIdx;
        const isActive = i === activeIdx;
        return (
          <div key={s.key} className="flex flex-1 items-center gap-1.5">
            <span
              className="h-1.5 flex-1 rounded-full transition-all"
              style={{
                background: isDone
                  ? appleVibe.accent.primary
                  : isActive
                    ? "rgba(59,130,246,0.5)"
                    : "rgba(15,23,42,0.08)",
              }}
            />
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.12em] tabular-nums"
              style={{
                color: isActive || isDone
                  ? appleVibe.text.secondary
                  : appleVibe.text.faint,
              }}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Idle view ───────────────────────────────────────────────────────

function IdleView({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-5 py-6">
      <div>
        <h3
          className="text-[14px] font-semibold"
          style={{ color: appleVibe.text.primary }}
        >
          What this does
        </h3>
        <p
          className="mt-1.5 text-[12.5px] leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          Runs 3 divergence rounds across the intents that fit your goal +
          history, cleans up duplicates, then ranks every new candidate on
          coverage, diversity, your past picks, and a critique pass. Top 3
          come back ready to elect.
        </p>
      </div>

      <ul
        className="rounded-xl border px-3 py-2 text-[11.5px]"
        style={{
          borderColor: appleVibe.stroke.hairline,
          background: "rgba(248,250,252,0.5)",
          color: appleVibe.text.secondary,
        }}
      >
        <li className="flex items-center gap-2 py-1">
          <Check
            className="h-3 w-3"
            strokeWidth={2.5}
            style={{ color: appleVibe.accent.primary }}
          />
          Picks 3 intents from your lens gaps + history
        </li>
        <li className="flex items-center gap-2 py-1">
          <Check
            className="h-3 w-3"
            strokeWidth={2.5}
            style={{ color: appleVibe.accent.primary }}
          />
          Runs them via your variant lab (no duplicates)
        </li>
        <li className="flex items-center gap-2 py-1">
          <Check
            className="h-3 w-3"
            strokeWidth={2.5}
            style={{ color: appleVibe.accent.primary }}
          />
          Deduplicates + clusters, then ranks
        </li>
        <li className="flex items-center gap-2 py-1">
          <Check
            className="h-3 w-3"
            strokeWidth={2.5}
            style={{ color: appleVibe.accent.primary }}
          />
          You elect from the top — your picks teach future runs
        </li>
      </ul>

      <button
        onClick={onStart}
        className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-semibold transition hover:scale-[1.01]"
        style={{
          background: appleVibe.accent.primary,
          color: appleVibe.text.onAccent,
          boxShadow: "0 4px 12px -2px rgba(59,130,246,0.35)",
        }}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
        Start brainstorm
        <span
          className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium tabular-nums"
          title="Estimated wall-clock"
        >
          ~30s
        </span>
      </button>

      <p
        className="text-center text-[10.5px] font-light"
        style={{ color: appleVibe.text.faint }}
      >
        Tip: the &ldquo;Generate better&rdquo; bar below still works for
        single-intent presses.
      </p>
    </div>
  );
}

// ── Running view ────────────────────────────────────────────────────

function RunningView() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-6 py-8">
      <BreathingPulse />
      <h3
        className="text-center text-[15px] font-semibold"
        style={{ color: appleVibe.text.primary }}
      >
        Diverging, cleaning, ranking…
      </h3>
      <p
        className="max-w-[280px] text-center text-[12px] leading-relaxed"
        style={{ color: appleVibe.text.secondary }}
      >
        Three intent batches firing in sequence, then dedup + critique. Hold
        tight — this runs ~25-30 seconds.
      </p>
    </div>
  );
}

function BreathingPulse() {
  return (
    <div className="relative h-16 w-16">
      <div
        className="absolute -inset-3 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(59,130,246,0.15), transparent 65%)",
          animation: "brainstormPulse 2.2s ease-in-out infinite",
        }}
      />
      <div
        className="absolute inset-0 rounded-full border"
        style={{ borderColor: "rgba(59,130,246,0.4)" }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <Sparkles
          className="h-5 w-5"
          strokeWidth={1.75}
          style={{ color: appleVibe.accent.primary }}
        />
      </div>
      <style jsx>{`
        @keyframes brainstormPulse {
          0%,
          100% {
            opacity: 0.7;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.18);
          }
        }
      `}</style>
    </div>
  );
}

// ── Error view ──────────────────────────────────────────────────────

function ErrorView({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-6">
      <div
        className="rounded-xl border px-3 py-3 text-[12px]"
        style={{
          borderColor: "rgba(220,38,38,0.3)",
          background: "rgba(254,242,242,0.7)",
          color: "rgba(127,29,29,0.95)",
        }}
      >
        {message ?? "Unknown error."}
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center justify-center gap-2 self-start rounded-xl border px-3 py-2 text-[12px] font-semibold"
        style={{
          borderColor: appleVibe.stroke.hairline,
          background: appleVibe.surface.card,
          color: appleVibe.text.primary,
        }}
      >
        <RefreshCw className="h-3 w-3" strokeWidth={2.25} />
        Try again
      </button>
    </div>
  );
}

// ── Settled view ────────────────────────────────────────────────────

interface SettledProps {
  session: BrainstormSession;
  byRibbon: Record<BrainstormRibbon, BrainstormRankedCandidate[]>;
  electedIds: Set<string>;
  electingId: string | null;
  intentByProposal: Map<string, SubObjectiveIntent>;
  onElect: (
    cand: BrainstormRankedCandidate,
    intent: SubObjectiveIntent,
  ) => void;
  ideas: LocalIdea[];
  draftIdea: string;
  onDraftChange: (v: string) => void;
  onAddIdea: () => void;
  onRemoveIdea: (id: string) => void;
  onBrainstormAgain: () => void;
  errorMsg: string | null;
  pinned: boolean;
  pinning: boolean;
  onTogglePin: () => void;
}

function SettledView(props: SettledProps) {
  const { session, byRibbon } = props;
  const plan = session.plan as { intents?: SubObjectiveIntent[]; reasons?: Partial<Record<SubObjectiveIntent, IntentReason>> } | null;
  const totalCandidates = (session.ranking?.candidates.length ?? 0);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* Plan summary */}
      {plan?.intents && (
        <div
          className="rounded-xl border px-3 py-2.5"
          style={{
            borderColor: appleVibe.stroke.hairline,
            background: "rgba(248,250,252,0.6)",
          }}
        >
          <div
            className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Plan that ran
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plan.intents.map((i) => (
              <IntentChip
                key={i}
                intent={i}
                reason={plan.reasons?.[i] ?? null}
              />
            ))}
            <span
              className="ml-auto self-center text-[10.5px] tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
            >
              {totalCandidates} candidate{totalCandidates === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      {props.errorMsg && (
        <div
          className="rounded-lg border px-2.5 py-1.5 text-[11px]"
          style={{
            borderColor: "rgba(220,38,38,0.3)",
            background: "rgba(254,242,242,0.6)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {props.errorMsg}
        </div>
      )}

      {/* Top — green */}
      <RibbonSection
        ribbon="green"
        label="Ready to elect"
        candidates={byRibbon.green}
        {...props}
      />

      {/* Explore — amber */}
      {byRibbon.amber.length > 0 && (
        <RibbonSection
          ribbon="amber"
          label="Explore"
          candidates={byRibbon.amber}
          {...props}
        />
      )}

      {/* User ideas */}
      <UserIdeasSection
        ideas={props.ideas}
        draft={props.draftIdea}
        onDraftChange={props.onDraftChange}
        onAdd={props.onAddIdea}
        onRemove={props.onRemoveIdea}
      />

      {/* Tray — collapsed */}
      {byRibbon.tray.length > 0 && (
        <TraySection candidates={byRibbon.tray} {...props} />
      )}

      {/* Footer actions */}
      <div
        className="sticky bottom-0 mt-2 flex items-center justify-between gap-2 border-t px-1 pt-3 pb-1"
        style={{
          borderColor: appleVibe.stroke.hairline,
          background:
            "linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.95) 35%)",
        }}
      >
        <button
          onClick={props.onTogglePin}
          disabled={props.pinning}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition"
          style={{
            borderColor: props.pinned
              ? "rgba(217,119,6,0.3)"
              : appleVibe.stroke.hairline,
            background: props.pinned
              ? "rgba(254,243,199,0.4)"
              : appleVibe.surface.card,
            color: props.pinned
              ? "rgba(146,64,14,0.95)"
              : appleVibe.text.secondary,
            cursor: props.pinning ? "wait" : "pointer",
          }}
          title={
            props.pinned
              ? "Pinned to library — click to unpin"
              : "Save this session to the library"
          }
        >
          {props.pinning ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.25} />
          ) : (
            <BookmarkPlus className="h-3 w-3" strokeWidth={2.25} />
          )}
          {props.pinned ? "Pinned" : "Save to library"}
        </button>
        <button
          onClick={props.onBrainstormAgain}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition hover:bg-gray-50"
          style={{
            borderColor: appleVibe.stroke.hairline,
            background: appleVibe.surface.card,
            color: appleVibe.text.primary,
          }}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2.25} />
          Brainstorm again
        </button>
      </div>
    </div>
  );
}

// ── Ribbon section ──────────────────────────────────────────────────

interface RibbonSectionProps extends SettledProps {
  ribbon: BrainstormRibbon;
  label: string;
  candidates: BrainstormRankedCandidate[];
}

function RibbonSection(props: RibbonSectionProps) {
  const { ribbon, label, candidates } = props;
  if (candidates.length === 0) return null;
  const dotColor =
    ribbon === "green"
      ? "rgba(22,163,74,0.85)"
      : ribbon === "amber"
        ? "rgba(217,119,6,0.85)"
        : "rgba(100,116,139,0.6)";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: dotColor }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {label}
        </span>
        <span
          className="text-[10.5px] font-light tabular-nums"
          style={{ color: appleVibe.text.faint }}
        >
          · {candidates.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <CandidateCard
            key={c.proposal_id}
            candidate={c}
            session={props.session}
            intent={props.intentByProposal.get(c.proposal_id) ?? null}
            isElected={props.electedIds.has(c.proposal_id)}
            isElecting={props.electingId === c.proposal_id}
            onElect={props.onElect}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Candidate card ──────────────────────────────────────────────────

function CandidateCard({
  candidate,
  session,
  intent,
  isElected,
  isElecting,
  onElect,
}: {
  candidate: BrainstormRankedCandidate;
  session: BrainstormSession;
  intent: SubObjectiveIntent | null;
  isElected: boolean;
  isElecting: boolean;
  onElect: (
    c: BrainstormRankedCandidate,
    intent: SubObjectiveIntent,
  ) => void;
}) {
  // Find the source candidate text in session.generations.
  const source = session.generations
    .flatMap((g) => g.candidates)
    .find((c) => c.proposal_id === candidate.proposal_id);

  const ribbonBg =
    candidate.ribbon === "green"
      ? "rgba(220,252,231,0.6)"
      : candidate.ribbon === "amber"
        ? "rgba(254,243,199,0.5)"
        : "rgba(248,250,252,0.6)";
  const ribbonBorder =
    candidate.ribbon === "green"
      ? "rgba(22,163,74,0.25)"
      : candidate.ribbon === "amber"
        ? "rgba(217,119,6,0.25)"
        : appleVibe.stroke.hairline;

  return (
    <li
      className="rounded-xl border px-3 py-2.5"
      style={{ background: ribbonBg, borderColor: ribbonBorder }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {intent && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  background: intentColor(intent),
                  color: "rgba(255,255,255,0.95)",
                }}
              >
                {intent}
              </span>
            )}
            <span
              className="font-mono text-[10.5px] font-semibold tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
              title="Composite score: 0.40·coverage + 0.25·diversity + 0.20·preference + 0.15·critique"
            >
              {candidate.composite_score.toFixed(2)}
            </span>
          </div>
          <h4
            className="mt-1 text-[13px] font-semibold leading-snug"
            style={{ color: appleVibe.text.primary }}
          >
            {source?.title ?? "(missing title)"}
          </h4>
          {source?.summary && (
            <p
              className="mt-0.5 text-[11.5px] leading-relaxed"
              style={{ color: appleVibe.text.secondary }}
            >
              {source.summary}
            </p>
          )}
          {/* Sub-score chips */}
          <div className="mt-2 flex flex-wrap gap-1">
            <ScoreChip label="cov" value={candidate.sub_scores.coverage} />
            <ScoreChip label="div" value={candidate.sub_scores.diversity} />
            <ScoreChip label="pref" value={candidate.sub_scores.preference} />
            <ScoreChip label="crit" value={candidate.sub_scores.critique} />
          </div>
          {/* Reasoning */}
          <div
            className="mt-2 space-y-0.5 text-[10.5px] leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            <div>
              <strong className="font-semibold">Why:</strong>{" "}
              {candidate.reasoning.why_strong}
            </div>
            {candidate.reasoning.where_stretches && (
              <div style={{ color: appleVibe.text.tertiary }}>
                <strong className="font-semibold">Stretches:</strong>{" "}
                {candidate.reasoning.where_stretches}
              </div>
            )}
            {candidate.reasoning.whats_missing && (
              <div style={{ color: appleVibe.text.tertiary }}>
                <strong className="font-semibold">Missing:</strong>{" "}
                {candidate.reasoning.whats_missing}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() =>
            intent && onElect(candidate, intent)
          }
          disabled={isElected || isElecting || !intent}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition"
          style={{
            background: isElected
              ? "rgba(22,163,74,0.15)"
              : candidate.ribbon === "green"
                ? "rgba(22,163,74,0.85)"
                : appleVibe.surface.card,
            color: isElected
              ? "rgba(22,163,74,0.95)"
              : candidate.ribbon === "green"
                ? "white"
                : appleVibe.text.primary,
            border: isElected
              ? "1px solid rgba(22,163,74,0.3)"
              : `1px solid ${appleVibe.stroke.hairline}`,
            cursor: isElected ? "default" : isElecting ? "wait" : "pointer",
            opacity: !intent ? 0.5 : 1,
          }}
        >
          {isElected ? (
            <>
              <Check className="h-3 w-3" strokeWidth={2.5} /> Elected
            </>
          ) : isElecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.25} />
              ...
            </>
          ) : (
            <>
              Elect
              <ArrowRight className="h-3 w-3" strokeWidth={2.25} />
            </>
          )}
        </button>
      </div>
    </li>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums"
      style={{
        borderColor: "rgba(15,23,42,0.08)",
        background: "rgba(255,255,255,0.7)",
        color: appleVibe.text.tertiary,
      }}
    >
      <span className="opacity-70">{label}</span>
      <span style={{ color: appleVibe.text.secondary }}>{value.toFixed(2)}</span>
    </span>
  );
}

// ── Tray section ────────────────────────────────────────────────────

function TraySection(
  props: SettledProps & { candidates: BrainstormRankedCandidate[] },
) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 self-start text-[10px] font-semibold uppercase tracking-[0.14em] transition hover:opacity-80"
        style={{ color: appleVibe.text.tertiary }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        Tray · {props.candidates.length}
        <span className="font-light normal-case tracking-normal">
          {expanded ? "(hide)" : "(show)"}
        </span>
      </button>
      {expanded && (
        <ul className="flex flex-col gap-2 opacity-80">
          {props.candidates.map((c) => (
            <CandidateCard
              key={c.proposal_id}
              candidate={c}
              session={props.session}
              intent={props.intentByProposal.get(c.proposal_id) ?? null}
              isElected={props.electedIds.has(c.proposal_id)}
              isElecting={props.electingId === c.proposal_id}
              onElect={props.onElect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── User ideas section (Phase 4 MVP — local state) ─────────────────

function UserIdeasSection({
  ideas,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  ideas: LocalIdea[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Lightbulb
          className="h-3 w-3"
          strokeWidth={2.25}
          style={{ color: "rgba(217,119,6,0.85)" }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Your ideas
        </span>
        <span
          className="text-[10.5px] font-light tabular-nums"
          style={{ color: appleVibe.text.faint }}
        >
          · {ideas.length}
        </span>
      </div>
      {ideas.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {ideas.map((i) => (
            <li
              key={i.id}
              className="flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5"
              style={{
                background: "rgba(254,249,195,0.3)",
                borderColor: "rgba(217,119,6,0.2)",
              }}
            >
              <span
                className="flex-1 text-[12px] leading-snug"
                style={{ color: appleVibe.text.primary }}
              >
                {i.text}
              </span>
              <button
                onClick={() => onRemove(i.id)}
                className="flex-shrink-0 rounded p-1 transition hover:bg-amber-100"
                aria-label="Remove idea"
              >
                <Trash2
                  className="h-3 w-3"
                  strokeWidth={2}
                  style={{ color: "rgba(146,64,14,0.7)" }}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-stretch gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim().length >= 3) {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="Add your own idea…"
          className="flex-1 rounded-lg border px-2.5 py-1.5 text-[12px] outline-none transition focus:border-blue-400"
          style={{
            borderColor: appleVibe.stroke.hairline,
            background: appleVibe.surface.card,
            color: appleVibe.text.primary,
          }}
        />
        <button
          onClick={onAdd}
          disabled={draft.trim().length < 3}
          className="inline-flex items-center gap-1 rounded-lg border px-2.5 text-[11.5px] font-semibold transition"
          style={{
            borderColor: appleVibe.stroke.hairline,
            background:
              draft.trim().length >= 3
                ? appleVibe.surface.card
                : appleVibe.surface.chip,
            color:
              draft.trim().length >= 3
                ? appleVibe.text.primary
                : appleVibe.text.faint,
            cursor: draft.trim().length >= 3 ? "pointer" : "not-allowed",
          }}
        >
          <Plus className="h-3 w-3" strokeWidth={2.25} />
          Add
        </button>
      </div>
      {ideas.length === 0 && (
        <p
          className="text-[10.5px] font-light"
          style={{ color: appleVibe.text.faint }}
        >
          Phase 4b will score these alongside LLM candidates.
        </p>
      )}
    </div>
  );
}

// ── Intent chip + helpers ──────────────────────────────────────────

function IntentChip({
  intent,
  reason,
}: {
  intent: SubObjectiveIntent;
  reason: IntentReason | null;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{
        background: intentColor(intent),
        color: "rgba(255,255,255,0.95)",
      }}
      title={describeReason(reason)}
    >
      {intent}
    </span>
  );
}

function intentColor(intent: SubObjectiveIntent): string {
  switch (intent) {
    case "creative":
      return "rgba(59,130,246,0.85)";
    case "concrete":
      return "rgba(20,184,166,0.85)";
    case "contrarian":
      return "rgba(168,85,247,0.85)";
    case "gap_fill":
      return "rgba(217,119,6,0.85)";
    case "ambitious":
      return "rgba(220,38,38,0.8)";
    case "wildcard":
      return "rgba(236,72,153,0.85)";
    default:
      return "rgba(100,116,139,0.8)";
  }
}

function describeReason(reason: IntentReason | null): string {
  if (!reason) return "";
  switch (reason.source) {
    case "gap_fill":
      return `Targets uncovered lens reading${
        reason.uncovered_lens.length === 1 ? "" : "s"
      } ${reason.uncovered_lens.join(", ")}`;
    case "user_preference":
      return `You've elected this flavour ${Math.round(
        reason.elect_rate * 100,
      )}% of the time (${reason.n_observed} observations)`;
    case "default":
      return reason.fallback_for === "no_history"
        ? "Default — no preference signal yet"
        : "Default — preference signal too thin";
    case "user_override":
      return `Replaced ${reason.replaced} via chip swap`;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 220);
  } catch {
    return `(${res.status})`;
  }
}
