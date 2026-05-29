"use client";

// ── Command Deck ──
//
// The coordinated control surface that sits directly beneath the core
// objective hero on the main canvas. Replaces three scattered,
// inconsistent strips that used to float at different page positions —
// the cross-room Analysis workbench (top of page), the Deliverables
// strip (very bottom), and a lone "View Strategy Brief" button — with
// one objective-led gallery of compact frosted tiles that share a
// single header grammar and expand in place:
//
//   [ Analysis ] [ Operations ] [ Deliverables ] [ Strategy Brief ]
//        └──────────── inline expansion panel (one open at a time) ──┘
//
// Each tile compresses to the single most important number; clicking
// one discloses the full surface below the row. Analysis + Operations
// reuse <AnalysisWorkbench embedded> (one shared instance, section-
// switched); Deliverables reuses <DeliverablesStrip embedded>. This
// component owns layout + the tile summaries only — it never
// duplicates either surface's data logic.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  Package,
  Play,
  ScanSearch,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { AnalysisWorkbench } from "@/components/objective/analysis-workbench";
import { DeliverablesStrip } from "@/components/objective/deliverables-strip";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

export interface DeckOperation {
  key: string;
  label: string;
  description: string;
}

type DeckCard = "analysis" | "operations" | "deliverables";

interface Props {
  spaceId: string;
  /** Server-cached cross-room analysis snapshot. Drives the Analysis
   *  tile's finding count; the panel re-scans live on open. */
  initialAnalysis: CrossRoomAnalysisState | null;
  /** room id → title, for the workbench finding references. */
  roomTitles: Record<string, string>;
  /** Tier-2 operations catalog (Distill / Recommend / Contradictions). */
  operations: DeckOperation[];
  /** Route to the synthesized strategy brief. */
  briefHref: string;
}

// Each card ties to its meaning by a soft accent glow (never a spine):
// Analysis = the objective violet, Operations = features blue,
// Deliverables = outcomes green, Brief = restrained graphite.
const ACCENT: Record<DeckCard | "brief", string> = {
  analysis: appleVibe.stage.objective,
  operations: appleVibe.stage.features,
  deliverables: appleVibe.stage.outcomes,
  brief: appleVibe.accent.primary,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#2563EB",
  info: "rgba(15,23,42,0.35)",
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function pickTopSeverity(
  findings: CrossRoomAnalysisState["findings"],
): string | null {
  if (findings.length === 0) return null;
  let best = "info";
  for (const f of findings) {
    if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(best)) {
      best = f.severity;
    }
  }
  return best;
}

export function CommandDeck({
  spaceId,
  initialAnalysis,
  roomTitles,
  operations,
  briefHref,
}: Props) {
  const [open, setOpen] = useState<DeckCard | null>(null);

  // Analysis summary — from the server-cached snapshot. Live counts
  // refresh inside the panel on open; the tile reflects the last scan.
  const liveFindings = (initialAnalysis?.findings ?? []).filter(
    (f) => f.disposition !== "dismissed",
  );
  const findingCount = liveFindings.length;
  const topSeverity = pickTopSeverity(liveFindings);

  const toggle = (card: DeckCard) =>
    setOpen((cur) => (cur === card ? null : card));

  return (
    <section
      className="mx-auto w-full max-w-3xl"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile
          accent={ACCENT.analysis}
          icon={<ScanSearch className="h-4 w-4" strokeWidth={2} />}
          title="Analysis"
          summary={
            findingCount === 0
              ? "No findings yet"
              : `${findingCount} finding${findingCount === 1 ? "" : "s"}`
          }
          dot={topSeverity ? SEVERITY_COLOR[topSeverity] : undefined}
          active={open === "analysis"}
          onClick={() => toggle("analysis")}
        />
        <Tile
          accent={ACCENT.operations}
          icon={
            <Play className="h-4 w-4" strokeWidth={2} fill="currentColor" />
          }
          title="Operations"
          summary={`${operations.length} to run`}
          active={open === "operations"}
          onClick={() => toggle("operations")}
        />
        <Tile
          accent={ACCENT.deliverables}
          icon={<Package className="h-4 w-4" strokeWidth={2} />}
          title="Deliverables"
          summary="Ready to ship"
          active={open === "deliverables"}
          onClick={() => toggle("deliverables")}
        />
        <TileLink
          accent={ACCENT.brief}
          icon={<FileText className="h-4 w-4" strokeWidth={2} />}
          title="Strategy Brief"
          summary="Synthesized →"
          href={briefHref}
        />
      </div>

      {open && (
        <div
          className="mt-2.5 overflow-hidden border p-4"
          style={{
            background: appleVibe.surface.cardElevated,
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderColor: appleVibe.stroke.soft,
            borderRadius: appleVibe.radius.xl,
            boxShadow: `0 1px 0 rgba(255,255,255,0.9) inset, 0 16px 40px -20px ${ACCENT[open]}44`,
          }}
        >
          {/* Analysis + Operations share ONE workbench instance so the
              findings + operation runs stay on a single piece of state.
              Mounted whenever either tile is open; `section` selects
              which body shows, so toggling between the two never
              remounts (no redundant re-scan). */}
          {(open === "analysis" || open === "operations") && (
            <AnalysisWorkbench
              spaceId={spaceId}
              initialAnalysis={initialAnalysis}
              roomTitles={roomTitles}
              operations={operations}
              embedded
              section={open === "operations" ? "operations" : "findings"}
            />
          )}
          {open === "deliverables" && (
            <DeliverablesStrip spaceId={spaceId} embedded />
          )}
        </div>
      )}
    </section>
  );
}

