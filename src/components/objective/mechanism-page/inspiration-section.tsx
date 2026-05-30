"use client";

// ── §4 Inspiration ────────────────────────────────────────────────
//
// Two-rail layout: Technical precedents (left, papers / case studies /
// implementations) + Design references (right, UI patterns / interaction
// examples). Side-by-side on wide, stacked on narrow. Each source
// carries a 1-sentence "informs" note tying it back to this mechanism.

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SectionHeader } from "./section-header";

interface ItemSource {
  title: string;
  url: string;
  snippet: string;
  score: number;
  informs: string;
}

interface ResearchBundle {
  technical: ItemSource[];
  design: ItemSource[];
  failed?: boolean;
  fetched_at?: string;
}

interface InspirationEntity {
  id: string;
  detail_research: unknown;
}

interface Props {
  entity: InspirationEntity;
}

function normalize(raw: unknown): ResearchBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.technical) || Array.isArray(obj.design)) {
    return {
      technical: Array.isArray(obj.technical) ? (obj.technical as ItemSource[]) : [],
      design: Array.isArray(obj.design) ? (obj.design as ItemSource[]) : [],
      failed: obj.failed === true,
      fetched_at: typeof obj.fetched_at === "string" ? obj.fetched_at : undefined,
    };
  }
  if (Array.isArray(obj.sources)) {
    return {
      technical: obj.sources as ItemSource[],
      design: [],
      failed: obj.failed === true,
      fetched_at: typeof obj.fetched_at === "string" ? obj.fetched_at : undefined,
    };
  }
  return null;
}

export function InspirationSection({ entity }: Props) {
  const bundle = normalize(entity.detail_research);
  const tech = bundle?.technical ?? [];
  const design = bundle?.design ?? [];

  if (tech.length === 0 && design.length === 0) {
    return (
      <div>
        <SectionHeader
          number="4"
          title="Inspiration"
          subtitle="Precedents and references that ground this mechanism."
        />
        <div
          className="rounded-lg border border-dashed px-4 py-6 text-center"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: "rgba(15,23,42,0.5)" }}
          >
            {bundle?.failed
              ? "Research fetch failed for this mechanism. Try again from the room drawer."
              : "No research yet. The Inspiration rails fill when the mechanism's drawer is opened, or via autopilot's research stage."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        number="4"
        title="Inspiration"
        subtitle={`Technical · ${tech.length} · Design · ${design.length}`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Rail title="Technical precedents" sources={tech} prefix="T" />
        <Rail title="Design references" sources={design} prefix="D" />
      </div>
    </div>
  );
}

function Rail({
  title,
  sources,
  prefix,
}: {
  title: string;
  sources: ItemSource[];
  prefix: "T" | "D";
}) {
  if (sources.length === 0) {
    return (
      <div>
        <h3
          className="mb-2 text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: "rgba(15,23,42,0.5)" }}
        >
          {title}
        </h3>
        <p
          className="text-[12px] font-light italic"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          No sources in this rail.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h3
        className="mb-3 text-[12px] font-semibold uppercase tracking-wider"
        style={{ color: "rgba(15,23,42,0.55)" }}
      >
        {title}
      </h3>
      <ul className="space-y-3">
        {sources.map((s, i) => (
          <li
            key={i}
            className="rounded-lg border p-3"
            style={{
              borderColor: "rgba(15,23,42,0.08)",
              background: "#ffffff",
            }}
          >
            <div className="flex items-start gap-2">
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
                style={{
                  background:
                    prefix === "T"
                      ? "rgba(59,130,246,0.12)"
                      : "rgba(168,85,247,0.12)",
                  color:
                    prefix === "T"
                      ? "rgba(29,78,216,0.95)"
                      : "rgba(126,34,206,0.95)",
                }}
              >
                {prefix}
                {i + 1}
              </span>
              <Link
                href={s.url}
                target="_blank"
                className="flex-1 text-[13px] font-semibold leading-snug hover:underline"
                style={{ color: "rgba(15,23,42,0.88)" }}
              >
                {s.title}
                <ExternalLink
                  className="ml-1 inline h-3 w-3 align-baseline"
                  style={{ color: "rgba(15,23,42,0.4)" }}
                />
              </Link>
            </div>
            {s.informs && (
              <p
                className="mt-1.5 text-[12px] font-light italic leading-relaxed"
                style={{ color: "rgba(15,23,42,0.65)" }}
              >
                {s.informs}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
