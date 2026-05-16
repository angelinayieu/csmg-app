// ── BrainstormCard ──
//
// Tall gallery tile. Whiteboard-paper thumbnail on top, title +
// objective + meta footer below. Server component — pure presentation,
// link wraps the whole tile.

import Link from "next/link";
import { BrainstormThumbnail, type ThumbnailNode } from "./brainstorm-thumbnail";
import { relativeTime } from "./relative-time";

export interface BrainstormCardData {
  id: string;
  title: string;
  state: string;
  objective_statement: string | null;
  updated_at: string;
  nodes: ThumbnailNode[];
}

interface BrainstormCardProps {
  session: BrainstormCardData;
}

export function BrainstormCard({ session }: BrainstormCardProps) {
  const nodeCount = session.nodes.length;
  return (
    <Link
      href={`/app/synergy/${session.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_30px_-16px_rgba(15,23,42,0.18)]"
    >
      {/* Thumbnail well — whiteboard paper with a dotted grid behind the SVG */}
      <div className="relative h-[164px] w-full overflow-hidden bg-[#fafbfc]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)",
            backgroundSize: "18px 18px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 50%, black 50%, transparent 95%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 70% at 50% 50%, black 50%, transparent 95%)",
          }}
        />
        <BrainstormThumbnail
          nodes={session.nodes}
          className="absolute inset-0 h-full w-full p-3"
        />
        {session.state === "drafting" && nodeCount > 0 && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.06)] backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Drafting
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3.5">
        <div className="font-display-tight text-[15px] font-semibold leading-snug text-slate-900">
          {session.title}
        </div>
        {session.objective_statement && (
          <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-600">
            {session.objective_statement}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          <span>
            {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
          </span>
          <span className="text-slate-300">·</span>
          <span>{relativeTime(session.updated_at)}</span>
        </div>
      </div>
    </Link>
  );
}
