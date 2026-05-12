// ── Synergy whiteboard left toolbar ──
//
// 64px-wide rail with: back link, tool selector (select/pen/sticky/eraser),
// tidy-up, reset view, and (at the bottom) clear board. The active tool
// state lives in the parent — this is pure presentation + callbacks.

"use client";

import Link from "next/link";
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
    <aside className="flex w-16 flex-col items-center justify-between border-r border-gray-200 bg-white/80 py-4 backdrop-blur">
      <div className="flex flex-col items-center gap-2">
        <Link
          href="/app/synergy"
          className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          aria-label="Back to brainstorms"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <ToolBtn
          label="Select (V)"
          active={tool === "select"}
          onClick={() => onToolChange("select")}
        >
          <MousePointer2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          label="Pen (P)"
          active={tool === "pen"}
          onClick={() => onToolChange("pen")}
        >
          <Pencil className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          label="Sticky note (N)"
          active={tool === "note"}
          onClick={() => onToolChange("note")}
        >
          <StickyNote className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          label="Eraser (E)"
          active={tool === "eraser"}
          onClick={() => onToolChange("eraser")}
        >
          <Eraser className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          label="Connect (C) — click two cards to link"
          active={tool === "connect"}
          onClick={() => onToolChange("connect")}
        >
          <Link2 className="h-4 w-4" />
        </ToolBtn>
        <div className="my-1 h-px w-6 bg-gray-200" />
        <button
          onClick={onTidy}
          aria-label="Tidy up layout"
          title="Tidy up — reflow into a clean radial tree"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
        >
          <Sparkles className="h-4 w-4" />
        </button>
        <button
          onClick={onResetView}
          aria-label="Reset view"
          title="Reset pan & zoom"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <button
        onClick={onClear}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-rose-50 hover:text-rose-600"
        aria-label="Clear board"
        title="Clear board (keep only the core seed)"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </aside>
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
      title={label}
      className={[
        "inline-flex h-9 w-9 items-center justify-center rounded-lg transition",
        active
          ? "bg-blue-600 text-white shadow"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