// ── Tile primitives ───────────────────────────────────────────────

function tileStyle(accent: string, active: boolean): React.CSSProperties {
  return {
    background: appleVibe.surface.card,
    borderColor: active ? `${accent}55` : appleVibe.stroke.soft,
    borderRadius: appleVibe.radius.lg,
    boxShadow: active
      ? `0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 30px -14px ${accent}66`
      : appleVibe.shadow.chip,
  };
}

function TileHead({
  accent,
  icon,
  trailing,
}: {
  accent: string;
  icon: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full"
        style={{ background: `${accent}14`, color: accent }}
        aria-hidden
      >
        {icon}
      </span>
      {trailing}
    </div>
  );
}

function TileBody({
  title,
  summary,
  dot,
}: {
  title: string;
  summary: string;
  dot?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[12.5px] font-semibold tracking-[-0.01em]"
        style={{ color: appleVibe.text.primary }}
      >
        {title}
      </span>
      <span
        className="flex items-center gap-1 text-[11px] font-light"
        style={{ color: appleVibe.text.tertiary }}
      >
        {dot && (
          <span
            className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: dot }}
            aria-hidden
          />
        )}
        {summary}
      </span>
    </div>
  );
}

function Tile({
  accent,
  icon,
  title,
  summary,
  dot,
  active,
  onClick,
}: {
  accent: string;
  icon: ReactNode;
  title: string;
  summary: string;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex flex-col gap-2.5 border p-3 text-left transition-all"
      style={tileStyle(accent, active)}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.boxShadow = appleVibe.shadow.cardHover;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.boxShadow = appleVibe.shadow.chip;
      }}
    >
      <TileHead
        accent={accent}
        icon={icon}
        trailing={
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform"
            strokeWidth={2.2}
            style={{
              color: appleVibe.text.faint,
              transform: active ? "rotate(180deg)" : "none",
            }}
          />
        }
      />
      <TileBody title={title} summary={summary} dot={dot} />
    </button>
  );
}

function TileLink({
  accent,
  icon,
  title,
  summary,
  href,
}: {
  accent: string;
  icon: ReactNode;
  title: string;
  summary: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2.5 border p-3 transition-all"
      style={tileStyle(accent, false)}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = appleVibe.shadow.cardHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = appleVibe.shadow.chip;
      }}
    >
      <TileHead
        accent={accent}
        icon={icon}
        trailing={
          <ArrowUpRight
            className="h-3.5 w-3.5"
            strokeWidth={2.2}
            style={{ color: appleVibe.text.faint }}
          />
        }
      />
      <TileBody title={title} summary={summary} />
    </Link>
  );
}
