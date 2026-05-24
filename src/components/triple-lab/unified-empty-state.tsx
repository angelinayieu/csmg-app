"use client";

// Unified empty state — covers the 3-panel layout when the space has
// no entities AND no synthesis. TWO ways to start from here:
//
//   1. ◉ START FROM AN IDEA (primary)
//      Type a thought or question, ⌘⏎ to submit. POSTs to
//      /api/pipeline/decompose with reasoningDepth='deep'. The chain
//      auto-fires synthesize → strategy → labs and the panels fill in
//      as artifacts land.
//
//   2. Drop a paper (existing)
//      Drag any PDF/text file anywhere on this overlay. Goes through
//      the standard ingest + HITL flow.
//
// The empty state auto-dismisses as soon as ANY entity lands (managed
// by the parent's isFullyEmpty gate). While the decompose chain is
// running but no entities exist yet, we render a "decomposing" state
// with shimmer + stage progress so the user knows something is
// happening — closes the 5-15s gap between submit and first entity.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { colors, tracking } from "./tokens";

interface UnifiedEmptyStateProps {
  spaceId: string;
  /** Fired when the user drops files anywhere over the overlay. Same
   *  contract as the raw-signal panel's drop handler — parent forwards
   *  to the same code path. */
  onFilesDropped: (files: File[]) => void;
  /** Fired the moment the user clicks Decompose on the idea-entry
   *  card. Parent should dismiss the overlay so the user can watch
   *  the 3-panel layout populate in real time — instead of staring
   *  at a loading screen for the 60-180s the chain takes. */
  onSubmitStarted?: () => void;
}

// Local sub-state. "idle" = show prompt + drop affordance.
// "decomposing" = chain submitted, waiting for entities to land.
// "error" = submit failed, show retry.
type EmptyStateMode = "idle" | "decomposing" | "error";

