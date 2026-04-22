"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Zap,
  StickyNote,
  Maximize2,
  ArrowRight,
  Sparkles,
  Command as CommandIcon,
  Image as ImageIcon,
  Group as GroupIcon,
  FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";

export type PaletteCommandId =
  | "new-sticky"
  | "group-selection"
  | "toggle-fullscreen"
  | "decompose-active"
  | "export-png"
  | "run-synthesis"
  | "help-shortcuts";

export interface PaletteCommand {
  id: PaletteCommandId;
  label: string;
  shortcut?: string;
  icon: typeof Zap;
  /** Disabled commands show but are muted; useful to hint at gated flows */
  disabled?: boolean;
  disabledReason?: string;
}

export interface CanvasCommandPaletteProps {
  open: boolean;
  entities: Entity[];
  onClose: () => void;
  onJumpToEntity: (entity: Entity) => void;
  onRunCommand: (id: PaletteCommandId) => void;
  commandsState: Partial<Record<PaletteCommandId, { disabled?: boolean; disabledReason?: string }>>;
}

const DEFAULT_COMMANDS: PaletteCommand[] = [
  { id: "new-sticky", label: "New sticky note", shortcut: "N", icon: StickyNote },
  { id: "group-selection", label: "Group selection into cluster", shortcut: "G", icon: GroupIcon },
  { id: "decompose-active", label: "Decompose active sticky / node", shortcut: "⌘↵", icon: Zap },
  { id: "toggle-fullscreen", label: "Toggle fullscreen", shortcut: "F", icon: Maximize2 },
  { id: "export-png", label: "Export whiteboard as PNG", shortcut: "⌘E", icon: FileDown },
  { id: "run-synthesis", label: "Run synthesis across space", icon: Sparkles },
  { id: "help-shortcuts", label: "Keyboard shortcuts", shortcut: "?", icon: CommandIcon },
];

export function CanvasCommandPalette({
  open,
  entities,
  onClose,
  onJumpToEntity,
  onRunCommand,
  commandsState,
}: CanvasCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Autofocus the input
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const matchingEntities = useMemo(() => {
    if (!query.trim()) return entities.slice(0, 8);
    const q = query.toLowerCase();
    return entities
      .map((e) => {
        const hay = `${e.name} ${e.description ?? ""}`.toLowerCase();
        const idx = hay.indexOf(q);
        const score = idx >= 0 ? 1000 - idx : 0;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.e);
  }, [entities, query]);

  const matchingCommands = useMemo(() => {
    if (!query.trim()) return DEFAULT_COMMANDS;
    const q = query.toLowerCase();
    return DEFAULT_COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  const items = useMemo(
    () => [
      ...matchingEntities.map((e) => ({ kind: "entity" as const, entity: e })),
      ...matchingCommands.map((c) => ({ kind: "command" as const, command: c })),
    ],
    [matchingEntities, matchingCommands],
  );

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  const select = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      if (item.kind === "entity") {
        onJumpToEntity(item.entity);
      } else {
        const state = commandsState[item.command.id];
        if (item.command.disabled || state?.disabled) return;
        onRunCommand(item.command.id);
      }
      onClose();
    },
    [items, onJumpToEntity, onRunCommand, onClose, commandsState],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        select(cursor);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cursor, items.length, select, onClose]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entities or run a command…"
            className="flex-1 bg-transparent text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <kbd className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-gray-400">
              No matches for &ldquo;{query}&rdquo;
            </div>
          )}
          {items.map((item, i) => {
            const active = cursor === i;
            if (item.kind === "entity") {
              return (
                <PaletteRow
                  key={`e-${item.entity.id}`}
                  active={active}
                  icon={<div className="h-2 w-2 rounded-full bg-blue-500" />}
                  label={item.entity.name}
                  hint={item.entity.description ? item.entity.description.slice(0, 60) : (item.entity.entity_category as string) ?? ""}
                  trailing={<ChipTrailing text="jump" />}
                  onHover={() => setCursor(i)}
                  onClick={() => select(i)}
                />
              );
            }
            const state = commandsState[item.command.id];
            const disabled = item.command.disabled || state?.disabled;
            const reason = item.command.disabledReason ?? state?.disabledReason;
            const Icon = item.command.icon;
            return (
              <PaletteRow
                key={`c-${item.command.id}`}
                active={active}
                disabled={disabled}
                icon={<Icon className="h-3.5 w-3.5 text-gray-500" strokeWidth={1.8} />}
                label={item.command.label}
                hint={disabled ? reason : undefined}
                trailing={
                  item.command.shortcut ? (
                    <kbd className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {item.command.shortcut}
                    </kbd>
                  ) : (
                    <ChipTrailing text="run" />
                  )
                }
                onHover={() => setCursor(i)}
                onClick={() => select(i)}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/70 px-3 py-1.5 text-[10px] text-gray-400">
          <span>
            <kbd className="rounded bg-white px-1 text-[9.5px]">↑↓</kbd> navigate ·{" "}
            <kbd className="rounded bg-white px-1 text-[9.5px]">↵</kbd> select
          </span>
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  active,
  disabled,
  icon,
  label,
  hint,
  trailing,
  onHover,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  trailing?: React.ReactNode;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      onMouseEnter={onHover}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active && !disabled && "bg-blue-50",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-gray-200">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13px] font-semibold text-gray-900">{label}</div>
        {hint && <div className="truncate text-[10.5px] text-gray-500">{hint}</div>}
      </div>
      {trailing}
    </button>
  );
}

function ChipTrailing({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1 text-[9.5px] font-semibold text-gray-400">
      <ArrowRight className="h-2.5 w-2.5" />
      {text}
    </span>
  );
}

// Silence unused import warning — ImageIcon reserved for future "insert image" command.
void ImageIcon;
