// ── Synergy whiteboard left toolbar (Vision Pro chrome) ──
//
// 68px-wide rail that floats inside its own glass frame rather than
// sitting flush against a hard divider. Active tool reads as a soft
// accent well (no saturated blue square), every button is a 40px hit
// target, and the rail spring-eases on hover so the surface feels
// alive. The semantically loud "clear board" is moved to the bottom
// behind a hover-only treatment so the rail's main column stays calm.

"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Eraser,
  Link2,
  Maximize2,
  MousePointer2,
  Pencil,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";

export type SynergyTool = "select" | "pen" | "note" | "eraser" | "connect";

interface Props {
  tool: SynergyTool;
  onToolChange: (next: SynergyTool) => void;
  onTidy: () => void;
  onResetView: () => void;
  onClear: () => void;
}

export function SynergyToolbar({
  tool,
  onToolChange,
  onTidy,
  onResetView,
  onClear,
}: Props) {
  return (
    <aside
      className="relative z-10 flex w-[68px] flex-col items-center justify-between py-4"
      style={{
        // Frosted glass plate — light catches the top lip via inset
        // highlight; soft hairline on the right edge replaces the
        // hard gray-200 divider.
        background: "var(--glass-plate-bg)",
        backdropFilter: "blur(var(--blur-card)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--blur-card)) saturate(1.6)",
        borderRight: "1px solid var(--glass-hairline)",
        boxShadow: "inset 0 1px 0 var(--glass-highlight)",
      }}
    >
      <div className="flex flex-col items-center gap-1.5">
        <Link
          href="/app/synergy"
          aria-label="Back to brainstorms"
          title="Back to brainstorms"
          className="group mb-1 inline-flex h-10 w-10 items-center justify-center rounded-2xl text-slate-500 transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] hover:-translate-x-0.5 hover:bg-black/[0.04] hover:text-slate-900"
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </Link>

        {/* Subtle "intelligent canvas" mark — the small sparkle reads as
            an ambient signature of the rail, not a button. Pulses gently
            via CSS so the user feels the AI presence without it asking
            for attention. */}
        <div
          className="mb-2 flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, rgba(10,132,255,0.16), rgba(124,58,237,0.08) 60%, transparent 80%)",
          }}
          aria-hidden
        >
          <Sparkles
            className="h-3 w-3 text-[rgba(10,132,255,0.85)]"
            strokeWidth={1.75}
            style={{ filter: "drop-shadow(0 0 6px rgba(10,132,255,0.35))" }}
          />
        </div>

        <ToolBtn
          label="Select (V)"
          active={tool === "select"}
          onClick={() => onToolChange("select")}
        >
          <MousePointer2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn
          label="Pen (P)"
          active={tool === "pen"}
          onClick={() => onToolChange("pen")}
        >
          <Pencil className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn
          label="Sticky note (N)"
          active={tool === "note"}
          onClick={() => onToolChange("note")}
        >
          <StickyNote className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn
          label="Eraser (E)"
          active={tool === "eraser"}
          onClick={() => onToolChange("eraser")}
        >
          <Eraser className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn
          label="Connect (C) — click two cards to link"
          active={tool === "connect"}
          onClick={() => onToolChange("connect")}
        >
          <Link2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </ToolBtn>

        <div
          className="my-2 h-px w-7 rounded-full"
          style={{ background: "var(--glass-border)" }}
          aria-hidden
        />

        <UtilityBtn
          label="Tidy up — reflow into a clean radial tree"
          onClick={onTidy}
        >
          <TidyGlyph />
        </UtilityBtn>
        <UtilityBtn
          label="Reset pan & zoom"
          onClick={onResetView}
        >
          <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </UtilityBtn>
      </div>

      <ClearBtn onClick={onClear} />
    </aside>
  );
}

// Internal layout/reflow glyph. Avoid reusing Sparkles here — the
// rail's ambient mark above already owns the AI sparkle. Tidy is a
// spatial action; the glyph reads as nested rectangles aligning.
function TidyGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      strokeWidth={1.75}
      stroke="currentColor"
      strokeLinecap="round"
    >
      <rect x="2.5" y="3.5" width="5" height="5" rx="1.2" />
      <rect x="10.5" y="3.5" width="5" height="3.5" rx="1.2" />
      <rect x="2.5" y="11" width="5" height="3.5" rx="1.2" />
      <rect x="10.5" y="9.5" width="5" height="5" rx="1.2" />
    </svg>
  );
}

function ToolBtn({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] active:scale-[0.94]"
      style={
        active
          ? {
              // Soft accent well — fills the button with a graphite
              // gradient so the active state reads as "depressed into
              // the rail", not "saturated chip stuck on top of it".
              background:
                "linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.84) 100%)",
              color: "white",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 16px -8px rgba(15,23,42,0.45), 0 0 0 1px rgba(15,23,42,0.06)",
            }
          : {
              background: "transparent",
              color: "rgba(15,23,42,0.55)",
            }
      }
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.background = "rgba(15,23,42,0.05)";
        e.currentTarget.style.color = "rgba(15,23,42,0.9)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(15,23,42,0.55)";
      }}
    >
      {children}
    </button>
  );
}

function UtilityBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-slate-500 transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] hover:bg-black/[0.04] hover:text-slate-900 active:scale-[0.94]"
    >
      {children}
    </button>
  );
}

// Confirm-on-second-click. The first click expands the button into a
// "Clear?" affordance; the second commits. Replaces the prior hover-
// red treatment so a stray click can't nuke the board.
function ClearBtn({ onClick }: { onClick: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <button
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          window.setTimeout(() => setConfirming(false), 2400);
          return;
        }
        setConfirming(false);
        onClick();
      }}
      className="inline-flex items-center justify-center gap-1 rounded-2xl transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)]"
      style={
        confirming
          ? {
              height: 32,
              padding: "0 10px",
              background: "rgba(220,38,38,0.10)",
              color: "rgba(127,29,29,0.95)",
              boxShadow: "inset 0 0 0 1px rgba(220,38,38,0.18)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "-0.005em",
            }
          : {
              height: 40,
              width: 40,
              background: "transparent",
              color: "rgba(15,23,42,0.40)",
            }
      }
      onMouseEnter={(e) => {
        if (confirming) return;
        e.currentTarget.style.background = "rgba(15,23,42,0.04)";
        e.currentTarget.style.color = "rgba(15,23,42,0.75)";
      }}
      onMouseLeave={(e) => {
        if (confirming) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(15,23,42,0.40)";
      }}
      aria-label={confirming ? "Confirm clear board" : "Clear board"}
      title={confirming ? "Tap again to confirm" : "Clear board (keep only the core seed)"}
    >
      <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.75} />
      {confirming && <span>Confirm</span>}
    </button>
  );
}
