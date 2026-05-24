"use client";

// LibraryDrawer — Phase 6b.
//
// Collapsible bottom drawer for the LEFT column. Wraps the original
// RawSignalPanel (the user-dropped card list) so it stays accessible
// without dominating the column. The ReasoningWhiteboard sits ABOVE
// this drawer as the primary surface.
//
// States:
//   closed  → 44px header strip with title + count + expand chevron
//   open    → expands to ~40% of column height (resizable in future)
//
// Persistence: open/closed state is localStorage-keyed by space so the
// user's preference survives reloads. Defaults to CLOSED — the
// whiteboard is the primary surface and the library is a "tucked-away"
// inventory that the user opens when they need to find a specific card.

import { useCallback, useEffect, useState } from "react";
import type { Entity, Edge } from "@/types";
import { RawSignalPanel } from "./raw-signal-panel";
import { colors, tracking } from "./tokens";
import type { UploadProgress } from "./upload-flow";

const STORAGE_KEY_PREFIX = "triple-lab:library-drawer:";
const DEFAULT_OPEN_FRACTION = 0.42; // ~42% of column height when open

function loadOpen(spaceId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + spaceId);
    if (raw === null) return false; // default closed
    return raw === "1";
  } catch {
    return false;
  }
}

function saveOpen(spaceId: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + spaceId, open ? "1" : "0");
  } catch {
    // ignore
  }
}

// Count of raw-signal entities — duplicated from raw-signal-panel's
// internal filter so the header chip is accurate when collapsed. Kept
// in lock-step with isRawSignal() in raw-signal-panel.tsx.
function countRawSignal(entities: Entity[]): number {
  let n = 0;
  for (const e of entities) {
    if (e.source_tag === "explicit") {
      n += 1;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prov = (e as any).provenance as Record<string, unknown> | null | undefined;
    if (prov && typeof prov === "object") {
      const t = prov.source_type;
      if (
        typeof t === "string" &&
        (t.startsWith("asset:") ||
          t === "manual" ||
          t === "sticky" ||
          t === "playground_materialize" ||
          t === "user_seed")
      ) {
        n += 1;
      }
    }
  }
  return n;
}

interface LibraryDrawerProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  expansionMode: boolean;
  onExpansionModeChange: (v: boolean) => void;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  onAssetReady: (
    assetId: string,
    assetName: string,
    assetClass: string | null,
  ) => Promise<void>;
  onUploadProgress?: (progress: UploadProgress) => void;
}

export function LibraryDrawer({
  spaceId,
  entities,
  edges,
  expansionMode,
  onExpansionModeChange,
  selectedEntityId,
  onSelectEntity,
  onAssetReady,
  onUploadProgress,
}: LibraryDrawerProps) {
  const [open, setOpenRaw] = useState<boolean>(() => loadOpen(spaceId));
  // Re-load on space change so each space remembers its own preference.
  useEffect(() => {
    setOpenRaw(loadOpen(spaceId));
  }, [spaceId]);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenRaw(next);
      saveOpen(spaceId, next);
    },
    [spaceId],
  );

  const rawCount = countRawSignal(entities);

  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{
        // Closed = 44px header strip; open = fraction of column height
        height: open ? `${DEFAULT_OPEN_FRACTION * 100}%` : 44,
        transition: "height 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        borderTop: `1px solid ${colors.neutral.borderFaint}`,
        background: open ? colors.neutral.panelBg : colors.neutral.panelBgFlat,
        backdropFilter: "blur(6px)",
      }}
    >
      {/* ── Drawer header (always visible) ─────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group flex h-[44px] w-full items-center justify-between px-4 transition-colors hover:bg-white/40"
        style={{
          borderBottom: open ? `1px solid ${colors.neutral.borderFaint}` : "none",
        }}
        title={open ? "Collapse library" : "Expand library"}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-sm"
            style={{
              background: colors.brand.bgSoft,
              color: colors.brand.fg,
              fontSize: 10,
              letterSpacing: tracking.eyebrow,
              fontWeight: 700,
            }}
          >
            ▤
          </span>
          <div className="flex flex-col items-start">
            <div
              className="text-[9px] font-bold uppercase text-slate-500"
              style={{ letterSpacing: tracking.eyebrow }}
            >
              Library
            </div>
            <div className="text-[11px] font-semibold text-slate-700">
              {rawCount} card{rawCount === 1 ? "" : "s"} dropped
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtle hint when closed so the user knows why this strip exists */}
          {!open && (
            <span
              className="hidden text-[10px] text-slate-400 group-hover:inline-block"
              style={{ letterSpacing: "0.04em" }}
            >
              Inventory of dropped sources
            </span>
          )}
          {/* Chevron — rotates 180° when open */}
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full transition-transform"
            style={{
              border: `1px solid ${colors.neutral.borderFaint}`,
              background: "rgba(255, 255, 255, 0.85)",
              color: colors.neutral.fg500,
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <span className="font-mono text-[12px] leading-none">⌃</span>
          </span>
        </div>
      </button>

      {/* ── Drawer body — only rendered when open so the closed state
       *    doesn't pay the cost of rendering the card list ─────────── */}
      {open && (
        <div className="h-[calc(100%-44px)] overflow-hidden">
          <RawSignalPanel
            spaceId={spaceId}
            entities={entities}
            edges={edges}
            expansionMode={expansionMode}
            onExpansionModeChange={onExpansionModeChange}
            selectedEntityId={selectedEntityId}
            onSelectEntity={onSelectEntity}
            onAssetReady={onAssetReady}
            onUploadProgress={onUploadProgress}
            disableDropZone
          />
        </div>
      )}
    </div>
  );
}
