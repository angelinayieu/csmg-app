"use client";

// Lightbox view for a generated screen. Centered large image with a
// dim backdrop. Esc / backdrop click closes. Bottom toolbar exposes
// the actions users actually want: download, regenerate, open the
// target artifact page, delete.
//
// We deliberately don't use a portal — the lightbox renders into
// triple-lab's tree at z-50 (above the HITL drawer at z-50; we use
// z-[60] here to win the stacking). Future portal refactor if we
// add another lab-internal modal at the same layer.

import { useEffect } from "react";
import type { ScreenRow } from "@/app/api/spaces/[id]/screens/route";
import { colors, tracking } from "./tokens";

interface ScreenLightboxProps {
  screen: ScreenRow;
  onClose: () => void;
  // Trigger a new generation with the same target — opens the modal
  // upstream with target pre-filled. Implementation can be optional;
  // when undefined the button is hidden.
  onRegenerate?: () => void;
  // Permanent delete. Same — optional.
  onDelete?: () => void;
  // Link to the target artifact's detail page when applicable.
  targetHref?: string;
}

export function ScreenLightbox({
  screen,
  onClose,
  onRegenerate,
  onDelete,
  targetHref,
}: ScreenLightboxProps) {
  // Esc to close — standard modal convention.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll while open so the backdrop click target stays
  // reliable. Restore on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background: "rgba(8, 12, 22, 0.85)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Inner content blocks click propagation so backdrop-click only
       *  fires on the actual backdrop. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] max-w-[92vw] flex-col gap-3"
      >
        {/* Header strip — caption + close */}
        <div className="flex items-center justify-between gap-4 text-white">
          <div className="min-w-0">
            <div
              className="text-[9px] font-bold uppercase opacity-70"
              style={{ letterSpacing: tracking.eyebrow }}
            >
              {screen.target_kind} · {screen.artifact_type}
            </div>
            <div className="mt-0.5 truncate text-[14px] font-semibold">
              {screen.target_label ?? "Untitled screen"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-white transition-colors hover:bg-white/10"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Image */}
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            boxShadow: "0 24px 48px rgba(0, 0, 0, 0.4)",
          }}
        >
          {screen.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screen.image_url}
              alt={screen.target_label ?? "Generated screen"}
              className="max-h-[78vh] max-w-[88vw] object-contain"
              style={{ display: "block" }}
            />
          ) : (
            <div className="flex h-64 w-96 items-center justify-center text-white/60">
              {screen.status === "error"
                ? `Failed: ${screen.error_message ?? "Unknown error"}`
                : "No image"}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-2">
            {screen.prompt_brief && (
              <div
                className="max-w-[420px] truncate text-[10.5px] italic opacity-70"
                title={screen.prompt_brief}
              >
                Brief: {screen.prompt_brief}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {screen.image_url && (
              <a
                href={screen.image_url}
                download={`screen-${screen.id}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-3 py-1.5 text-[10.5px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                ↓ Download
              </a>
            )}
            {targetHref && (
              <a
                href={targetHref}
                className="rounded-md px-3 py-1.5 text-[10.5px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                Open target →
              </a>
            )}
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="rounded-md px-3 py-1.5 text-[10.5px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                ↻ Regenerate
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-md px-3 py-1.5 text-[10.5px] font-semibold transition-colors hover:bg-white/10"
                style={{ color: colors.state.bottleneck }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
