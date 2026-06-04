// Restructured card — "branch out" decomposition.
// Instead of banner-glyph + flat "Feed in" chips + "Generates" list, the
// card shows the idea BRANCHING: a root node curves out into the
// deliverables (a mini decomposition tree, the product's core metaphor).
// Inputs are a compact feed row. Frosted-glass shell kept.
//
// SAFE TO DELETE — exploration. Route: /preflight/card-branch

"use client";

import { TEMPLATE_META } from "@/components/landing/template-meta";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";

const INK = "#0B0B0C";

const CARDS = [
  { id: "research_project", name: "Research Project", tagline: "Map your hypothesis, evidence, and next experiments", accent: "#5856d6" },
  { id: "journal_self_discovery", name: "Self-Discovery Journal", tagline: "Daily journaling that asks better questions over time", accent: "#d97706" },
  { id: "team_retro", name: "Retrospective", tagline: "Decompose what happened and what to do differently", accent: "#ea580c" },
];

const PASTEL =
  "radial-gradient(circle at 14% 18%, #ffe1c4, transparent 42%), radial-gradient(circle at 86% 14%, #dcc9fb, transparent 42%), radial-gradient(circle at 50% 98%, #c6f0e6, transparent 46%), #e9edf4";

function Seal() {
  return (
    <svg width={13} height={13} viewBox="0 0 12 12" aria-hidden style={{ display: "block" }}>
      <circle cx={6} cy={6} r={6} fill={INK} />
      <path d="M3.5 6.2 L5.1 7.8 L8.5 4.2" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BranchCard({ id, name, tagline, accent }: { id: string; name: string; tagline: string; accent: string }) {
  const meta = TEMPLATE_META[id];
  const outs = meta?.outputs ?? [];
  const ins = (meta?.inputs ?? []).slice(0, 5);

  // Branch diagram geometry (SVG viewBox == px so HTML nodes align).
  const W = 296;
  const rootX = 40;
  const nodeX = 150; // output icon-disc center
  const rowH = 58;
  const H = outs.length * rowH + 8;
  const rootY = H / 2;
  const outY = outs.map((_, i) =>
    outs.length === 1 ? rootY : 26 + (i * (H - 52)) / (outs.length - 1),
  );

  return (
    <button className="group w-[300px] text-left">
      <div
        className="relative overflow-hidden rounded-[28px] ring-1 ring-white/70 backdrop-blur-2xl transition-transform duration-300 group-hover:-translate-y-1.5"
        style={{
          background: "rgba(255,255,255,0.58)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), 0 14px 28px -16px rgba(11,18,40,0.3), 0 40px 84px -28px rgba(11,18,40,0.5)",
        }}
      >
        {/* specular sweep */}
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(125deg, rgba(255,255,255,0.42) 0%, transparent 34%, transparent 70%, rgba(255,255,255,0.15) 100%)" }} />

        <div className="relative px-5 pb-4 pt-4">
          {/* title */}
          <div className="text-[16px] font-semibold leading-tight" style={{ color: INK }}>{name}</div>
          <div className="mt-1 line-clamp-1 text-[11.5px] leading-snug text-slate-500">{tagline}</div>

          {/* feed-in row (compact) */}
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">Feed</span>
            <div className="flex items-center gap-1">
              {ins.map((it) => {
                const Icon = it.icon;
                return (
                  <span
                    key={it.label}
                    title={it.label}
                    className="flex h-6 w-6 items-center justify-center rounded-lg backdrop-blur-md"
                    style={{ background: `${accent}1f`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)" }}
                  >
                    <Icon className="h-3 w-3" style={{ color: accent }} strokeWidth={2.2} />
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── branch-out diagram ── */}
          <div className="relative mt-2" style={{ width: W, height: H }}>
            <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
              <defs>
                <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor={accent} stopOpacity="0.85" />
                  <stop offset="1" stopColor={accent} stopOpacity="0.35" />
                </linearGradient>
              </defs>
              {/* branches from root to each output */}
              {outY.map((y, i) => (
                <path
                  key={i}
                  d={`M ${rootX} ${rootY} C ${rootX + 50} ${rootY}, ${nodeX - 54} ${y}, ${nodeX - 14} ${y}`}
                  fill="none"
                  stroke={`url(#bg-${id})`}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ))}
              {/* root hub */}
              <circle cx={rootX} cy={rootY} r={11} fill={accent} fillOpacity={0.16} />
              <circle cx={rootX} cy={rootY} r={5} fill={accent} />
            </svg>

            {/* output nodes (HTML, crisp text) */}
            {outs.map((it, i) => {
              const Icon = it.icon;
              return (
                <div
                  key={it.label}
                  className="absolute flex items-center gap-2"
                  style={{ left: nodeX - 14, top: outY[i], transform: "translateY(-50%)" }}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl backdrop-blur-md"
                    style={{ background: `${accent}26`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.7), 0 3px 8px -3px ${accent}66` }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: accent }} strokeWidth={2.2} />
                  </span>
                  <span className="text-[12px] font-medium leading-tight" style={{ color: "#1A1F2B" }}>{it.label}</span>
                </div>
              );
            })}
          </div>

          {/* footer */}
          <div className="mt-1 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "rgba(255,255,255,0.55)" }}>
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

export default function CardBranchPreflight() {
  return (
    <div className="min-h-screen px-8 py-10" style={{ background: "#EEF1F6", fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif' }}>
      <header className="mb-8">
        <h1 className="text-[26px] font-bold tracking-tight text-[#0B0B0C]">Card — branch-out restructure</h1>
        <p className="mt-1 text-[14px] text-slate-500">
          The idea branches into its deliverables (a mini decomposition tree) instead of a flat list. Inputs = compact feed. Frosted-glass shell.
        </p>
      </header>

      <div className="flex flex-wrap justify-center gap-9 rounded-3xl p-10" style={{ background: PASTEL }}>
        {CARDS.map((c) => (
          <BranchCard key={c.id} {...c} />
        ))}
      </div>
    </div>
  );
}
