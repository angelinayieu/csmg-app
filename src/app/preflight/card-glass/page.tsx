// Glassmorphism / Apple Vision Pro variations of the template card.
// Top: the REFINED pass (V1 frosted shell + V3 floating glyph-tile, with the
// glass pushed into the chips + Generates panel) across 3 accents. Below:
// the V1–V4 reference shells. Glass only reads against a colorful backdrop,
// so each sits on its own "environment".
//
// SAFE TO DELETE — exploration only. Route: /preflight/card-glass

"use client";

import { CardGlyph } from "@/components/landing/card-glyph";
import { CardDecomposition } from "@/components/landing/card-decomposition";
import { TEMPLATE_META } from "@/components/landing/template-meta";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";

const INK = "#0B0B0C";

const SHOWCASE = [
  { id: "research_project", name: "Research Project", tagline: "Map your hypothesis, evidence, and next experiments", accent: "#5856d6" },
  { id: "journal_self_discovery", name: "Self-Discovery Journal", tagline: "Daily journaling that asks better questions over time", accent: "#d97706" },
  { id: "career_pivot", name: "Career Pivot", tagline: "Decompose the jump from where you are to where you want to be", accent: "#16a34a" },
];
const REF = SHOWCASE[0];

const PASTEL =
  "radial-gradient(circle at 14% 20%, #ffe1c4, transparent 42%), radial-gradient(circle at 86% 14%, #dcc9fb, transparent 42%), radial-gradient(circle at 50% 96%, #c6f0e6, transparent 45%), #e9edf4";

