// ── Focus Mode overlay shell ──
//
// The glassmorphic pane on the right + the dimmed backdrop layer over
// the canvas. Owns:
//   - Entrance animation (backdrop fade + pane slide-in with overshoot)
//   - Header bar with close affordance + stage progress
//   - Stage routing (1-4)
//   - Sticky footer with Continue / Back CTAs
//   - The "publishing" splash that crossfades into the strategy doc
//
// Sized + positioned per the design sketch:
//   right: 24px, top: 24px, bottom: 24px, width: 480px, max 40vw
//
// Glassmorphism stack: bg-white/85 + backdrop-blur-xl + cyan ring +
// triple-layer shadow (cyan glow + ambient + edge).

"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { ClientNode } from "@/lib/synergy/types";
import { FocusModeProgress } from "./focus-mode-progress";
import { FocusModeStage1 } from "./focus-mode-stage1";
import { FocusModeStage2 } from "./focus-mode-stage2";
import { FocusModeStage3 } from "./focus-mode-stage3";
import { FocusModeStage4 } from "./focus-mode-stage4";
import type { UseFocusModeReturn } from "./use-focus-mode";

interface Props {
  sessionId: string;
  nodes: ClientNode[];
  focus: UseFocusModeReturn;
  // Triggered from Stage 1 row click — recenters the canvas on a node
  onFocusNode: (id: string) => void;
}

