"use client";

// ── Citation Badge ────────────────────────────────────────────────
//
// Small "📚 N" pill that surfaces the resolved research sources
// the LLM cited as informing a generated item. Clicking opens an
// anchored popover with the source titles, lens tags, and click-out
// links to originals.
//
// Designed to be embedded in pain / outcome / feature cards in the
// 4-stage room. The data shape matches what
// /api/brainstorm/room/generate writes into causal_chain.citations:
//
//   [{ title, url, snippet, lens? }, ...]
//
// Each source rendered with a lens-colored dot when lens is set
// (frameworks / precedents / mechanisms / failure_modes / metrics).
// Falls back to a neutral chip for surface-pass sources (no lens).

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface CitationSource {
  title: string;
  url: string;
  snippet?: string;
  lens?: string;
}

interface Props {
  citations: CitationSource[];
  /** Optional click handler for "See all sources" link inside the
   *  popover — typically wired to open the room's universal Sources
   *  Sheet. Hidden when undefined. */
  onSeeAll?: () => void;
}

const LENS_META: Record<string, { label: string; color: string }> = {
  frameworks: { label: "Frameworks", color: "#475569" },
  precedents: { label: "Precedents", color: "#16A34A" },
  mechanisms: { label: "Mechanisms", color: "#2563EB" },
  failure_modes: { label: "Failure modes", color: "#DC2626" },
  metrics: { label: "Metrics", color: "#D97706" },
};

export function CitationBadge({ citations, onSeeAll }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (citations.length === 0) return null;

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={`${citations.length} source${citations.length === 1 ? "" : "s"} cited`}
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold transition-colors"
        style={{
          background: open
            ? "rgba(15,23,42,0.10)"
            : "rgba(15,23,42,0.04)",
          color: appleVibe.text.secondary,
          border: `1px solid ${
            open ? "rgba(15,23,42,0.18)" : appleVibe.stroke.hairline
          }`,
        }}
        title={`Cited ${citations.length} source${citations.length === 1 ? "" : "s"}`}
      >
        <Sparkle className="h-2.5 w-2.5" />
        <span>{citations.length}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full z-40 mt-1.5 w-[280px] overflow-hidden rounded-2xl"
            style={{
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.medium}`,
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.95) inset, 0 18px 40px -16px rgba(11,18,40,0.32)",
              borderRadius: appleVibe.radius.lg,
              fontFamily: appleVibe.font.stack,
            }}
            role="dialog"
            aria-label="Sources cited for this item"
            onClick={(e) => e.stopPropagation()}
          >
            <header
              className="flex items-center justify-between px-3 py-2"
              style={{
                borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                background: "rgba(15,23,42,0.02)",
              }}
            >
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Cited sources
              </div>
              <span
                className="text-[10px] font-semibold"
                style={{ color: appleVibe.text.tertiary }}
              >
                {citations.length}
              </span>
            </header>

            <ul className="max-h-[300px] overflow-y-auto px-2 py-2">
              {citations.map((c, i) => {
                const meta = c.lens ? LENS_META[c.lens] : null;
                let domain = "";
                try {
                  domain = new URL(c.url).hostname.replace(/^www\./, "");
                } catch {
                  domain = "";
                }
                return (
                  <li key={i}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-xl px-2 py-1.5 transition-colors"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "rgba(15,23,42,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {meta && (
                          <span
                            className="mt-1 block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ background: meta.color }}
                            aria-hidden
                            title={meta.label}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div
                            className="line-clamp-2 text-[11.5px] font-semibold leading-snug"
                            style={{ color: appleVibe.text.primary }}
                          >
                            {c.title || c.url}
                          </div>
                          {domain && (
                            <div
                              className="mt-0.5 text-[10px] font-medium"
                              style={{ color: appleVibe.text.tertiary }}
                            >
                              {domain}
                              {meta && (
                                <span
                                  className="ml-1.5"
                                  style={{ color: meta.color }}
                                >
                                  · {meta.label.toLowerCase()}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <ExternalLink
                          className="h-2.5 w-2.5 flex-shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
                          strokeWidth={2}
                          style={{ color: appleVibe.text.secondary }}
                        />
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>

            {onSeeAll && (
              <footer
                className="px-3 py-2"
                style={{
                  borderTop: `1px solid ${appleVibe.stroke.hairline}`,
                  background: "rgba(15,23,42,0.02)",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSeeAll();
                  }}
                  className="text-[10.5px] font-semibold"
                  style={{ color: appleVibe.text.primary }}
                >
                  See all research sources →
                </button>
              </footer>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