function Seal({ color = INK }: { color?: string }) {
  return (
    <svg width={13} height={13} viewBox="0 0 12 12" aria-hidden style={{ display: "block" }}>
      <circle cx={6} cy={6} r={6} fill={color} />
      <path d="M3.5 6.2 L5.1 7.8 L8.5 4.2" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stage({ bg, label, desc, children }: { bg: string; label: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-[13px] font-semibold text-[#0B0B0C]">{label}</div>
        <div className="text-[12px] text-slate-500">{desc}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-8 rounded-3xl p-9" style={{ background: bg }}>
        {children}
      </div>
    </div>
  );
}

/* ── Glassier chips + Generates (the push into the inner panels) ── */
function GlassDecomposition({ templateId, accent }: { templateId: string; accent: string }) {
  const meta = TEMPLATE_META[templateId];
  if (!meta) return null;
  return (
    <div className="mt-3">
      <div className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#0B0B0C]">Feed in</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {meta.inputs.map((it) => {
          const Icon = it.icon;
          return (
            <span
              key={it.label}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[11px] font-medium leading-none text-[#0B0B0C] backdrop-blur-xl"
              style={{
                background: `linear-gradient(to bottom, ${accent}22, rgba(255,255,255,0.5))`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), 0 5px 14px -5px rgba(11,18,40,0.28)",
                outline: "1px solid rgba(255,255,255,0.8)",
                outlineOffset: -1,
              }}
            >
              <Icon className="h-3 w-3 shrink-0" style={{ color: accent }} strokeWidth={2.2} />
              {it.label}
            </span>
          );
        })}
      </div>
      <div className="mt-3.5 text-[12.5px] font-semibold tracking-[-0.01em] text-[#0B0B0C]">Generates</div>
      <div
        className="mt-2 space-y-0.5 rounded-2xl p-1.5 backdrop-blur-xl"
        style={{
          background: "rgba(255,255,255,0.4)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 6px 16px -10px rgba(11,18,40,0.25)",
          outline: "1px solid rgba(255,255,255,0.65)",
          outlineOffset: -1,
        }}
      >
        {meta.outputs.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="flex items-center gap-2 rounded-xl px-2 py-[7px] text-[12px] font-medium leading-none text-[#1A1F2B]">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md backdrop-blur-md"
                style={{ background: `${accent}29`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 7px -2px ${accent}66` }}
              >
                <Icon className="h-3 w-3" style={{ color: accent }} strokeWidth={2.2} />
              </span>
              {it.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── The refined combined card ── */
function RefinedCard({ id, name, tagline, accent }: { id: string; name: string; tagline: string; accent: string }) {
  return (
    <button className="group w-[290px] text-left">
      <div
        className="relative overflow-hidden rounded-[28px] ring-1 ring-white/70 backdrop-blur-2xl transition-transform duration-300 group-hover:-translate-y-1.5"
        style={{
          background: "rgba(255,255,255,0.55)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.95), 0 12px 26px -16px rgba(11,18,40,0.3), 0 38px 82px -28px rgba(11,18,40,0.5)",
        }}
      >
        {/* specular diagonal sweep */}
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(125deg, rgba(255,255,255,0.42) 0%, transparent 32%, transparent 70%, rgba(255,255,255,0.16) 100%)" }} />

        {/* banner with a floating glass glyph-tile (V3) */}
        <div className="relative h-[82px] w-full" style={{ background: `linear-gradient(150deg, ${accent}24, rgba(255,255,255,0.03))` }}>
          <div
            className="absolute left-4 top-3 flex h-12 w-[70px] items-center justify-center rounded-2xl ring-1 ring-white/80 backdrop-blur-md"
            style={{ background: "rgba(255,255,255,0.55)", boxShadow: `0 10px 22px -8px ${accent}80, inset 0 1px 0 rgba(255,255,255,0.95)` }}
          >
            <div className="h-8 w-12">
              <CardGlyph templateId={id} accent={accent} animated />
            </div>
          </div>
        </div>

        <div className="relative px-4 pb-4 pt-3">
          <div className="text-[15px] font-semibold leading-tight text-[#0B0B0C]">{name}</div>
          <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-slate-500">{tagline}</div>
          <GlassDecomposition templateId={id} accent={accent} />
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "rgba(255,255,255,0.55)" }}>
            <div className="flex min-w-0 items-center gap-1.5">
              <InterAxisLogo className="h-[18px] w-[18px] shrink-0" size={36} style={{ borderRadius: 5 }} />
              <span className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em] text-[#334155]">Intersice Team</span>
              <Seal />
            </div>
            <span className="whitespace-nowrap text-[10px] font-semibold" style={{ color: accent }}>Use template →</span>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ── Reference shells (V1–V4): real CardDecomposition, plain chrome ── */
function RefBody() {
  return (
    <div className="px-4 pb-4 pt-3">
      <div className="text-[14.5px] font-semibold leading-tight text-[#0B0B0C]">{REF.name}</div>
      <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-slate-500">{REF.tagline}</div>
      <CardDecomposition templateId={REF.id} accent={REF.accent} forceOpen />
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
        <div className="flex min-w-0 items-center gap-1.5">
          <InterAxisLogo className="h-[18px] w-[18px] shrink-0" size={36} style={{ borderRadius: 5 }} />
          <span className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em] text-[#334155]">Intersice Team</span>
          <Seal />
        </div>
        <span className="whitespace-nowrap text-[10px] font-semibold" style={{ color: REF.accent }}>Use template →</span>
      </div>
    </div>
  );
}
function RefGlyph() {
  return (
    <div className="absolute left-3.5 top-3 h-9 w-14">
      <CardGlyph templateId={REF.id} accent={REF.accent} animated />
    </div>
  );
}
const A = REF.accent;

export default function CardGlassPreflight() {
  return (
    <div
      className="min-h-screen px-8 py-10"
      style={{ background: "#EEF1F6", fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif' }}
    >
      <header className="mb-8">
        <h1 className="text-[26px] font-bold tracking-tight text-[#0B0B0C]">Card — glass (refined)</h1>
        <p className="mt-1 text-[14px] text-slate-500">
          ★ Refined = V1 frosted shell + V3 floating glyph-tile + glass pushed into the chips &amp; Generates. V1–V4 reference below.
        </p>
      </header>

      {/* ── ★ Refined showcase, 3 accents ── */}
      <div className="mb-12">
        <Stage label="★ Refined · adapts per accent" desc="Frosted shell + specular sweep, floating glyph-tile, vibrancy-tinted chips, frosted Generates panel with accent-glass icon squares." bg={PASTEL}>
          {SHOWCASE.map((c) => (
            <RefinedCard key={c.id} {...c} />
          ))}
        </Stage>
      </div>

      <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Reference shells</div>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Stage label="V1 · Frosted light" desc="Translucent white, heavy blur, bright rim." bg="radial-gradient(circle at 18% 18%, #ffe1c4, transparent 45%), radial-gradient(circle at 82% 12%, #dcc9fb, transparent 45%), radial-gradient(circle at 65% 88%, #c6f0e6, transparent 45%), #e9edf4">
          <button className="group w-[280px] text-left">
            <div className="overflow-hidden rounded-[26px] ring-1 ring-white/70 backdrop-blur-2xl" style={{ background: "rgba(255,255,255,0.55)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 30px 70px -24px rgba(11,18,40,0.45)" }}>
              <div className="relative h-[76px] w-full" style={{ background: `linear-gradient(150deg, ${A}24, rgba(255,255,255,0.04))` }}><RefGlyph /></div>
              <RefBody />
            </div>
          </button>
        </Stage>

        <Stage label="V2 · Accent vibrancy" desc="Glass tinted by the accent + accent glow." bg={`radial-gradient(circle at 25% 22%, ${A}66, transparent 45%), radial-gradient(circle at 80% 78%, ${A}3a, transparent 50%), #e9edf4`}>
          <button className="group w-[280px] text-left">
            <div className="overflow-hidden rounded-[26px] backdrop-blur-2xl" style={{ background: `linear-gradient(160deg, ${A}26, rgba(255,255,255,0.46))`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.75), 0 28px 64px -22px ${A}77`, outline: `1px solid ${A}40`, outlineOffset: -1 }}>
              <div className="relative h-[76px] w-full" style={{ background: `linear-gradient(150deg, ${A}3a, ${A}0d)` }}><RefGlyph /></div>
              <RefBody />
            </div>
          </button>
        </Stage>

        <Stage label="V3 · Layered depth" desc="Raised glass glyph-tile, specular sweep, stacked shadows." bg="radial-gradient(circle at 22% 20%, #d7e6ff, transparent 50%), radial-gradient(circle at 80% 80%, #ffe3ef, transparent 50%), #e9edf4">
          <button className="group w-[280px] text-left">
            <div className="relative overflow-hidden rounded-[26px] ring-1 ring-white/60 backdrop-blur-2xl" style={{ background: "rgba(255,255,255,0.48)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 24px -16px rgba(11,18,40,0.3), 0 36px 70px -26px rgba(11,18,40,0.5)" }}>
              <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(120deg, rgba(255,255,255,0.35) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.15) 100%)" }} />
              <div className="relative h-[80px] w-full" style={{ background: `linear-gradient(150deg, ${A}1f, rgba(255,255,255,0.02))` }}>
                <div className="absolute left-3.5 top-2.5 flex h-12 w-[68px] items-center justify-center rounded-2xl ring-1 ring-white/70 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.5)", boxShadow: `0 8px 20px -8px ${A}66, inset 0 1px 0 rgba(255,255,255,0.9)` }}>
                  <div className="h-8 w-12"><CardGlyph templateId={REF.id} accent={REF.accent} animated /></div>
                </div>
              </div>
              <RefBody />
            </div>
          </button>
        </Stage>

        <Stage label="V4 · Dark environment" desc="Light glass card in a dark visionOS space." bg={`radial-gradient(circle at 28% 18%, #3a3270, transparent 52%), radial-gradient(circle at 78% 76%, ${A}55, transparent 52%), radial-gradient(circle at 60% 100%, #14506a, transparent 55%), #0b1020`}>
          <button className="group w-[280px] text-left">
            <div className="overflow-hidden rounded-[26px] ring-1 ring-white/70 backdrop-blur-2xl" style={{ background: "rgba(255,255,255,0.62)", boxShadow: "inset 0 1px 0 rgba(255,255,255,1), 0 0 0 1px rgba(255,255,255,0.25), 0 40px 80px -28px rgba(0,0,0,0.7)" }}>
              <div className="relative h-[76px] w-full" style={{ background: `linear-gradient(150deg, ${A}2e, rgba(255,255,255,0.06))` }}><RefGlyph /></div>
              <RefBody />
            </div>
          </button>
        </Stage>
      </div>
    </div>
  );
}
