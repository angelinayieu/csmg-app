"use client";

// Unified empty state — shown ONCE at the page level when the space
// has no entities AND no synthesis. Replaces the three stacked empty
// messages ("Drop a paper", "Waiting for signal", "No synthesis yet")
// that confuse first-time users.
//
// Acts as its own drop zone — the user can drop a file anywhere over
// this overlay without aiming at the left panel. Dispatches a window
// event the raw-signal panel listens for, so the existing drop flow
// (parse → HITL drawer) handles the rest. Keeps the drop logic in ONE
// place instead of duplicating it.

import { useCallback, useRef, useState } from "react";

interface UnifiedEmptyStateProps {
  /** Fired when the user drops files anywhere over the overlay. Same
   *  contract as the raw-signal panel's drop handler — parent forwards
   *  to the same code path. */
  onFilesDropped: (files: File[]) => void;
}

export function UnifiedEmptyState({ onFilesDropped }: UnifiedEmptyStateProps) {
  const [dropActive, setDropActive] = useState(false);
  const dragCount = useRef(0);

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

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        // Sit ABOVE the per-panel empty states (they're z-0 within
        // each panel) but BELOW the HITL drawer (z-50). Background
        // is transparent so the panel layouts show through faintly,
        // hinting at what fills in once data lands.
        background: dropActive
          ? "radial-gradient(circle at center, rgba(74, 222, 128, 0.10) 0%, rgba(15, 23, 42, 0.45) 80%)"
          : "rgba(248, 250, 252, 0.85)",
        backdropFilter: dropActive ? "blur(2px)" : "blur(6px)",
        transition: "background 220ms ease, backdrop-filter 220ms ease",
      }}
    >
      <div
        className="pointer-events-none flex flex-col items-center text-center"
        style={{
          maxWidth: 560,
          padding: "0 32px",
        }}
      >
        {/* Eyebrow */}
        <div
          className="mb-3 text-[9.5px] font-bold uppercase tracking-[0.28em]"
          style={{ color: dropActive ? "#4ade80" : "rgb(99, 102, 241)" }}
        >
          {dropActive ? "◉ Drop to seed" : "Synthesis Lab"}
        </div>

        {/* Headline */}
        <div
          className="mb-3 text-[22px] font-bold leading-tight text-slate-900"
          style={{ letterSpacing: "-0.01em" }}
        >
          {dropActive
            ? "Release to add to raw signal"
            : "Drop a paper. Watch the graph form. Read the insights."}
        </div>

        {/* Sub-copy explaining the 3-panel workflow */}
        <div
          className="mb-7 text-[12.5px] leading-relaxed text-slate-600"
          style={{ maxWidth: 460 }}
        >
          This is the deep-workshop view. Drop a PDF, paste a concept, or
          add a sticky in the <strong>left panel</strong>. Your knowledge
          graph forms in the <strong>middle</strong> as the pipeline runs.
          Leverage points, hidden signals, and guardrail questions surface
          on the <strong>right</strong>.
        </div>

        {/* 3-step illustration */}
        <div className="mb-7 flex items-center gap-4">
          <Step number="1" title="Raw signal" subtitle="drop / paste" tone="indigo" />
          <Connector />
          <Step number="2" title="KG develops" subtitle="entities + edges" tone="teal" />
          <Connector />
          <Step number="3" title="Insights surface" subtitle="leverage · axioms" tone="amber" />
        </div>

        {/* Hint row */}
        <div
          className="rounded-full px-4 py-1.5 text-[10.5px] font-medium"
          style={{
            background: "rgba(15, 23, 42, 0.04)",
            color: "rgb(71, 85, 105)",
          }}
        >
          {dropActive ? (
            <>📎 Files detected — release anywhere</>
          ) : (
            <>
              Drag a PDF anywhere over this view, or paste into the left
              panel
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Three-step illustration ──────────────────────────────────────────
// Compact cards laid out horizontally. Each shows a numbered step + a
// 1-line label + a tonal accent. Reading left → right matches the
// 3-panel layout.
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
    <div className="flex flex-col items-center" style={{ minWidth: 96 }}>
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
