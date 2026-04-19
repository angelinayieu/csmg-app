"use client";

// ── SpacePicker ──
//
// Modal dialog — appears when the user submits a brainstorm thought.
// Shows options:
//   1. Create a new space (requires no picking)
//   2. Pick an existing space from the user's list (recent first)
//   3. Cancel
//
// This is the "where should this go?" decision point that makes brainstorm
// explicit rather than ambient.

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { X, Plus, FolderOpen, Search, Loader2, Check } from "lucide-react";

export interface PickerSpace {
  id: string;
  name: string;
  entity_count?: number;
}

interface Props {
  open: boolean;
  userText: string;
  spaces: PickerSpace[];
  // Spaces that the router/detector suggests are a strong fit (by id)
  suggestedSpaceIds?: string[];
  submitting: boolean;
  onCancel: () => void;
  onCreateNew: (name: string) => void;
  onPickExisting: (spaceId: string) => void;
}

export function SpacePicker({
  open,
  userText,
  spaces,
  suggestedSpaceIds,
  submitting,
  onCancel,
  onCreateNew,
  onPickExisting,
}: Props) {
  const [mode, setMode] = useState<"choose" | "new_space">("choose");
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");

  const filteredSpaces = useMemo(() => {
    if (!query.trim()) return spaces;
    const q = query.toLowerCase();
    return spaces.filter((s) => s.name.toLowerCase().includes(q));
  }, [spaces, query]);

  const suggested = useMemo(() => {
    if (!suggestedSpaceIds || suggestedSpaceIds.length === 0) return [];
    const set = new Set(suggestedSpaceIds);
    return spaces.filter((s) => set.has(s.id));
  }, [spaces, suggestedSpaceIds]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 backdrop-blur-sm" onClick={submitting ? undefined : onCancel}>
      <div
        className="w-full max-w-lg mx-4 rounded-xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-0.5">
              Where should this go?
            </div>
            <p className="text-sm text-gray-700 italic line-clamp-2">“{userText.slice(0, 160)}”</p>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "choose" && (
          <div className="p-4 space-y-4">
            {/* New space option */}
            <button
              onClick={() => setMode("new_space")}
              disabled={submitting}
              className={cn(
                "w-full text-left rounded-lg border-2 border-dashed p-4 transition-colors",
                submitting
                  ? "border-gray-200 opacity-60"
                  : "border-indigo-300 bg-indigo-50/40 hover:bg-indigo-50 hover:border-indigo-400",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded grid place-items-center bg-indigo-100 text-indigo-600">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">Create a new space</div>
                  <p className="text-[12px] text-gray-600 mt-0.5 leading-snug">
                    Starts a fresh analytical space with this entity as its seed. Use when the thought
                    doesn't fit any existing space.
                  </p>
                </div>
              </div>
            </button>

            {/* Existing spaces */}
            {spaces.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Or add to an existing space
                  </div>
                </div>

                {/* Suggestions from detection */}
                {suggested.length > 0 && (
                  <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 mb-1.5 px-1">
                      Suggested matches
                    </div>
                    <div className="space-y-1">
                      {suggested.map((s) => (
                        <ExistingSpaceRow
                          key={s.id}
                          space={s}
                          highlighted
                          disabled={submitting}
                          onClick={() => onPickExisting(s.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Search */}
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <Search className="h-3 w-3 text-gray-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search spaces…"
                    className="flex-1 bg-transparent text-[12px] text-gray-700 placeholder:text-gray-400 outline-none"
                  />
                </div>

                {/* Full list */}
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {filteredSpaces.map((s) => (
                    <ExistingSpaceRow
                      key={s.id}
                      space={s}
                      disabled={submitting}
                      onClick={() => onPickExisting(s.id)}
                    />
                  ))}
                  {filteredSpaces.length === 0 && (
                    <div className="text-center text-xs text-gray-400 py-4">No spaces match "{query}"</div>
                  )}
                </div>
              </div>
            )}

            {spaces.length === 0 && (
              <div className="text-center text-xs text-gray-500 px-4 py-6 border border-dashed border-gray-200 rounded-lg">
                No existing spaces. Creating a new one is your only option.
              </div>
            )}
          </div>
        )}

        {mode === "new_space" && (
          <div className="p-5 space-y-3">
            <label className="block">
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
                Name the new space
              </div>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={userText.split(/\s/).slice(0, 5).join(" ").slice(0, 60)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                autoFocus
              />
              <p className="mt-1 text-[11px] text-gray-500">
                If blank, we'll use the first few words of your text.
              </p>
            </label>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setMode("choose")}
                disabled={submitting}
                className="px-3 py-1.5 rounded text-[12px] font-medium text-gray-600 hover:bg-gray-100"
              >
                Back
              </button>
              <button
                onClick={() => onCreateNew(newName.trim())}
                disabled={submitting}
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
                  submitting
                    ? "bg-gray-100 text-gray-400 cursor-wait"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
                )}
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {submitting ? "Creating…" : "Create space"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Existing space row ──

function ExistingSpaceRow({
  space,
  highlighted,
  disabled,
  onClick,
}: {
  space: PickerSpace;
  highlighted?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full text-left rounded p-2 flex items-center gap-2 transition-colors",
        highlighted
          ? "bg-white hover:bg-emerald-50 border border-emerald-200"
          : "hover:bg-gray-50",
        disabled && "opacity-60 cursor-wait",
      )}
    >
      <FolderOpen className={cn("h-3.5 w-3.5 flex-shrink-0", highlighted ? "text-emerald-600" : "text-gray-400")} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-gray-900 truncate">{space.name}</div>
      </div>
      {typeof space.entity_count === "number" && space.entity_count > 0 && (
        <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">
          {space.entity_count} entities
        </span>
      )}
    </button>
  );
}
