"use client";

// ── Experiments Library View ──────────────────────────────────────
//
// The research notebook — every prototype brief, browsable across
// every workspace, filterable by status / domain / workspace.
//
// Design discipline mirrors the Strategy Brief + WorkspaceLibrary:
//   • Single-column index-card list, max 760px content width
//   • Generous typography — hypothesis at 16px, 1.6 line-height
//   • Color used sparingly: status drives a small left ribbon
//     (planned=slate · running=blue · concluded=green · abandoned=gray
//      · null=neutral)
//   • Domain + workspace + room read like memo metadata, not chips
//   • Filter chips up top — restrained, no dropdown menus
//
// One card per experiment. Status mutation lives on each card via
// a small popover that fires PATCH /api/brainstorm/item/variation/
// prototype/status.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Beaker,
  CheckCircle2,
  Circle,
  Play,
  Slash,
  XCircle,
} from "lucide-react";
import type {
  ExperimentCardData,
  ExperimentStatus,
} from "@/lib/objective-canvas/load-experiments-library";
import type { DomainSignature } from "@/lib/objective-canvas/domain-signature";

const COLOR = {
  ink: "rgba(15,23,42,0.92)",
  inkSoft: "rgba(15,23,42,0.72)",
  inkMuted: "rgba(15,23,42,0.55)",
  inkFaint: "rgba(15,23,42,0.40)",
  inkGhost: "rgba(15,23,42,0.28)",
  rule: "rgba(15,23,42,0.08)",
  paper: "#ffffff",
  bg: "#fafafa",
  accent: "rgba(124,58,237,0.92)",
  accentSoft: "rgba(124,58,237,0.08)",
  // Status palette — single-axis, never paired
  planned: "rgba(15,23,42,0.55)",
  running: "rgba(37,99,235,0.85)",
  concluded: "rgba(22,163,74,0.85)",
  abandoned: "rgba(15,23,42,0.30)",
  conflict: "rgba(220,38,38,0.92)",
};

const FONT = {
  display:
    'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  body:
    'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
};

const DOMAIN_LABEL: Record<DomainSignature, string> = {
  software: "Product",
  journaling: "Journal",
  book_analysis: "Study",
  passion_chasing: "Direction",
  startup: "Startup",
  research: "Research",
};

const STATUS_LABEL: Record<NonNullable<ExperimentStatus>, string> = {
  planned: "Planned",
  running: "Running",
  concluded: "Concluded",
  abandoned: "Abandoned",
};

const STATUS_COLOR: Record<NonNullable<ExperimentStatus>, string> = {
  planned: COLOR.planned,
  running: COLOR.running,
  concluded: COLOR.concluded,
  abandoned: COLOR.abandoned,
};

const STATUS_ICONS = {
  planned: Circle,
  running: Play,
  concluded: CheckCircle2,
  abandoned: Slash,
} as const;

type StatusFilter = "all" | "open" | NonNullable<ExperimentStatus>;
type DomainFilter = "all" | DomainSignature;
type WorkspaceFilter = "all" | string;

interface Props {
  experiments: ExperimentCardData[];
}

