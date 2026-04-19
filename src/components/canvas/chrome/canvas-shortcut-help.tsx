"use client";

import { X } from "lucide-react";

const GROUPS: Array<{ title: string; items: Array<{ keys: string; label: string }> }> = [
  {
    title: "Canvas",
    items: [
      { keys: "V", label: "Select tool" },
      { keys: "H", label: "Hand / pan tool" },
      { keys: "N", label: "New sticky note" },
      { keys: "R", label: "Shape" },
      { keys: "A", label: "Arrow" },
      { keys: "T", label: "Text" },
      { keys: "D", label: "Draw (pen)" },
      { keys: "L", label: "Toggle library drawer" },
      { keys: "F", label: "Fullscreen" },
      { keys: "Esc", label: "Close probability rings" },
    ],
  },
  {
    title: "AI",
    items: [
      { keys: "⌘ ↵", label: "Decompose selected sticky" },
      { keys: "G", label: "Group selection into cluster" },
      { keys: "⌘ K", label: "Command palette" },
      { keys: "?", label: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: "⌘ Z", label: "Undo" },
      { keys: "⇧ ⌘ Z", label: "Redo" },
      { keys: "⌘ A", label: "Select all" },
      { keys: "⌘ D", label: "Duplicate" },
      { keys: "⌫", label: "Delete selection" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: "⌘ 0", label: "Reset zoom" },
      { keys: "⇧ 1", label: "Zoom to fit" },
      { keys: "⌘ +", label: "Zoom in" },
      { keys: "⌘ -", label: "Zoom out" },
      { keys: "space + drag", label: "Pan" },
    ],
  },
];

export interface CanvasShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function CanvasShortcutHelp({ open, onClose }: CanvasShortcutHelpProps) {
  if (!open) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="relative max-h-[82vh] w-[720px] max-w-[92vw] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Canvas</div>
          <div className="mt-1 text-[20px] font-bold tracking-tight text-gray-900">Keyboard shortcuts</div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                {group.title}
              </div>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between rounded-md px-1 text-[12.5px]"
                  >
                    <span className="text-gray-600">{item.label}</span>
                    <kbd className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-gray-700">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
