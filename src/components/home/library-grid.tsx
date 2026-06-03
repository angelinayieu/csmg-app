"use client";

// ── Library grid ──
//
// The "library" section of the minimal home — the user's real spaces as
// clean white cards. Each card reads in three zones:
//   1. grey label  → the category / type of the workspace (from space_kind)
//   2. bold title  → the AI-summarized NAME of the work (card_brief.name)
//   3. bullets     → the AI-summarized most-important points / final
//                    statements (card_brief.points)
//
// The brief is generated + cached server-side (spaces.card_brief). Cards
// that arrive without a fresh brief (new or stale) are filled progressively
// by POSTing /api/spaces/[id]/card-brief — SSR stays fast and cards
// "sharpen" a moment after load. Until a brief lands we fall back to the
// raw name + a naive description split so a card is never empty.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { SpaceCardBrief } from "@/lib/objective-canvas/summarize-space-card";

export interface LibrarySpace {
  id: string;
  name: string | null;
  description: string | null;
  space_kind: string | null;
  /** Cached AI brief — null when missing or stale (server-decided). */
  card_brief?: SpaceCardBrief | null;
}

const KIND_LABEL: Record<string, string> = {
  objective_canvas: "Objective",
  brainstorm_speed: "Brainstorm",
  reasoning: "Whiteboard",
  precise_rd: "Research",
  digital_twin: "Twin",
};

function kindLabel(kind: string | null): string {
  return KIND_LABEL[kind ?? ""] ?? "Canvas";
}

// Naive fallback bullets from the raw description, used only until the AI
// brief lands (or if it never does).
function bulletsFrom(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\n|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3)
    .map((s) => (s.length > 90 ? s.slice(0, 89) + "…" : s));
}

// Progressively fetch briefs for cards that arrived without a fresh one.
// Small concurrency so we don't fire a dozen LLM calls at once; cached
// (fresh) briefs return instantly from the route without an LLM hop.
const FILL_CONCURRENCY = 3;

function useProgressiveBriefs(
  spaces: LibrarySpace[],
): Record<string, SpaceCardBrief> {
  const [briefs, setBriefs] = useState<Record<string, SpaceCardBrief>>(() => {
    const seed: Record<string, SpaceCardBrief> = {};
    for (const s of spaces) if (s.card_brief) seed[s.id] = s.card_brief;
    return seed;
  });
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const todo = spaces.filter((s) => !s.card_brief).map((s) => s.id);
    if (todo.length === 0) return;

    let cancelled = false;
    let idx = 0;
    async function worker() {
      while (!cancelled && idx < todo.length) {
        const id = todo[idx++];
        try {
          const res = await fetch(`/api/spaces/${id}/card-brief`, {
            method: "POST",
          });
          if (!res.ok) continue;
          const json = (await res.json()) as { brief: SpaceCardBrief | null };
          if (json.brief && !cancelled) {
            setBriefs((prev) => ({ ...prev, [id]: json.brief! }));
          }
        } catch {
          /* transient — skip this card */
        }
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(FILL_CONCURRENCY, todo.length) }, worker),
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return briefs;
}

export function LibraryGrid({ spaces }: { spaces: LibrarySpace[] }) {
  const router = useRouter();
  const briefs = useProgressiveBriefs(spaces);

  if (spaces.length === 0) {
    return (
      <p
        className="text-[13px] font-light"
        style={{ color: appleVibe.text.tertiary }}
      >
        Your canvases will appear here. Start one above.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {spaces.map((space) => {
        const brief = briefs[space.id] ?? null;
        const href =
          space.space_kind === "objective_canvas"
            ? `/app/objective/${space.id}`
            : `/app/space/${space.id}/whiteboard`;
        const title =
          brief?.name?.trim() || space.name?.trim() || "Untitled";
        const points =
          brief?.points && brief.points.length > 0
            ? brief.points
            : bulletsFrom(space.description);
        return (
          <motion.button
            key={space.id}
            type="button"
            onClick={() => router.push(href)}
            whileHover={{ y: -3, boxShadow: appleVibe.shadow.cardHover }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="group flex flex-col items-start rounded-3xl p-5 text-left"
            style={{
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.soft}`,
              boxShadow: appleVibe.shadow.card,
              minHeight: 168,
            }}
          >
            {/* zone 1 — category / type */}
            <span
              className="text-[11px] font-medium"
              style={{ color: appleVibe.text.faint }}
            >
              {kindLabel(space.space_kind)}
            </span>
            {/* zone 2 — AI-summarized name */}
            <span
              className="mt-0.5 text-[16px] font-semibold leading-tight"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
              }}
            >
              {title}
            </span>
            {/* zone 3 — AI-summarized key points */}
            {points.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {points.map((b, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-[12.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    <span style={{ color: appleVibe.text.faint }}>·</span>
                    <span className="line-clamp-2">{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span
                className="mt-3 text-[12.5px] font-light"
                style={{ color: appleVibe.text.tertiary }}
              >
                Open canvas →
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
