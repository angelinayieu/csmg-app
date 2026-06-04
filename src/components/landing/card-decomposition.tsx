"use client";

// ── Card decomposition (hover reveal) ──
//
// The glassmorphic panel that unfurls inside a template card on hover (and
// is open-by-default on the centered/featured card). It answers two
// questions, leading with the first:
//   • "Feed in"  — what content you can drop in (the content-prep focus),
//                  shown as frosted-glass chips that float in on a stagger.
//   • "Generates" — the artifacts the template produces, a compact list.
//
// Pure-CSS reveal (grid-rows 0fr→1fr) driven by the parent card's `group`
// hover, so there's no JS/RAF and it's SSR-safe. `forceOpen` keeps the
// featured card expanded (which also reserves the rail's row height, so
// hovering siblings never reflows the layout).

import { TEMPLATE_META } from "./template-meta";

export function CardDecomposition({
  templateId,
  accent,
  forceOpen = false,
}: {
  templateId: string;
  accent: string;
  /** Featured card: expanded by default (no hover needed). */
  forceOpen?: boolean;
}) {
  const meta = TEMPLATE_META[templateId];
  if (!meta) return null;

  const reveal = forceOpen
    ? "grid-rows-[1fr]"
    : "grid-rows-[0fr] group-hover:grid-rows-[1fr]";
  const item = forceOpen
    ? "opacity-100 translate-y-0"
    : "opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0";

  return (
    <div
      className={`mt-3 grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${reveal}`}
    >
      <div className="min-h-0 overflow-hidden">
        {/* Feed in — the lead. Frosted glass chips that float in. */}
        <div className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#0B0B0C]">
          Feed in
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meta.inputs.map((it, i) => {
            const Icon = it.icon;
            return (
              <span
                key={it.label}
                className={`inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-white/90 to-white/55 px-2.5 py-[5px] text-[11px] font-medium leading-none text-[#0B0B0C] ring-1 ring-black/[0.06] shadow-[0_3px_12px_-4px_rgba(11,18,40,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-[1.5px] hover:shadow-[0_8px_18px_-6px_rgba(11,18,40,0.3)] ${item}`}
                style={{ transitionDelay: forceOpen ? undefined : `${70 + i * 45}ms` }}
              >
                <Icon className="h-3 w-3 shrink-0" style={{ color: accent }} strokeWidth={2.2} />
                {it.label}
              </span>
            );
          })}
        </div>

        {/* Generates — secondary. Clean rows on a faint frosted inset. */}
        <div className="mt-3.5 text-[12.5px] font-semibold tracking-[-0.01em] text-[#0B0B0C]">
          Generates
        </div>
        <div className="mt-2 space-y-0.5 rounded-xl bg-white/45 p-1.5 ring-1 ring-black/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-sm">
          {meta.outputs.map((it, i) => {
            const Icon = it.icon;
            return (
              <div
                key={it.label}
                className={`flex items-center gap-2 rounded-lg px-2 py-[7px] text-[12px] font-medium leading-none text-[#1A1F2B] transition-all duration-300 ease-out ${item}`}
                style={{ transitionDelay: forceOpen ? undefined : `${150 + i * 45}ms` }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                  style={{ background: `${accent}14` }}
                >
                  <Icon className="h-3 w-3" style={{ color: accent }} strokeWidth={2.2} />
                </span>
                {it.label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
