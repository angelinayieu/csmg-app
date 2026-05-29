"use client";

// ── Workspace Library Card ────────────────────────────────────────
//
// Same typographic discipline as the Strategy Brief:
//   • Restrained color — slate hierarchy + one accent + red only
//     for the attention signal
//   • Generous typography — objective text at 17px with 1.4 lh
//   • Document-feel surface (white "paper" with soft shadow,
//     not a flashy card)
//   • Information density tuned for a 3-second read
//
// Hovering reveals the deliverable shortcuts row — keeps the
// default state quiet, surfaces affordances only when the user
// attends to the card.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileText,
  PanelsTopLeft,
  AlertCircle,
} from "lucide-react";
import type {
  WorkspaceCardData,
  WorkspaceStage,
} from "@/lib/objective-canvas/load-workspace-library";
import type { DomainSignature } from "@/lib/objective-canvas/domain-signature";

const COLOR = {
  ink: "rgba(15,23,42,0.92)",
  inkSoft: "rgba(15,23,42,0.72)",
  inkMuted: "rgba(15,23,42,0.55)",
  inkFaint: "rgba(15,23,42,0.40)",
  inkGhost: "rgba(15,23,42,0.28)",
  rule: "rgba(15,23,42,0.08)",
  paper: "#ffffff",
  accent: "rgba(124,58,237,0.92)",
  accentSoft: "rgba(124,58,237,0.08)",
  conflict: "rgba(220,38,38,0.92)",
  conflictSoft: "rgba(220,38,38,0.06)",
};

const DOMAIN_LABEL: Record<DomainSignature, string> = {
  software: "Product",
  journaling: "Journal",
  book_analysis: "Study",
  passion_chasing: "Direction",
  startup: "Startup",
  research: "Research",
};

const STAGE_LABEL: Record<WorkspaceStage, string> = {
  drafted: "Drafted",
  active: "Active",
  engaged: "Converging",
  shipping: "Shipping",
};

const STAGE_TONE: Record<WorkspaceStage, { fg: string; dot: string }> = {
  drafted: { fg: COLOR.inkGhost, dot: COLOR.inkGhost },
  active: { fg: COLOR.inkMuted, dot: "rgba(15,23,42,0.45)" },
  engaged: { fg: "rgba(76,29,149,0.95)", dot: COLOR.accent },
  shipping: { fg: "rgba(20,83,45,0.95)", dot: "rgba(22,163,74,0.85)" },
};