export function UnifiedEmptyState({
  spaceId,
  onFilesDropped,
  onSubmitStarted,
}: UnifiedEmptyStateProps) {
  const router = useRouter();

  // ── Drop state ────────────────────────────────────────────────────
  const [dropActive, setDropActive] = useState(false);
  const dragCount = useRef(0);

  // ── Idea entry state ──────────────────────────────────────────────
  const [idea, setIdea] = useState<string>("");
  const [mode, setMode] = useState<EmptyStateMode>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Stage tick that advances every ~4.5s while decomposing. We
  // derive the visible label string in render from this counter
  // rather than calling setStateLabel inside an effect (which the
  // react-hooks/set-state-in-effect rule flags as cascading-render).
  const [stageTick, setStageTick] = useState<number>(0);
  const STAGE_LABELS = [
    "Decomposing your idea…",
    "Extracting concepts + axioms…",
    "Mapping causal relationships…",
    "Tracing leverage points…",
    "Almost there — surfacing insights…",
  ];
  const stageLabel = STAGE_LABELS[Math.min(stageTick, STAGE_LABELS.length - 1)];
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Drop handlers ────────────────────────────────────────────────
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCount.current += 1;
    if (dragCount.current === 1) setDropActive(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) setDropActive(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCount.current = 0;
      setDropActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      onFilesDropped(files);
    },
    [onFilesDropped],
  );

  // ── Idea submit ──────────────────────────────────────────────────
  const canSubmit = mode === "idle" && idea.trim().length >= 12;

  const submitIdea = useCallback(async () => {
    const text = idea.trim();
    if (text.length < 12) return;
    setMode("decomposing");
    setErrorMessage(null);
    // Tell the parent to dismiss the overlay IMMEDIATELY so the user
    // can watch the 3-panel layout populate in real time while the
    // chain runs server-side. The fetch below stays in flight; we
    // just stop blocking the user's view of the work happening.
    onSubmitStarted?.();
    try {
      const res = await fetch("/api/pipeline/decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          existingSpaceId: spaceId,
          reasoningDepth: "deep",
          // autoAdvance kicks the full chain: research → synthesize →
          // strategy → twin → lab. Without it the route stops after
          // entity/edge insert, so the MIDDLE insights feed never sees
          // the cycle/bridge/signal/proposal events that drive its
          // cards, and the RIGHT artifacts panel stays empty.
          autoAdvance: true,
          intent: {
            source: "triple_lab_idea_entry",
          },
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // not JSON; keep status fallback
        }
        setMode("error");
        setErrorMessage(msg);
        return;
      }
      // Decompose typically returns within a few seconds with the
      // first batch of entities. Trigger a router refresh so SpaceShell
      // re-fetches and the parent's isFullyEmpty gate flips false —
      // dismissing this overlay. We don't await any further events:
      // the live-synthesis hook in triple-lab handles the rest of the
      // chain via SSE + polling.
      router.refresh();
      // Stay in "decomposing" — the empty state will unmount as soon
      // as the parent re-renders with entities.length > 0.
    } catch (err) {
      setMode("error");
      setErrorMessage(err instanceof Error ? err.message : "Network error");
    }
  }, [idea, spaceId, router, onSubmitStarted]);

  // ⌘⏎ submit, Esc to clear-and-refocus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
        e.preventDefault();
        void submitIdea();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [canSubmit, submitIdea]);

  // Tick the stage counter so the label advances every ~4.5s during
  // the decompose wait. Pure cosmetic — the actual chain runs server-
  // side. Functional updater pattern keeps setState inside the
  // setInterval callback (not the effect body), which the
  // react-hooks/purity rule tolerates. We don't reset on mode change
  // because the empty state is unmounted by the parent the moment
  // entities land — counter stops mattering at that point.
  useEffect(() => {
    if (mode !== "decomposing") return;
    const interval = window.setInterval(() => {
      setStageTick((t) => t + 1);
    }, 4500);
    return () => window.clearInterval(interval);
  }, [mode]);

  // Autofocus textarea on mount + after error-retry.
  useEffect(() => {
    if (mode === "idle" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  return (
    <div
      className="absolute inset-0 z-30 overflow-y-auto"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        background: dropActive
          ? `radial-gradient(circle at center, ${colors.drop.halo} 0%, ${colors.drop.bgVignetteEnd} 80%)`
          : "rgba(248, 250, 252, 0.92)",
        backdropFilter: dropActive ? "blur(2px)" : "blur(6px)",
        transition: "background 220ms ease, backdrop-filter 220ms ease",
      }}
    >
      <div className="flex min-h-full items-center justify-center px-8 py-10">
        <div
          className="flex flex-col items-center text-center"
          style={{ maxWidth: 600, width: "100%" }}
        >
          {/* ── Eyebrow ─────────────────────────────────────────────── */}
          <div
            className="mb-2 text-[9.5px] font-bold uppercase"
            style={{
              color: dropActive ? colors.drop.fg : colors.brand.fg,
              letterSpacing: tracking.eyebrowLoose,
            }}
          >
            {dropActive ? "◉ Drop to seed" : "Synthesis Lab"}
          </div>

          {/* ── Headline ────────────────────────────────────────────── */}
          <div
            className="mb-2 text-[24px] font-bold leading-tight text-slate-900"
            style={{ letterSpacing: "-0.01em" }}
          >
            {dropActive
              ? "Release to add to raw signal"
              : "Start with an idea. Watch it become a structured graph."}
          </div>

          {/* ── Sub-copy ────────────────────────────────────────────── */}
          <div
            className="mb-6 text-[12.5px] leading-relaxed text-slate-600"
            style={{ maxWidth: 480 }}
          >
            Type a thought, question, or paste a chunk of writing below.
            The pipeline will decompose it into{" "}
            <strong>claims</strong>, find <strong>leverage points</strong>,
            propose <strong>experiments</strong>, and surface{" "}
            <strong>screens</strong> — all in the three panels behind this
            overlay.
          </div>

          {/* ── PRIMARY: idea entry card ────────────────────────────── */}
          <div
            className="mb-5 w-full overflow-hidden rounded-2xl border bg-white text-left"
            style={{
              borderColor: colors.brand.haloSoft,
              boxShadow: `0 12px 36px ${colors.brand.shadow}`,
            }}
          >
            {/* Card header */}
            <div
              className="flex items-center justify-between border-b px-4 py-2.5"
              style={{
                borderBottomColor: colors.neutral.borderFaint,
                background: colors.brand.bgSoft,
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="font-mono text-[11px] font-bold"
                  style={{ color: colors.brand.fg }}
                >
                  ◉
                </span>
                <span
                  className="text-[9.5px] font-bold uppercase"
                  style={{
                    color: colors.brand.fgDark,
                    letterSpacing: tracking.eyebrow,
                  }}
                >
                  Start from an idea
                </span>
              </div>
              <span
                className="text-[9px] uppercase tracking-wider text-slate-500"
              >
                primary
              </span>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={idea}
              onChange={(e) => setIdea(e.target.value.slice(0, 4000))}
              disabled={mode !== "idle"}
              placeholder="e.g., I want to optimize my afternoon cognitive performance. The 2pm dip is my biggest blocker — I work in research, my schedule is mostly flexible, but my sleep is irregular…"
              rows={5}
              className="w-full resize-none border-0 px-4 py-3 text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
              style={{ background: "white", minHeight: 120 }}
            />

            {/* Decomposing strip */}
            {mode === "decomposing" && (
              <div
                className="flex items-center gap-2.5 border-t px-4 py-2.5"
                style={{
                  borderTopColor: colors.brand.haloSoft,
                  background: colors.brand.bgPanel,
                }}
              >
                <Spinner color={colors.brand.fg} />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: colors.brand.fgDarker }}
                >
                  {stageLabel}
                </span>
                <span className="ml-auto font-mono text-[10px] text-slate-500">
                  ~30-60s
                </span>
              </div>
            )}

            {/* Error strip */}
            {mode === "error" && errorMessage && (
              <div
                className="border-t px-4 py-2.5"
                style={{
                  borderTopColor: "rgba(220, 38, 38, 0.25)",
                  background: colors.state.bottleneckSoft,
                }}
              >
                <div
                  className="text-[11px] font-semibold"
                  style={{ color: colors.state.bottleneckFg }}
                >
                  Decompose failed
                </div>
                <div
                  className="mt-0.5 text-[10.5px]"
                  style={{ color: colors.state.bottleneckFg, opacity: 0.85 }}
                >
                  {errorMessage}
                </div>
              </div>
            )}

            {/* Footer toolbar */}
            <div
              className="flex items-center justify-between border-t px-4 py-2.5"
              style={{
                borderTopColor: colors.neutral.borderFaint,
                background: colors.neutral.panelBgFlat,
              }}
            >
              <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-wider text-slate-500">
                <span>{idea.length} / 4000</span>
                <span className="text-slate-300">·</span>
                <span>deep reasoning</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9.5px] text-slate-400">⌘⏎ to submit</span>
                {mode === "error" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("idle");
                      setErrorMessage(null);
                    }}
                    className="rounded-md px-3 py-1.5 text-[11px] font-bold text-white"
                    style={{
                      background: colors.brand.gradient,
                      boxShadow: `0 4px 12px ${colors.brand.shadow}`,
                    }}
                  >
                    Try again
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submitIdea}
                    disabled={!canSubmit}
                    className="rounded-md px-3.5 py-1.5 text-[11px] font-bold text-white transition-all disabled:opacity-50"
                    style={{
                      background: canSubmit
                        ? colors.brand.gradient
                        : "rgba(15, 23, 42, 0.3)",
                      boxShadow: canSubmit
                        ? `0 6px 16px ${colors.brand.shadowStrong}`
                        : "none",
                    }}
                  >
                    {mode === "decomposing" ? "Running…" : "Decompose →"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── 3-step illustration ─────────────────────────────────── */}
          <div className="mb-5 flex items-center gap-4 opacity-80">
            <Step number="1" title="Idea seed" subtitle="prompt / paper" tone="indigo" />
            <Connector />
            <Step number="2" title="KG develops" subtitle="claims + edges" tone="teal" />
            <Connector />
            <Step number="3" title="Insights surface" subtitle="leverage · screens" tone="amber" />
          </div>

          {/* ── Secondary CTA — drop a paper ────────────────────────── */}
          <div
            className="flex items-center gap-2 rounded-full px-4 py-1.5 text-[10.5px] font-medium"
            style={{
              background: colors.neutral.chipBgStrong,
              color: colors.neutral.fg700,
            }}
          >
            {dropActive ? (
              <span>📎 Files detected — release anywhere</span>
            ) : (
              <>
                <span style={{ color: colors.neutral.fg500 }}>OR</span>
                <span>drag a PDF anywhere over this view</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Three-step illustration ──────────────────────────────────────────
function Step({
  number,
  title,
  subtitle,
  tone,
}: {
  number: string;
  title: string;
  subtitle: string;
  tone: "indigo" | "teal" | "amber";
}) {
  const tones = {
    indigo: { bg: "rgba(99, 102, 241, 0.08)", fg: "#4338CA" },
    teal: { bg: "rgba(13, 148, 136, 0.08)", fg: "#0F766E" },
    amber: { bg: "rgba(245, 158, 11, 0.10)", fg: "#B45309" },
  };
  const c = tones[tone];
  return (
    <div className="flex flex-col items-center" style={{ minWidth: 100 }}>
      <div
        className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: c.bg, color: c.fg }}
      >
        {number}
      </div>
      <div className="text-[11px] font-semibold text-slate-900">{title}</div>
      <div className="text-[10px] text-slate-500">{subtitle}</div>
    </div>
  );
}

function Connector() {
  return (
    <div
      style={{
        width: 24,
        height: 1,
        background:
          "linear-gradient(90deg, rgba(99, 102, 241, 0.25) 0%, rgba(13, 148, 136, 0.25) 50%, rgba(245, 158, 11, 0.25) 100%)",
      }}
    />
  );
}

// Small spinner for the decomposing state.
function Spinner({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      style={{ animation: "upload-toast-spin 0.9s linear infinite" }}
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke={color}
        strokeWidth="1.6"
        fill="none"
        strokeDasharray="22 30"
        strokeLinecap="round"
      />
    </svg>
  );
}
