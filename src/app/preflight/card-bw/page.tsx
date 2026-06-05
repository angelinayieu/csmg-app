// Black & white pass on the ORIGINAL card structure (banner glyph + Feed-in
// chips + Generates list + verified footer). The structure already takes an
// `accent` everywhere, so monochrome = feeding it ink/grey instead of the
// per-template color. Two tones × three templates to pick the B&W weight.
//
// SAFE TO DELETE — exploration. Route: /preflight/card-bw

"use client";

import { CardGlyph } from "@/components/landing/card-glyph";
import { CardDecomposition } from "@/components/landing/card-decomposition";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";

const TEMPLATES = [
  { id: "research_project", name: "Research Project", tagline: "Map your hypothesis, evidence, and next experiments" },
  { id: "journal_self_discovery", name: "Self-Discovery Journal", tagline: "Daily journaling that asks better questions over time" },
  { id: "team_retro", name: "Retrospective", tagline: "Decompose what happened and what to do differently" },
];

const TONES = [
  { key: "Ink", value: "#0B0B0C" },
  { key: "Slate", value: "#475569" },
];

function Seal() {
  return (
    <svg width={13} height={13} viewBox="0 0 12 12" aria-hidden style={{ display: "block" }}>
      <circle cx={6} cy={6} r={6} fill="#0B0B0C" />
      <path d="M3.5 6.2 L5.1 7.8 L8.5 4.2" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The real card chrome, but `accent` = a monochrome tone → fully B&W. */
function BWCard({ id, name, tagline, ink }: { id: string; name: string; tagline: string; ink: string }) {
  return (
    <div className="w-[268px] overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(11,18,40,0.04),0_16px_36px_-18px_rgba(11,18,40,0.2)] ring-1 ring-black/[0.06]">
      {/* banner — grey wash instead of accent wash */}
      <div className="relative h-[76px] w-full" style={{ background: `linear-gradient(155deg, ${ink}14 0%, ${ink}06 55%, #ffffff 100%)` }}>
        <div aria-hidden className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(120% 80% at 80% 0%, rgba(255,255,255,0.7), rgba(255,255,255,0) 60%)" }} />
        <div className="absolute left-3.5 top-3 h-9 w-14">
          <CardGlyph templateId={id} accent={ink} animated />
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="text-[14.5px] font-semibold leading-tight text-[#0B0B0C]">{name}</div>
        <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-slate-500">{tagline}</div>
        {/* real chips + generates, fed the monochrome tone */}
        <CardDecomposition templateId={id} accent={ink} forceOpen />
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <div className="flex min-w-0 items-center gap-1.5">
            <InterAxisLogo className="h-[18px] w-[18px] shrink-0" size={36} style={{ borderRadius: 5 }} />
            <span className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em] text-[#334155]">akiboe team</span>
            <Seal />
          </div>
          <span className="whitespace-nowrap text-[10px] font-semibold text-[#0B0B0C]">Use template →</span>
        </div>
      </div>
    </div>
  );
}

export default function CardBWPreflight() {
  return (
    <div className="min-h-screen px-8 py-10" style={{ background: "#F7F8FA", fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif' }}>
      <header className="mb-8">
        <h1 className="text-[26px] font-bold tracking-tight text-[#0B0B0C]">Card — black &amp; white</h1>
        <p className="mt-1 text-[14px] text-slate-500">
          The original structure, monochrome. Same card; the per-template color is replaced by one ink tone (icons, glyph, chips, Generates all follow it).
        </p>
      </header>

      {TONES.map((tone) => (
        <section key={tone.key} className="mb-10">
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {tone.key} · {tone.value}
          </div>
          <div className="flex flex-wrap gap-6">
            {TEMPLATES.map((t) => (
              <BWCard key={t.id} {...t} ink={tone.value} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