export function WorkspaceLibraryCard({
  card,
}: {
  card: WorkspaceCardData;
}) {
  const router = useRouter();
  const stageTone = STAGE_TONE[card.stage];
  const hasAttention = card.totals.open_conflicts > 0;
  const href = `/app/objective/${card.id}`;

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={card.display_title}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          router.push(href);
        }
      }}
      className="group block cursor-pointer"
    >
      <article
        className="relative flex flex-col gap-3.5 rounded-2xl px-5 py-4 transition-all"
        style={{
          background: COLOR.paper,
          border: `1px solid ${COLOR.rule}`,
          borderRadius: 14,
        }}
      >
        {/* ── Header — eyebrow row ── */}
        <div
          className="flex items-center justify-between gap-2 text-[10.5px]"
          style={{ color: COLOR.inkFaint }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="font-semibold uppercase tracking-[0.16em]"
              style={{ color: COLOR.inkMuted }}
            >
              {DOMAIN_LABEL[card.domain]}
            </span>
            <span aria-hidden style={{ color: COLOR.inkGhost }}>·</span>
            <span
              className="inline-flex items-center gap-1 font-medium"
              style={{ color: stageTone.fg, letterSpacing: "0.02em" }}
            >
              <span
                className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: stageTone.dot }}
                aria-hidden
              />
              {STAGE_LABEL[card.stage]}
            </span>
          </div>
          <span
            className="font-light"
            style={{ color: COLOR.inkFaint }}
          >
            {relativeTime(card.last_active_at)}
          </span>
        </div>

        {/* ── Objective text — the title ── */}
        <h3
          className="line-clamp-3 text-[17px] font-semibold leading-[1.4]"
          style={{
            color: COLOR.ink,
            letterSpacing: "-0.012em",
            fontFamily:
              'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
          }}
        >
          {card.display_title}
        </h3>

        {/* ── Themes — chips ── */}
        {card.themes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {card.themes.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  background: t.spawned_sub_objective_id
                    ? "rgba(22,163,74,0.07)"
                    : COLOR.accentSoft,
                  color: t.spawned_sub_objective_id
                    ? "rgba(20,83,45,0.95)"
                    : "rgba(76,29,149,0.95)",
                  border: `1px solid ${t.spawned_sub_objective_id ? "rgba(22,163,74,0.18)" : "rgba(124,58,237,0.16)"}`,
                  maxWidth: 200,
                }}
                title={
                  t.spawned_sub_objective_id
                    ? `${t.name} — promoted to a sub-objective`
                    : t.name
                }
              >
                <span className="truncate">{t.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* ── Totals row ── */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
          style={{ color: COLOR.inkMuted }}
        >
          {card.totals.rooms > 0 && (
            <Stat label={plural(card.totals.rooms, "room")} />
          )}
          {card.totals.elected_variations > 0 && (
            <Stat
              label={`${card.totals.elected_variations} elected`}
              sep
            />
          )}
          {card.totals.composed_designs > 0 && (
            <Stat
              label={`${card.totals.composed_designs} composed`}
              sep
            />
          )}
          {card.totals.experiments_planned > 0 && (
            <Stat
              label={plural(card.totals.experiments_planned, "experiment")}
              sep
            />
          )}
          {card.totals.expansion_nodes > 0 && (
            <Stat
              label={`${card.totals.expansion_nodes} deep ${
                card.totals.expansion_nodes === 1 ? "dive" : "dives"
              }`}
              sep
            />
          )}
          {hasAttention && (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: COLOR.conflictSoft,
                color: COLOR.conflict,
                border: `1px solid rgba(220,38,38,0.18)`,
              }}
              title="Open conflicts you haven't resolved"
            >
              <AlertCircle className="h-2.5 w-2.5" strokeWidth={2.5} />
              {plural(card.totals.open_conflicts, "open conflict")}
            </span>
          )}
        </div>

        {/* ── Deliverable shortcuts — revealed on hover ── */}
        {card.stage !== "drafted" && (
          <div
            className="flex flex-wrap items-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{
              borderTop: `1px solid ${COLOR.rule}`,
              paddingTop: "0.6rem",
              marginTop: "0.25rem",
              minHeight: 28,
            }}
          >
            <Shortcut
              href={`/app/objective/${card.id}`}
              icon={<PanelsTopLeft className="h-3 w-3" strokeWidth={2} />}
              label="Canvas"
              primary
            />
            {card.totals.rooms > 0 && (
              <Shortcut
                href={`/app/objective/${card.id}/brief`}
                icon={<FileText className="h-3 w-3" strokeWidth={2} />}
                label={card.has_polished_brief ? "Brief" : "Brief draft"}
              />
            )}
            <span
              className="ml-auto inline-flex items-center text-[10.5px] font-medium"
              style={{ color: COLOR.inkFaint }}
            >
              Open <ArrowRight className="ml-1 h-2.5 w-2.5" strokeWidth={2.5} />
            </span>
          </div>
        )}
      </article>
    </div>
  );
}

// ── Bits ──────────────────────────────────────────────────────────

function Stat({ label, sep = false }: { label: string; sep?: boolean }) {
  return (
    <>
      {sep && (
        <span aria-hidden style={{ color: COLOR.inkGhost }}>
          ·
        </span>
      )}
      <span>{label}</span>
    </>
  );
}

function Shortcut({
  href,
  icon,
  label,
  primary = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-colors"
      style={{
        background: primary ? "rgba(15,23,42,0.92)" : "rgba(15,23,42,0.05)",
        color: primary ? "#fff" : COLOR.inkSoft,
        border: `1px solid ${primary ? "rgba(15,23,42,0.92)" : COLOR.rule}`,
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

// ── Helpers ──

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
