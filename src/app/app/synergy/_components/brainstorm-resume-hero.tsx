// ── BrainstormResumeHero ──
//
// Wide hero tile for the most-recently-updated session. Thumbnail on
// the left (≈55% of width on desktop), CTA stack on the right. Reads
// as "pick up where you left off" — the single most-likely next click
// for a returning user.

import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { BrainstormThumbnail } from "./brainstorm-thumbnail";
import type { BrainstormCardData } from "./brainstorm-card";
import { relativeTime } from "./relative-time";

interface BrainstormResumeHeroProps {
  session: BrainstormCardData;
}

export function BrainstormResumeHero({ session }: BrainstormResumeHeroProps) {
  const nodeCount = session.nodes.length;
  return (
    <Link
      href={`/app/synergy/${session.id}`}
      className="group relative grid grid-cols-1 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_4px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_4px_8px_rgba(15,23,42,0.06),0_24px_48px_-20px_rgba(15,23,42,0.22)] md:grid-cols-[1.35fr_1fr]"
    >
      {/* Thumbnail well */}
      <div className="relative h-[260px] w-full overflow-hidden bg-[#fafbfc] md:h-auto md:min-h-[280px]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)",
            backgroundSize: "22px 22px",
            maskImage:
              "radial-gradient(ellipse 85% 75% at 50% 50%, black 50%, transparent 96%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 85% 75% at 50% 50%, black 50%, transparent 96%)",
          }}
        />
        <BrainstormThumbnail
          nodes={session.nodes}
          className="absolute inset-0 h-full w-full p-6"
        />
      </div>

      {/* CTA stack */}
      <div className="flex flex-col justify-between gap-6 p-6 md:p-7">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider text-slate-500">
            <Clock3 className="h-3 w-3" />
            Resume where you left off
          </div>
          <h2 className="font-display-tight mt-3 text-2xl font-semibold leading-tight text-slate-900">
            {session.title}
          </h2>
          {session.objective_statement && (
            <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-slate-600">
              {session.objective_statement}
            </p>
          )}
        </div>

        <div className="flex items-end justify-between">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-slate-500">
            <div>
              {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
            </div>
            <div className="mt-1 text-slate-400">{relativeTime(session.updated_at)}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-2 text-[12.5px] font-semibold text-white transition group-hover:bg-slate-800">
            Open board
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
