// Prototype for the Self-Discovery Journal card's 3D book animation —
// candidate replacement for the flat CardGlyph on that card's banner.
// Shows the book large (to judge the animation) and at real card-banner
// size inside a mock card, so we can see it in context before wiring it in.
//
// SAFE TO DELETE — prototype only. Route: /preflight/journal-book

"use client";

import { JournalBook3D } from "@/components/landing/journal-book-3d";

const JOURNAL_ACCENT = "#d97706";

export default function JournalBookPreflight() {
  return (
    <div
      className="min-h-screen px-8 py-10"
      style={{
        background: "#F7F8FA",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
      }}
    >
      <header className="mb-8">
        <h1 className="text-[26px] font-bold tracking-tight text-[#0B0B0C]">
          Journal card — 3D book
        </h1>
        <p className="mt-1 text-[14px] text-slate-500">
          CSS-3D book (floats, cover opens, a leaf turns). Candidate to replace
          the flat glyph on the Self-Discovery Journal card banner.
        </p>
      </header>

      {/* ── Large, to judge the animation ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          Large
        </h2>
        <div className="flex h-[320px] w-[420px] items-center justify-center rounded-2xl bg-white ring-1 ring-black/[0.05] shadow-[0_12px_32px_-20px_rgba(11,18,40,0.3)]">
          <JournalBook3D height={230} accent={JOURNAL_ACCENT} />
        </div>
      </section>

      {/* ── In a mock card banner (real size) ── */}
      <section>
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          In context — card banner (104px) vs the current glyph slot
        </h2>
        <div className="w-[240px] overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.05] shadow-[0_18px_40px_-18px_rgba(11,18,40,0.28)]">
          {/* banner — the wash slot the glyph lives in today */}
          <div
            className="relative h-[112px] w-full"
            style={{
              background: `linear-gradient(155deg, ${JOURNAL_ACCENT}26 0%, ${JOURNAL_ACCENT}0d 55%, #ffffff 100%)`,
            }}
          >
            <JournalBook3D height={96} accent={JOURNAL_ACCENT} />
          </div>
          <div className="px-3.5 pb-4 pt-3">
            <div className="text-[14px] font-semibold text-[#0B0B0C]">
              Self-Discovery Journal
            </div>
            <div className="mt-1.5 text-[11.5px] leading-snug text-slate-500">
              Daily journaling that asks better questions over time
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