export function ExperimentsLibraryView({ experiments }: Props) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [domain, setDomain] = useState<DomainFilter>("all");
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const [local, setLocal] = useState<ExperimentCardData[]>(experiments);

  // Build filter options from the data (only show chips that are
  // actually present in the set — avoids dead filter UI).
  const presentDomains = useMemo(() => {
    const set = new Set<DomainSignature>();
    for (const e of local) set.add(e.domain);
    return Array.from(set);
  }, [local]);

  const presentWorkspaces = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of local) map.set(e.workspace_id, e.workspace_title);
    return Array.from(map.entries()).slice(0, 8);
  }, [local]);

  // Counts per status — fed into the chip labels so the user sees
  // distribution without clicking.
  const statusCounts = useMemo(() => {
    const counts = {
      all: local.length,
      open: 0,
      planned: 0,
      running: 0,
      concluded: 0,
      abandoned: 0,
    };
    for (const e of local) {
      const s = e.status ?? "planned"; // null → planned for filter purposes
      counts[s] += 1;
      if (s !== "concluded" && s !== "abandoned") counts.open += 1;
    }
    return counts;
  }, [local]);

  const filtered = useMemo(() => {
    return local.filter((e) => {
      // Status filter
      if (status !== "all") {
        const s = e.status ?? "planned";
        if (status === "open") {
          if (s === "concluded" || s === "abandoned") return false;
        } else if (s !== status) return false;
      }
      if (domain !== "all" && e.domain !== domain) return false;
      if (workspace !== "all" && e.workspace_id !== workspace) return false;
      return true;
    });
  }, [local, status, domain, workspace]);

  const updateStatus = useCallback(
    async (
      card: ExperimentCardData,
      next: ExperimentStatus,
      resultSummary?: string,
    ) => {
      // Optimistic local update.
      setLocal((prev) =>
        prev.map((e) =>
          e.id === card.id
            ? {
                ...e,
                status: next,
                ...(next === "concluded" && resultSummary !== undefined
                  ? { result_summary: resultSummary }
                  : {}),
              }
            : e,
        ),
      );
      try {
        await fetch("/api/brainstorm/item/variation/prototype/status", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId: card.item_id,
            briefId: card.id,
            status: next,
            ...(next === "concluded" && resultSummary
              ? { result_summary: resultSummary }
              : {}),
          }),
        });
      } catch {
        // Optimistic — soft-fail; next reload reconciles.
      }
      // No router.refresh — server state will reconcile on next page load.
    },
    [],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLOR.bg,
        fontFamily: FONT.body,
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(250,250,250,0.92)",
          borderBottom: `1px solid ${COLOR.rule}`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          className="mx-auto flex items-center justify-between gap-4 px-6 py-3"
          style={{ maxWidth: 1100 }}
        >
          <Link
            href="/app/objective"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium"
            style={{ color: COLOR.inkMuted }}
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Back to library
          </Link>
          <div className="flex items-center gap-2">
            <Beaker
              className="h-3.5 w-3.5"
              strokeWidth={2}
              style={{ color: COLOR.inkMuted }}
            />
            <span
              className="text-[10.5px] font-semibold uppercase"
              style={{ color: COLOR.inkMuted, letterSpacing: "0.16em" }}
            >
              Experiments · {local.length}
            </span>
          </div>
        </div>
      </div>

      {/* ── Document body ── */}
      <div
        className="mx-auto px-8 pb-32 pt-12"
        style={{ maxWidth: 760, color: COLOR.ink }}
      >
        <header>
          <div
            className="text-[10.5px] font-semibold uppercase"
            style={{
              color: COLOR.inkFaint,
              letterSpacing: "0.18em",
            }}
          >
            Library · Experiments
          </div>
          <h1
            className="mt-3 text-[30px] font-semibold leading-[1.15]"
            style={{
              color: COLOR.ink,
              letterSpacing: "-0.022em",
              fontFamily: FONT.display,
            }}
          >
            Your research notebook
          </h1>
          <p
            className="mt-3 max-w-[600px] text-[14.5px] font-light leading-[1.6]"
            style={{ color: COLOR.inkSoft }}
          >
            Every experiment you&rsquo;ve designed from an open question
            across every workspace. Mark them as you run them — what was
            planned, what&rsquo;s in flight, what you learned.
          </p>
        </header>

        {/* ── Filter row ── */}
        <div
          className="mt-8 flex flex-col gap-3 border-t pt-6"
          style={{ borderColor: COLOR.rule }}
        >
          <FilterGroup label="Status">
            <FilterChip
              active={status === "all"}
              onClick={() => setStatus("all")}
              label={`All · ${statusCounts.all}`}
            />
            <FilterChip
              active={status === "open"}
              onClick={() => setStatus("open")}
              label={`Open · ${statusCounts.open}`}
            />
            <FilterChip
              active={status === "running"}
              onClick={() => setStatus("running")}
              label={`Running · ${statusCounts.running}`}
              dot={COLOR.running}
            />
            <FilterChip
              active={status === "concluded"}
              onClick={() => setStatus("concluded")}
              label={`Concluded · ${statusCounts.concluded}`}
              dot={COLOR.concluded}
            />
            {statusCounts.abandoned > 0 && (
              <FilterChip
                active={status === "abandoned"}
                onClick={() => setStatus("abandoned")}
                label={`Abandoned · ${statusCounts.abandoned}`}
                dot={COLOR.abandoned}
              />
            )}
          </FilterGroup>

          {presentDomains.length > 1 && (
            <FilterGroup label="Domain">
              <FilterChip
                active={domain === "all"}
                onClick={() => setDomain("all")}
                label="All"
              />
              {presentDomains.map((d) => (
                <FilterChip
                  key={d}
                  active={domain === d}
                  onClick={() => setDomain(d)}
                  label={DOMAIN_LABEL[d]}
                />
              ))}
            </FilterGroup>
          )}

          {presentWorkspaces.length > 1 && (
            <FilterGroup label="Workspace">
              <FilterChip
                active={workspace === "all"}
                onClick={() => setWorkspace("all")}
                label="All"
              />
              {presentWorkspaces.map(([id, title]) => (
                <FilterChip
                  key={id}
                  active={workspace === id}
                  onClick={() => setWorkspace(id)}
                  label={title.length > 32 ? `${title.slice(0, 30)}…` : title}
                />
              ))}
            </FilterGroup>
          )}
        </div>

        {/* ── Empty filter state ── */}
        {filtered.length === 0 && (
          <div
            className="mt-10 rounded-2xl px-6 py-8 text-center"
            style={{
              background: COLOR.paper,
              border: `1px solid ${COLOR.rule}`,
              borderRadius: 12,
            }}
          >
            <p
              className="text-[14px] font-light italic"
              style={{ color: COLOR.inkMuted }}
            >
              No experiments match these filters.
            </p>
          </div>
        )}

        {/* ── Experiment cards ── */}
        {filtered.length > 0 && (
          <ul className="mt-10 flex flex-col gap-3.5">
            {filtered.map((card) => (
              <ExperimentCard
                key={card.id}
                card={card}
                onStatusChange={(s) => updateStatus(card, s)}
                onConclude={(summary) =>
                  updateStatus(card, "concluded", summary)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Single experiment card ────────────────────────────────────────

function ExperimentCard({
  card,
  onStatusChange,
  onConclude,
}: {
  card: ExperimentCardData;
  onStatusChange: (next: ExperimentStatus) => void;
  onConclude: (summary: string) => void;
}) {
  const effective: NonNullable<ExperimentStatus> = card.status ?? "planned";
  const statusColor = STATUS_COLOR[effective];
  const concluded = effective === "concluded";
  const abandoned = effective === "abandoned";
  const muted = concluded || abandoned;

  const [showConclude, setShowConclude] = useState(false);
  const [resultDraft, setResultDraft] = useState(card.result_summary ?? "");

  return (
    <li
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: COLOR.paper,
        border: `1px solid ${COLOR.rule}`,
        borderRadius: 12,
        opacity: muted ? 0.85 : 1,
      }}
    >
      {/* Status ribbon — thin left bar */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: statusColor,
        }}
      />
      <div className="flex flex-col gap-3 px-5 py-4 pl-6">
        {/* ── Metadata row ── */}
        <div
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px]"
          style={{ color: COLOR.inkFaint }}
        >
          <span
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: statusColor, letterSpacing: "0.02em" }}
          >
            {(() => {
              const Icon = STATUS_ICONS[effective];
              return <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />;
            })()}
            <span className="uppercase tracking-[0.12em]">
              {STATUS_LABEL[effective]}
            </span>
          </span>
          <span aria-hidden style={{ color: COLOR.inkGhost }}>·</span>
          <span
            className="font-semibold uppercase tracking-[0.14em]"
            style={{ color: COLOR.inkMuted }}
          >
            {DOMAIN_LABEL[card.domain]}
          </span>
          <span aria-hidden style={{ color: COLOR.inkGhost }}>·</span>
          <Link
            href={`/app/objective/${card.workspace_id}`}
            className="font-medium hover:underline"
            style={{ color: COLOR.inkMuted }}
          >
            {card.workspace_title.length > 28
              ? `${card.workspace_title.slice(0, 26)}…`
              : card.workspace_title}
          </Link>
          <span aria-hidden style={{ color: COLOR.inkGhost }}>›</span>
          <Link
            href={`/app/objective/${card.workspace_id}/sub/${card.room_id}`}
            className="font-medium hover:underline"
            style={{ color: COLOR.inkMuted }}
          >
            {card.room_title.length > 28
              ? `${card.room_title.slice(0, 26)}…`
              : card.room_title}
          </Link>
          <span aria-hidden style={{ color: COLOR.inkGhost }}>·</span>
          <span style={{ color: COLOR.inkFaint }}>{card.item_name}</span>
          <span
            className="ml-auto font-light"
            style={{ color: COLOR.inkFaint }}
          >
            {card.artifact_type}
          </span>
        </div>

        {/* ── Hypothesis (the headline) ── */}
        <p
          className="text-[16px] font-semibold leading-[1.45]"
          style={{
            color: COLOR.ink,
            letterSpacing: "-0.008em",
            fontFamily: FONT.display,
          }}
        >
          {card.hypothesis}
        </p>

        {/* ── Open question — what this is answering ── */}
        <p
          className="text-[12.5px] italic leading-[1.55]"
          style={{ color: COLOR.inkMuted }}
        >
          Answers: {card.open_question}
        </p>

        {/* ── Operational pair: signal + kill + effort ── */}
        <div
          className="flex flex-col gap-1 text-[12.5px] leading-[1.55]"
          style={{ color: COLOR.inkSoft }}
        >
          <div>
            <Label>Signal</Label> {card.signal_to_watch}
          </div>
          <div>
            <Label>Kill criteria</Label> {card.kill_criteria}
          </div>
          <div>
            <Label>Effort</Label> {card.build_estimate}
          </div>
        </div>

        {/* ── Result summary (only when concluded) ── */}
        {concluded && card.result_summary && (
          <div
            className="rounded-lg p-3"
            style={{
              background: "rgba(22,163,74,0.04)",
              border: `1px solid rgba(22,163,74,0.18)`,
            }}
          >
            <div
              className="text-[10px] font-semibold uppercase"
              style={{
                color: "rgba(20,83,45,0.95)",
                letterSpacing: "0.14em",
              }}
            >
              Result
            </div>
            <p
              className="mt-1 text-[13px] leading-[1.55]"
              style={{ color: COLOR.ink }}
            >
              {card.result_summary}
            </p>
          </div>
        )}

        {/* ── Footer: learning target + status actions ── */}
        <div
          className="flex flex-wrap items-end justify-between gap-3 pt-1"
          style={{ borderTop: `1px dashed ${COLOR.rule}`, paddingTop: 12 }}
        >
          <p
            className="max-w-[460px] flex-1 text-[12px] italic leading-[1.55]"
            style={{ color: COLOR.inkMuted }}
          >
            You&rsquo;ll know: {card.learning_target}
          </p>

          <div className="flex flex-shrink-0 items-center gap-1">
            {!concluded && (
              <>
                {effective !== "running" && (
                  <StatusBtn
                    onClick={() => onStatusChange("running")}
                    icon={<Play className="h-2.5 w-2.5" strokeWidth={2.5} />}
                    label="Start"
                    color={COLOR.running}
                  />
                )}
                <StatusBtn
                  onClick={() => setShowConclude((v) => !v)}
                  icon={
                    <CheckCircle2
                      className="h-2.5 w-2.5"
                      strokeWidth={2.5}
                    />
                  }
                  label="Conclude"
                  color={COLOR.concluded}
                />
                {effective !== "abandoned" && (
                  <StatusBtn
                    onClick={() => onStatusChange("abandoned")}
                    icon={<XCircle className="h-2.5 w-2.5" strokeWidth={2.5} />}
                    label="Abandon"
                    color={COLOR.abandoned}
                    quiet
                  />
                )}
              </>
            )}
            {concluded && (
              <StatusBtn
                onClick={() => onStatusChange(null)}
                icon={<Circle className="h-2.5 w-2.5" strokeWidth={2.5} />}
                label="Reopen"
                color={COLOR.inkMuted}
                quiet
              />
            )}
          </div>
        </div>

        {/* ── Conclude inline form ── */}
        {showConclude && !concluded && (
          <div
            className="mt-1 rounded-lg p-3"
            style={{
              background: "rgba(22,163,74,0.03)",
              border: `1px solid rgba(22,163,74,0.16)`,
            }}
          >
            <div
              className="text-[10px] font-semibold uppercase"
              style={{
                color: "rgba(20,83,45,0.95)",
                letterSpacing: "0.14em",
              }}
            >
              What did you learn?
            </div>
            <textarea
              value={resultDraft}
              onChange={(e) => setResultDraft(e.target.value)}
              className="mt-2 w-full rounded-lg px-3 py-2 text-[13px] leading-[1.5]"
              style={{
                background: COLOR.paper,
                border: `1px solid ${COLOR.rule}`,
                color: COLOR.ink,
                outline: "none",
                fontFamily: FONT.body,
                resize: "vertical",
                minHeight: 70,
              }}
              placeholder="The binary update — what you now know that you didn't before."
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowConclude(false);
                  setResultDraft(card.result_summary ?? "");
                }}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{
                  color: COLOR.inkMuted,
                  background: "transparent",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConclude(false);
                  onConclude(resultDraft.trim());
                }}
                disabled={resultDraft.trim().length === 0}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background:
                    resultDraft.trim().length === 0
                      ? "rgba(15,23,42,0.04)"
                      : COLOR.concluded,
                  color:
                    resultDraft.trim().length === 0
                      ? COLOR.inkFaint
                      : "#fff",
                }}
              >
                <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.5} />
                Save result
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ── Bits ──────────────────────────────────────────────────────────

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="mr-1 text-[10px] font-semibold uppercase"
        style={{ color: COLOR.inkFaint, letterSpacing: "0.14em" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  dot,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
      style={{
        background: active ? "rgba(15,23,42,0.92)" : COLOR.paper,
        color: active ? "#fff" : COLOR.inkSoft,
        border: `1px solid ${active ? "rgba(15,23,42,0.92)" : COLOR.rule}`,
      }}
    >
      {dot && (
        <span
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: active ? "#fff" : dot }}
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

function StatusBtn({
  onClick,
  icon,
  label,
  color,
  quiet = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: string;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-colors"
      style={{
        background: quiet ? "transparent" : `${color.replace("0.85", "0.12").replace("0.92", "0.12")}`,
        color: color,
        border: `1px solid ${quiet ? COLOR.rule : color}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mr-1 inline-block text-[10px] font-semibold uppercase"
      style={{
        color: COLOR.inkFaint,
        letterSpacing: "0.12em",
      }}
    >
      {children}
    </span>
  );
}
