"use client";

// ── Research Sources Sheet ────────────────────────────────────────
//
// Slide-in panel from the right edge listing all sources Tavily
// returned for this space (surface + deep, dedup'd by URL). Lets
// the user audit the AI's grounding — see what the model read,
// click through to the originals, judge whether the bundle is
// any good for their domain.
//
// Opened by the ResearchIndicator click in the canvas chrome.
// Closed by Escape, X button, or click outside.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface FetchedSource {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  lens?: string;
}

interface FetchedBundle {
  status: string;
  source_count: number;
  // Full payload — fetched on open from a new API endpoint that
  // returns the source array (lightweight status route returns
  // counts only).
  sources?: FetchedSource[];
  query?: string;
}

interface Props {
  spaceId: string;
  open: boolean;
  onClose: () => void;
}

interface FullPayload {
  surface: FetchedBundle;
  deep: FetchedBundle & {
    by_lens?: Record<string, FetchedSource[]>;
  };
}

const LENS_LABELS: Record<string, { label: string; color: string }> = {
  frameworks: { label: "Frameworks", color: "#7C3AED" },
  precedents: { label: "Precedents", color: "#16A34A" },
  mechanisms: { label: "Mechanisms", color: "#2563EB" },
  failure_modes: { label: "Failure modes", color: "#DC2626" },
  metrics: { label: "Metrics", color: "#D97706" },
};

export function ResearchSourcesSheet({ spaceId, open, onClose }: Props) {
  const [payload, setPayload] = useState<FullPayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch the full bundle when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/brainstorm/research/full?spaceId=${encodeURIComponent(spaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setPayload(j as FullPayload);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll when sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const surface = payload?.surface ?? null;
  const deep = payload?.deep ?? null;

  // Group deep sources by lens; surface goes in its own group.
  const groups: Array<{ key: string; label: string; color: string; sources: FetchedSource[] }> = [];
  if (deep?.by_lens) {
    for (const [lens, list] of Object.entries(deep.by_lens)) {
      if (!list || list.length === 0) continue;
      const meta = LENS_LABELS[lens] ?? {
        label: lens,
        color: appleVibe.text.secondary,
      };
      groups.push({
        key: lens,
        label: meta.label,
        color: meta.color,
        sources: list,
      });
    }
  }
  if (surface?.sources && surface.sources.length > 0) {
    groups.push({
      key: "surface",
      label: "Domain overview",
      color: appleVibe.text.secondary,
      sources: surface.sources,
    });
  }

  const totalSources = groups.reduce((n, g) => n + g.sources.length, 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="bd"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.aside
            key="sh"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{
              type: "spring",
              stiffness: 280,
              damping: 32,
              mass: 0.6,
            }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col"
            style={{
              background: appleVibe.surface.card,
              borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
              fontFamily: appleVibe.font.stack,
              boxShadow: "0 0 60px -10px rgba(11,18,40,0.35)",
            }}
            role="dialog"
            aria-label="Research sources"
          >
            {/* Header */}
            <header
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              <div>
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Research
                </div>
                <h2
                  className="mt-0.5 text-[16px] font-semibold tracking-tight"
                  style={{ color: appleVibe.text.primary }}
                >
                  {loading
                    ? "Loading sources…"
                    : totalSources > 0
                      ? `${totalSources} source${totalSources === 1 ? "" : "s"}`
                      : "No sources yet"}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close sources panel"
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.secondary,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    appleVibe.surface.chipHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = appleVibe.surface.chip;
                }}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && <SkeletonRows />}
              {!loading && groups.length === 0 && (
                <EmptyState
                  surfaceStatus={surface?.status}
                  deepStatus={deep?.status}
                />
              )}
              {!loading && groups.length > 0 && (
                <ul className="flex flex-col gap-5">
                  {groups.map((g) => (
                    <li key={g.key}>
                      <div
                        className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                        style={{ color: g.color }}
                      >
                        <span
                          className="block h-1.5 w-1.5 rounded-full"
                          style={{ background: g.color }}
                          aria-hidden
                        />
                        {g.label}
                        <span
                          className="ml-auto font-normal lowercase tracking-normal"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {g.sources.length} source
                          {g.sources.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <ul className="mt-2 flex flex-col gap-2">
                        {g.sources.map((s, i) => (
                          <SourceRow key={`${g.key}-${i}`} source={s} />
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            {!loading && groups.length > 0 && (
              <footer
                className="px-5 py-3 text-[10.5px] font-light"
                style={{
                  borderTop: `1px solid ${appleVibe.stroke.hairline}`,
                  color: appleVibe.text.tertiary,
                }}
              >
                Sources discovered automatically while you typed your
                objective and answered clarifying questions. Used as
                context for every AI-generated proposal.
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Building blocks ────────────────────────────────────────────────

function SourceRow({ source }: { source: FetchedSource }) {
  let domain = "";
  try {
    domain = new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    domain = "";
  }
  return (
    <li>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-2xl px-3 py-2.5 transition-all"
        style={{
          background: appleVibe.surface.base,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.md,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = appleVibe.stroke.medium;
          e.currentTarget.style.background = "rgba(255,255,255,0.92)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = appleVibe.stroke.hairline;
          e.currentTarget.style.background = appleVibe.surface.base;
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="line-clamp-2 text-[12.5px] font-semibold leading-snug"
              style={{ color: appleVibe.text.primary }}
            >
              {source.title || source.url}
            </div>
            {domain && (
              <div
                className="mt-0.5 text-[10.5px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
              >
                {domain}
              </div>
            )}
            {source.snippet && (
              <p
                className="mt-1.5 line-clamp-3 text-[11.5px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {source.snippet}
              </p>
            )}
          </div>
          <ExternalLink
            className="h-3 w-3 flex-shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
            strokeWidth={2}
            style={{ color: appleVibe.text.secondary }}
          />
        </div>
      </a>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div
            className="h-2.5 w-24 rounded-full"
            style={{ background: appleVibe.stroke.hairline }}
          />
          <div className="mt-2 flex flex-col gap-2">
            {[0, 1].map((j) => (
              <div
                key={j}
                className="h-16 rounded-2xl"
                style={{ background: appleVibe.surface.chip }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  surfaceStatus,
  deepStatus,
}: {
  surfaceStatus?: string;
  deepStatus?: string;
}) {
  const pending = surfaceStatus === "pending" || deepStatus === "pending";
  const skipped = surfaceStatus === "skipped";
  return (
    <div
      className="rounded-2xl border border-dashed px-4 py-8 text-center"
      style={{
        borderColor: appleVibe.stroke.hairline,
        color: appleVibe.text.tertiary,
        borderRadius: appleVibe.radius.lg,
      }}
    >
      <p className="text-[12.5px] font-light leading-snug">
        {pending
          ? "Research still running in the background. Check back in a few seconds."
          : skipped
            ? "Your objective is broad enough that we skipped the public-web research pass. Add more domain detail in clarifying questions for grounded results."
            : "No sources found for this domain. The AI is operating on first-principles only."}
      </p>
    </div>
  );
}
