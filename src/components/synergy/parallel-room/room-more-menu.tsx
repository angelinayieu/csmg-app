// ── Room "more" menu (⋯ popover) ──
//
// Apple-Pro popover anchored to the ⋯ button in the top bar. Two
// actions in C-4:
//   - Copy room link  — navigator.clipboard.writeText(window.location.href)
//                        + toast "Link copied"
//   - Archive room    — opens ArchiveConfirmSheet
//
// Closes on Esc, click-outside, and after a successful action. Built
// inline without a popover library (radix etc.) because we only need
// two items and the positioning is static (right-anchored to the
// trigger).

"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Link as LinkIcon, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { archiveRoom } from "@/lib/synergy/archive-client";
import { ArchiveConfirmSheet } from "./archive-confirm-sheet";

interface Props {
  roomId: string;
  /** Called after archive succeeds — parent should redirect to /rooms. */
  onArchived: () => void;
}

export function RoomMoreMenu({ roomId, onArchived }: Props) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Click outside closes
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onCopy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
      setOpen(false);
    } catch (e) {
      toast.error("Couldn't copy", { description: (e as Error).message });
    } finally {
      setCopying(false);
    }
  };

  const onArchiveConfirm = async () => {
    try {
      await archiveRoom(roomId);
      toast.success("Room archived");
      setSheetOpen(false);
      setOpen(false);
      onArchived();
    } catch (e) {
      toast.error("Couldn't archive", {
        description: (e as Error).message,
      });
      throw e; // bubble so the sheet resets pending state
    }
  };

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-40 mt-1 w-[180px] rounded-xl border border-gray-200 bg-white py-1.5"
            style={{
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.06), 0 12px 24px -8px rgba(15,23,42,0.16)",
            }}
          >
            <MenuItem
              icon={LinkIcon}
              label="Copy room link"
              onClick={onCopy}
              pending={copying}
            />
            <div className="my-1 h-px bg-gray-100" />
            <MenuItem
              icon={Archive}
              label="Archive room"
              onClick={() => {
                setOpen(false);
                setSheetOpen(true);
              }}
            />
          </div>
        )}
      </div>

      <ArchiveConfirmSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onConfirm={onArchiveConfirm}
      />
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  pending,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={pending}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] font-medium text-gray-700 transition hover:bg-gray-50 hover:text-gray-900 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
      ) : (
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {label}
    </button>
  );
}
