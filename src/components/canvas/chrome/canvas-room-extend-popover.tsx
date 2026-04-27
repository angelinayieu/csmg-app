"use client";

// ── Canvas room extend popover ─────────────────────────────────────
//
// Mounted globally on the whiteboard. Listens for the
// `canvas-room:extend` window event fired by the (+) button on
// each cascade-room shape, then opens a small Apple-style menu
// at the click coordinates with four verbs:
//
//   • Add information       — upload more files / paste text
//   • Ask a question        — query this room's content
//   • Add sub-objective     — narrower goal scoped to this room
//   • Generate more         — re-run the room's source stage with
//                             higher fan-out (more axes / more
//                             strategies / etc.)
//
// For Phase C the verbs are STUBBED — clicking dispatches a
// `canvas-room:extend-verb` window event that future PRs can wire
// to actual API endpoints. This way the visual affordance ships
// now while the implementation surfaces evolve.
//
// Visual: vertical menu, 220px wide, frosted glass with a soft
// shadow, accent-tinted icon column, item hover highlights row.
// Closes on outside-click + Escape.

import { useEffect, useState } from "react";
import {
  Plus,
  MessageCircleQuestion,
  Target,
  Sparkles,
  Upload,
} from "lucide-react";
import { STAGE_ROOMS } from "@/lib/whiteboard/room-layout";
import type { PipelineStage } from "@/types/pipeline-events";

interface ExtendDetail {
  stage: PipelineStage;
  spaceId: string;
  anchor: { x: number; y: number };
}

interface VerbConfig {
  key: "add_info" | "ask_query" | "sub_objective" | "generate_more";
  label: string;
  hint: string;
  Icon: typeof Plus;
}

const VERBS: VerbConfig[] = [
  {
    key: "add_info",
    label: "Add information",
    hint: "Upload files or paste new context",
    Icon: Upload,
  },
  {
    key: "ask_query",
    label: "Ask a question",
    hint: "Query this room's contents",
    Icon: MessageCircleQuestion,
  },
  {
    key: "sub_objective",
    label: "Add sub-objective",
    hint: "Narrower goal scoped to this room",
    Icon: Target,
  },
  {
    key: "generate_more",
    label: "Generate more",
    hint: "Re-run with higher fan-out",
    Icon: Sparkles,
  },
];

const POPOVER_W = 240;
const POPOVER_H_ESTIMATE = 268;

export function CanvasRoomExtendPopover() {
  const [detail, setDetail] = useState<ExtendDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<ExtendDetail>;
      setDetail(customEvent.detail);
    };
    window.addEventListener("canvas-room:extend", handler);
    return () => {
      window.removeEventListener("canvas-room:extend", handler);
    };
  }, []);

  // Outside click + Escape close.
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-canvas-room-popover]")) return;
      setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    // Defer the pointer listener registration so the click that opened
    // the popover doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointer);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.clearTimeout(t);
    };
  }, [detail]);

  if (!detail) return null;
  const meta = STAGE_ROOMS[detail.stage];
  if (!meta) return null;

  // Position the popover near the click, but clamp inside the viewport
  // (subtract estimated h+w + 16px margin from the right and bottom
  // edges so it never spills off screen).
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(
    8,
    Math.min(vw - POPOVER_W - 8, detail.anchor.x - POPOVER_W + 24),
  );
  const top = Math.max(
    8,
    Math.min(vh - POPOVER_H_ESTIMATE - 8, detail.anchor.y + 12),
  );

  const handleVerbClick = (verbKey: VerbConfig["key"]) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("canvas-room:extend-verb", {
          detail: {
            stage: detail.stage,
            spaceId: detail.spaceId,
            verb: verbKey,
          },
        }),
      );
    }
    setDetail(null);
  };

  return (
    <div
      data-canvas-room-popover
      style={{
        position: "fixed",
        left,
        top,
        width: POPOVER_W,
        zIndex: 1000,
        animation: "room-popover-enter 200ms cubic-bezier(0.22, 1, 0.36, 1) 1",
      }}
    >
      <style jsx global>{`
        @keyframes room-popover-enter {
          0% {
            opacity: 0;
            transform: translateY(-6px) scale(0.97);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
      <div
        style={{
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(15,23,42,0.10)",
          borderRadius: 14,
          boxShadow: `
            inset 0 1px 0 rgba(255,255,255,0.85),
            0 1px 2px rgba(15,23,42,0.06),
            0 18px 40px -16px rgba(15,23,42,0.20)
          `,
          padding: 6,
          overflow: "hidden",
        }}
      >
        {/* Header — small label naming the room being extended */}
        <div
          style={{
            padding: "8px 10px 6px",
            borderBottom: "1px solid rgba(15,23,42,0.06)",
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: meta.accent,
            }}
          >
            Extend · {meta.glyph}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              fontWeight: 600,
              color: "#0b0d12",
              letterSpacing: "-0.01em",
            }}
          >
            {meta.title}
          </div>
        </div>

        {/* Verb rows */}
        {VERBS.map(({ key, label, hint, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleVerbClick(key);
            }}
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "transparent",
              border: "none",
              textAlign: "left",
              cursor: "pointer",
              transition: "background 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `color-mix(in srgb, ${meta.accent} 6%, transparent)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                width: 28,
                height: 28,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in srgb, ${meta.accent} 10%, transparent)`,
                color: meta.accent,
              }}
            >
              <Icon style={{ width: 14, height: 14 }} strokeWidth={2.2} />
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#0b0d12",
                  letterSpacing: "-0.01em",
                }}
              >
                {label}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "rgba(11,13,18,0.52)",
                  marginTop: 1,
                }}
              >
                {hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