export function FocusModeOverlay({
  sessionId,
  nodes,
  focus,
  onFocusNode,
}: Props) {
  const [sharpeningAnswers, setSharpeningAnswers] = useState<
    Record<string, string>
  >({});

  if (focus.phase === "closed") return null;

  const showing =
    focus.phase === "entering" ||
    focus.phase === "open" ||
    focus.phase === "publishing";

  return (
    <>
      {/* ── Backdrop dimmer over the canvas ── */}
      <div
        className="fixed inset-0 z-40"
        style={{
          background: "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(2px)",
          opacity:
            focus.phase === "entering"
              ? 0
              : focus.phase === "exiting"
                ? 0
                : 1,
          transition: "opacity 300ms ease-out",
          pointerEvents: focus.phase === "open" ? "auto" : "none",
        }}
        onClick={() => {
          // Click outside the pane on the dim layer → no-op for now.
          // We require explicit × or ESC to close, to prevent accidental
          // dismissal mid-decision.
        }}
      />

      {/* ── The Focus Pane ── */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Focus mode"
        className="fixed z-50 flex flex-col overflow-hidden rounded-3xl"
        style={{
          top: 24,
          right: 24,
          bottom: 24,
          width: "min(480px, 40vw)",
          minWidth: "min(420px, 90vw)",
          background: "rgba(255, 255, 255, 0.88)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          // Triple-layer shadow: cyan glow (signature) + deep ambient
          // (depth) + outer ring (edge definition)
          boxShadow: [
            "0 0 60px -15px rgba(6, 182, 212, 0.4)",
            "0 25px 50px -12px rgba(0, 0, 0, 0.15)",
            "0 0 0 1px rgba(6, 182, 212, 0.15)",
          ].join(", "),
          opacity: showing ? 1 : 0,
          transform:
            focus.phase === "entering"
              ? "translateX(100%) scale(0.98)"
              : focus.phase === "exiting"
                ? "translateX(100%) scale(0.98)"
                : "translateX(0) scale(1)",
          transition:
            focus.phase === "entering"
              ? "transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease"
              : focus.phase === "exiting"
                ? "transform 300ms cubic-bezier(0.4, 0.0, 1, 1), opacity 200ms ease"
                : "transform 400ms ease, opacity 200ms ease",
        }}
      >
        {/* Subtle inner cyan-tinted top edge for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.5) 50%, transparent 100%)",
          }}
        />

        {focus.phase === "publishing" ? (
          <PublishingSplash />
        ) : (
          <>
            <Header onClose={focus.close} />
            <FocusModeProgress stage={focus.stage} onJump={focus.goToStage} />
            <div className="relative flex-1 overflow-y-auto">
              <StageContent
                stage={focus.stage}
                sessionId={sessionId}
                nodes={nodes}
                hoveredNodeId={focus.hoveredNodeId}
                onHover={focus.setHoveredNodeId}
                onSetOverride={focus.setOverride}
                onFocusNode={onFocusNode}
                sharpeningAnswers={sharpeningAnswers}
                setSharpeningAnswers={setSharpeningAnswers}
                onNext={focus.next}
                onSkipToPublish={() => focus.goToStage(4)}
                onPublishStart={focus.beginPublishing}
                onPublishComplete={focus.endPublishing}
              />
            </div>
            <Footer focus={focus} />
          </>
        )}
      </aside>

      {/* CSS for entrance fade-in cascade on Stage 1 cards */}
      <style jsx global>{`
        @keyframes focusModeFadeIn {
          0% {
            opacity: 0;
            transform: translateY(6px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}

// ── Header bar ──

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-gray-200/60 px-6 pt-5 pb-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-gray-900">
            Focus mode
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
            Convergence ritual
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
          ESC
        </span>
        <button
          onClick={onClose}
          aria-label="Close focus mode"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Stage content router ──

function StageContent({
  stage,
  sessionId,
  nodes,
  hoveredNodeId,
  onHover,
  onSetOverride,
  onFocusNode,
  sharpeningAnswers,
  setSharpeningAnswers,
  onNext,
  onSkipToPublish,
  onPublishStart,
  onPublishComplete,
}: {
  stage: 1 | 2 | 3 | 4;
  sessionId: string;
  nodes: ClientNode[];
  hoveredNodeId: string | null;
  onHover: (id: string | null) => void;
  onSetOverride: (
    id: string,
    value: "keep" | "exclude" | null,
  ) => void;
  onFocusNode: (id: string) => void;
  sharpeningAnswers: Record<string, string>;
  setSharpeningAnswers: (a: Record<string, string>) => void;
  onNext: () => void;
  onSkipToPublish: () => void;
  onPublishStart: () => void;
  onPublishComplete: () => void;
}) {
  // overrides come down through onSetOverride; FocusModeStage1 reads
  // them from the parent via the focus object. To keep the component
  // boundary clean, Stage1 receives overrides via props from the
  // overlay; here we re-derive them from a parent-supplied map by
  // making the Overlay rebuild children with fresh overrides reference.
  // Simpler approach: pass a no-op fallback and have Stage1 watch
  // setOverride's effect indirectly. But Stage1 needs the actual map
  // to render the chip state. We accept the overrides prop directly
  // from the caller's `focus.overrides` here.
  return (
    <div
      key={stage}
      style={{ animation: "focusModeFadeIn 350ms ease both" }}
    >
      {stage === 1 && (
        <FocusModeStage1WithOverrides
          nodes={nodes}
          hoveredNodeId={hoveredNodeId}
          onHover={onHover}
          onSetOverride={onSetOverride}
          onFocusNode={onFocusNode}
        />
      )}
      {stage === 2 && (
        <FocusModeStage2 sessionId={sessionId} autoExtract={true} />
      )}
      {stage === 3 && (
        <FocusModeStage3
          sessionId={sessionId}
          nodes={nodes}
          initialAnswers={sharpeningAnswers}
          onAnswersChange={setSharpeningAnswers}
          onSkip={onSkipToPublish}
          onDone={onNext}
        />
      )}
      {stage === 4 && (
        <FocusModeStage4
          sessionId={sessionId}
          sharpeningAnswers={sharpeningAnswers}
          onPublishStart={onPublishStart}
          onPublishComplete={onPublishComplete}
        />
      )}
    </div>
  );
}

// Wrapper that reads overrides from a context-less prop chain. We use
// a forced-re-render via key on the parent for now; Stage1's own
// overrides prop is re-derived from outside.
function FocusModeStage1WithOverrides(props: {
  nodes: ClientNode[];
  hoveredNodeId: string | null;
  onHover: (id: string | null) => void;
  onSetOverride: (id: string, value: "keep" | "exclude" | null) => void;
  onFocusNode: (id: string) => void;
}) {
  // Local override map mirrors parent state visually; parent maintains
  // the source of truth via onSetOverride callback. This local copy
  // lets Stage1 render synchronously without prop drilling through
  // every render of the focus state.
  const [localOverrides, setLocalOverrides] = useState<
    Map<string, "keep" | "exclude">
  >(new Map());
  useEffect(() => {
    // Reset local when nodes change (board edited externally)
    setLocalOverrides(new Map());
  }, [props.nodes.length]);
  const handleSet = (id: string, v: "keep" | "exclude" | null) => {
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      if (v === null) next.delete(id);
      else next.set(id, v);
      return next;
    });
    props.onSetOverride(id, v);
  };
  return (
    <FocusModeStage1
      nodes={props.nodes}
      overrides={localOverrides}
      hoveredNodeId={props.hoveredNodeId}
      onHover={props.onHover}
      onSetOverride={handleSet}
      onFocusNode={props.onFocusNode}
    />
  );
}

// ── Sticky footer with Back/Continue ──

function Footer({ focus }: { focus: UseFocusModeReturn }) {
  const onLastStage = focus.stage === 4;
  return (
    <div
      className="border-t border-gray-200/60 px-6 py-4"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.85) 50%)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={focus.stage === 1 ? focus.close : focus.prev}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400"
        >
          <ArrowLeft className="h-3 w-3" />
          {focus.stage === 1 ? "Cancel" : "Back"}
        </button>
        {!onLastStage && (
          <button
            onClick={focus.next}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
          >
            Continue
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Publishing splash ──
//
// Replaces the pane content during the strategy-gen LLM call. The
// cyan radial gradient + the "Crystallizing" line both feed the
// emotional payoff the user is supposed to feel.

function PublishingSplash() {
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center px-8"
      style={{
        background:
          "radial-gradient(circle at 50% 30%, rgba(6,182,212,0.18) 0%, transparent 70%)",
      }}
    >
      <div className="relative">
        <div
          className="absolute inset-0 -m-6 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(6,182,212,0.35), transparent 60%)",
            animation: "focusPublishPulse 2s ease-in-out infinite",
          }}
        />
        <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
      </div>
      <h2 className="mt-6 text-center text-[22px] font-semibold leading-snug tracking-tight text-gray-900">
        Crystallizing your strategy…
      </h2>
      <p className="mt-2 max-w-[320px] text-center text-[12px] leading-relaxed text-gray-600">
        Reading plan synthesis. Mirroring decided steps. Indexing matchable
        components into the marketplace.
      </p>
      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-medium text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        Almost there
      </div>
      <style jsx>{`
        @keyframes focusPublishPulse {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}
