"use client";

// ── Lab Notebook Panel ────────────────────────────────────────────
//
// Phase 9 — right-edge slide-in surface for the room's decision
// history. Reads from GET /api/brainstorm/sub-objectives/[id]/decisions
// and renders a day-grouped timeline of every meaningful event:
//
//   • elect / reject / defer    — disposition on a variation
//   • rd_iterate                — R&D experiment ran
//   • score                     — mechanism effectiveness scored
//   • approve_bet               — chain approved
//   • compose                   — composed design synthesized
//   • generate_batch / confirm  — picker activity (legacy surfacing)
//
// Each row carries lane color from the event's role, a relative
// timestamp ("4 min ago"), display strings for the subject, and
// optional context chips (lift %, placebo verdict, candidate count).
// Clicking a row fires onNavigate({ chainEntityId, variationId })
// so the host can focus the relevant Category Card + open drawer.
//
// Visual chrome mirrors ItemDetailDrawer:
//   • 480px max width on desktop
//   • Backdrop blur + soft drop shadow
//   • Right-edge slide animation, 0.36s ease-out
//   • Apple-vibe tokens throughout
//
// Pagination via "Load older" — cursor is the OLDEST event's ISO
// timestamp from the current page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  NotebookEvent,
  NotebookEventPage,
} from "@/lib/objective-canvas/notebook-events";

interface Props {
  /** When false, the panel is unmounted entirely (AnimatePresence
   *  drives exit). The host owns the open state. */
  open: boolean;
  onClose: () => void;
  /** Phase 10b — which feed to read:
   *   "room"  → GET /sub-objectives/[id]/decisions (Phase 9 path).
   *             `subObjectiveId` required.
   *   "space" → GET /space/[spaceId]/decisions (Phase 10b path).
   *             `spaceId` required. Surfaces ALL events for the
   *             space: pre-room (stage/clarifying/picking),
   *             cross-room (workbench/themes/concepts), AND each
   *             room's per-item work — tagged with room title so
   *             the user can scan the whole canvas history.
   *  Defaults to "room" for backward compat. */
  mode?: "room" | "space";
  /** The sub-objective whose decisions the notebook reads (mode="room"). */
  subObjectiveId?: string;
  /** The space whose decisions the notebook reads (mode="space"). */
  spaceId?: string;
  /** Click-handler fired when the user clicks a row. Host routes
   *  to the relevant Category Card / drawer. Optional — when
   *  omitted, rows render but don't navigate. */
  onNavigate?: (target: NotebookNavigateTarget) => void;
}

export interface NotebookNavigateTarget {
  entityId?: string | null;
  variationId?: string | null;
  /** Phase 10b — set when clicking a row from the space-scoped view;
   *  host can navigate to the matching room before opening the drawer. */
  subObjectiveId?: string | null;
}

const FILTERS: ReadonlyArray<{
  label: string;
  actions: NotebookEvent["action"][] | null;
}> = [
  { label: "All", actions: null },
  {
    label: "Experiments",
    actions: ["rd_iterate", "score", "autopilot_run", "autopilot_iteration"],
  },
  { label: "Elections", actions: ["elect", "reject", "defer", "clear"] },
  { label: "Bets", actions: ["approve_bet", "compose"] },
  // Phase 10a — System events: room births, item expansions, expansion tree
  // growth, prototype lifecycle, finding curation, theme/concept branching,
  // constraint changes, stage transitions. These describe what the canvas
  // (and the user) did at the system altitude rather than per-chain work.
  {
    label: "System",
    actions: [
      "room_generated",
      "item_expanded",
      "expansion_spawned",
      "prototype_status_changed",
      "finding_acknowledged",
      "finding_dismissed",
      "finding_resolved",
      "theme_distilled",
      "concept_branched",
      "constraints_set",
      "stage_transitioned",
    ],
  },
];

export function LabNotebookPanel({
  open,
  onClose,
  mode = "room",
  subObjectiveId,
  spaceId,
  onNavigate,
}: Props) {
  const reduce = useReducedMotion();
  const [events, setEvents] = useState<NotebookEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterIdx, setFilterIdx] = useState(0);

  // Phase 10b — switch feed URL based on mode. Room mode uses the
  // existing Phase 9 endpoint (filters by sub_objective_id). Space
  // mode uses the new 10b endpoint that returns ALL space events —
  // both per-room rows (sub_objective_id set) and space-level rows
  // (sub_objective_id null: stage/clarifying/findings/themes).
  const feedUrl =
    mode === "space" && spaceId
      ? `/api/brainstorm/space/${spaceId}/decisions`
      : subObjectiveId
        ? `/api/brainstorm/sub-objectives/${subObjectiveId}/decisions`
        : null;

  const fetchPage = useCallback(
    async (opts: { cursor?: string | null; reset?: boolean }) => {
      if (!feedUrl) {
        setError("Missing notebook target.");
        return;
      }
      const filter = FILTERS[filterIdx];
      const qs = new URLSearchParams();
      if (opts.cursor) qs.set("cursor", opts.cursor);
      if (filter.actions) qs.set("actions", filter.actions.join(","));
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${feedUrl}?${qs.toString()}`);
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(j.error ?? "Couldn't load notebook.");
          return;
        }
        const page = (await res.json()) as NotebookEventPage;
        setEvents((prev) =>
          opts.reset ? page.events : [...prev, ...page.events],
        );
        setTotal(page.total);
        setNextCursor(page.next_cursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [feedUrl, filterIdx],
  );

  // Load on open + when filter changes.
  useEffect(() => {
    if (!open) return;
    setEvents([]);
    setNextCursor(null);
    void fetchPage({ reset: true });
  }, [open, fetchPage]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Group events by day for the timeline display.
  const grouped = useMemo(() => groupByDay(events), [events]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(15,23,42,0.32)" }}
            aria-hidden
          />
          <motion.aside
            role="dialog"
            aria-label="Lab Notebook"
            initial={reduce ? { x: 0, opacity: 0 } : { x: "100%", opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0 }}
            transition={{
              duration: reduce ? 0 : 0.36,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden md:w-[480px]"
            style={{
              background: appleVibe.surface.card,
              borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
              fontFamily: appleVibe.font.stack,
              boxShadow: "0 0 40px -8px rgba(11,18,40,0.28)",
            }}
          >
            {/* Header */}
            <header
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{
                borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {mode === "space" ? "Canvas Notebook · All rooms" : "Lab Notebook"}
                </div>
                <h2
                  className="mt-1 truncate text-[18px] font-semibold leading-tight tracking-tight"
                  style={{
                    color: appleVibe.text.primary,
                    fontFamily: appleVibe.font.display,
                    letterSpacing: "-0.015em",
                  }}
                >
                  {total} {total === 1 ? "event" : "events"}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.04)]"
                aria-label="Close notebook"
                style={{ color: appleVibe.text.secondary }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            {/* Filter chips */}
            <div
              className="flex flex-wrap items-center gap-1.5 px-5 py-3"
              style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              {FILTERS.map((f, i) => {
                const active = i === filterIdx;
                return (
                  <motion.button
                    key={f.label}
                    type="button"
                    onClick={() => setFilterIdx(i)}
                    whileHover={{ y: -1, transition: { duration: 0.15 } }}
                    whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
                    className="inline-flex items-center gap-1 transition-[background,color] duration-150 ease-out"
                    style={{
                      background: active
                        ? appleVibe.accent.primary
                        : "transparent",
                      color: active
                        ? appleVibe.text.onAccent
                        : appleVibe.text.secondary,
                      border: `1px solid ${active ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
                      borderRadius: appleVibe.radius.pill,
                      padding: "3px 10px",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {f.label}
                  </motion.button>
                );
              })}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div
                  className="mb-3 px-3 py-2"
                  style={{
                    background: "rgba(220,38,38,0.04)",
                    border: "1px solid rgba(220,38,38,0.20)",
                    borderRadius: appleVibe.radius.sm,
                  }}
                >
                  <p
                    className="text-[12px]"
                    style={{ color: "rgba(127,29,29,0.95)" }}
                  >
                    {error}
                  </p>
                </div>
              )}

              {!error && events.length === 0 && !loading && (
                <EmptyState />
              )}

              {grouped.map(({ label, events: dayEvents }) => (
                <section key={label} className="mb-5">
                  <div
                    className="mb-2 flex items-center gap-2"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      {label}
                    </span>
                    <span
                      className="h-px flex-1"
                      style={{ background: appleVibe.stroke.hairline }}
                    />
                  </div>
                  <ul className="space-y-1.5">
                    {dayEvents.map((ev) => (
                      <NotebookRow
                        key={ev.id}
                        event={ev}
                        onClick={() =>
                          onNavigate?.({
                            entityId: ev.subject.entity_id ?? null,
                            variationId: ev.subject.variation_id ?? null,
                            // Phase 10b — forward room context so the
                            // host (main canvas) can route to the
                            // right room before opening the drawer.
                            subObjectiveId: ev.subject.sub_objective_id ?? null,
                          })
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {/* Load older */}
              {nextCursor && (
                <div className="mt-4 flex justify-center">
                  <motion.button
                    type="button"
                    onClick={() => void fetchPage({ cursor: nextCursor })}
                    disabled={loading}
                    whileHover={{ y: -1, transition: { duration: 0.15 } }}
                    whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
                    className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: "transparent",
                      color: appleVibe.text.secondary,
                      border: `1px solid ${appleVibe.stroke.medium}`,
                      borderRadius: appleVibe.radius.pill,
                      padding: "4px 12px",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader2
                          className="h-2.5 w-2.5 animate-spin"
                          strokeWidth={2.5}
                        />
                        Loading…
                      </>
                    ) : (
                      "Load older"
                    )}
                  </motion.button>
                </div>
              )}

              {loading && events.length === 0 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Loader2
                    className="h-3 w-3 animate-spin"
                    strokeWidth={2}
                    style={{ color: appleVibe.text.tertiary }}
                  />
                  <span
                    className="text-[11.5px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Loading notebook…
                  </span>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="mt-6 px-4 py-10 text-center"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px dashed ${appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.lg,
      }}
    >
      <div
        className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full"
        style={{
          background: appleVibe.surface.chip,
          color: appleVibe.text.tertiary,
        }}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <p
        className="text-[12.5px] font-medium"
        style={{ color: appleVibe.text.secondary }}
      >
        No decisions yet.
      </p>
      <p
        className="mt-1 text-[11.5px] font-light leading-snug"
        style={{ color: appleVibe.text.tertiary }}
      >
        The notebook fills as you elect variations, run experiments,
        and approve bets.
      </p>
    </div>
  );
}

// ── Per-row render ────────────────────────────────────────────────

function NotebookRow({
  event: ev,
  onClick,
}: {
  event: NotebookEvent;
  onClick?: () => void;
}) {
  // Phase 10b — visualFor is action-driven; the row click handler
  // now forwards sub_objective_id too so the host can route to the
  // right room from the all-rooms feed.
  const visual = visualFor(ev.action);
  const Icon = visual.icon;
  const subject = formatSubject(ev);
  const time = formatTime(ev.created_at);
  return (
    <motion.li
      whileHover={{ y: -0.5, transition: { duration: 0.15 } }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      onClick={onClick}
      className="cursor-pointer transition-colors duration-150 ease-out"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.sm,
        padding: "10px 12px",
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: `${visual.color}14`,
            color: visual.color,
          }}
          aria-hidden
        >
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-[11.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {visual.label}
            </span>
            <span
              className="flex-shrink-0 font-mono text-[10px] tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
              title={new Date(ev.created_at).toLocaleString()}
            >
              {time}
            </span>
          </div>
          {subject && (
            <p
              className="mt-0.5 text-[11.5px] leading-snug line-clamp-2"
              style={{ color: appleVibe.text.secondary }}
            >
              {subject}
            </p>
          )}
          {/* Metadata chips — render small data badges when present */}
          <MetadataChips event={ev} />
        </div>
      </div>
    </motion.li>
  );
}

function MetadataChips({ event: ev }: { event: NotebookEvent }) {
  const chips: Array<{ key: string; label: string; color?: string }> = [];
  if (typeof ev.meta.top_score === "number") {
    chips.push({
      key: "top",
      label: `top ${(ev.meta.top_score * 100).toFixed(0)}`,
      color: appleVibe.stage.features,
    });
  }
  if (typeof ev.meta.effectiveness_score === "number") {
    chips.push({
      key: "score",
      label: `score ${(ev.meta.effectiveness_score * 100).toFixed(0)}`,
      color: appleVibe.stage.features,
    });
  }
  if (typeof ev.meta.lift_pct === "number") {
    chips.push({
      key: "lift",
      label: `lift ${(ev.meta.lift_pct * 100).toFixed(0)}%`,
    });
  }
  if (ev.meta.placebo_verdict) {
    chips.push({
      key: "placebo",
      label: `placebo ${ev.meta.placebo_verdict}`,
      color:
        ev.meta.placebo_verdict === "pass"
          ? appleVibe.stage.outcomes
          : ev.meta.placebo_verdict === "fail"
            ? appleVibe.stage.pain
            : appleVibe.text.tertiary,
    });
  }
  if (typeof ev.meta.candidate_count === "number") {
    chips.push({
      key: "cands",
      label: `${ev.meta.candidate_count} candidate${ev.meta.candidate_count === 1 ? "" : "s"}`,
    });
  }
  if (typeof ev.meta.conflicts_open_count === "number" && ev.meta.conflicts_open_count > 0) {
    chips.push({
      key: "conf",
      label: `${ev.meta.conflicts_open_count} conflict${ev.meta.conflicts_open_count === 1 ? "" : "s"} open`,
      color: appleVibe.stage.pain,
    });
  }
  if (ev.meta.target_root_cause) {
    chips.push({
      key: "gap",
      label: `targets: "${ev.meta.target_root_cause}"`,
    });
  }
  // ── Phase 10a system-event chips ──
  if (ev.meta.room_layer_counts) {
    const c = ev.meta.room_layer_counts;
    const parts: string[] = [];
    if (c.pain !== undefined) parts.push(`${c.pain} pains`);
    if (c.features !== undefined) parts.push(`${c.features} mechanisms`);
    if (c.outcomes !== undefined) parts.push(`${c.outcomes} outcomes`);
    if (parts.length > 0) {
      chips.push({ key: "layer-counts", label: parts.join(" · ") });
    }
  }
  if (typeof ev.meta.variation_count === "number" && ev.meta.variation_count > 0) {
    chips.push({
      key: "variations",
      label: `${ev.meta.variation_count} variation${ev.meta.variation_count === 1 ? "" : "s"}`,
    });
  }
  if (ev.meta.had_research) {
    chips.push({ key: "research", label: "research-backed" });
  }
  if (ev.meta.prototype_status) {
    const ps = ev.meta.prototype_status;
    chips.push({
      key: "proto-status",
      label: ev.meta.prior_prototype_status
        ? `${ev.meta.prior_prototype_status} → ${ps}`
        : ps,
      color:
        ps === "concluded"
          ? appleVibe.stage.outcomes
          : ps === "abandoned"
            ? appleVibe.stage.pain
            : ps === "running"
              ? appleVibe.stage.features
              : appleVibe.text.tertiary,
    });
  }
  if (ev.meta.expansion_node_title) {
    chips.push({
      key: "exp-title",
      label: `"${ev.meta.expansion_node_title}"`,
    });
  }
  if (ev.meta.finding_category) {
    chips.push({
      key: "find-cat",
      label: ev.meta.finding_severity
        ? `${ev.meta.finding_category} · ${ev.meta.finding_severity}`
        : ev.meta.finding_category,
      color:
        ev.meta.finding_severity === "critical"
          ? appleVibe.stage.pain
          : appleVibe.text.tertiary,
    });
  }
  if (ev.meta.theme_title) {
    chips.push({ key: "theme", label: `"${ev.meta.theme_title}"` });
  }
  if (ev.meta.canonical_display_name) {
    chips.push({
      key: "concept",
      label: ev.meta.canonical_display_name,
      color: appleVibe.stage.objective,
    });
  }
  if (ev.meta.constraints_summary) {
    chips.push({
      key: "constraints",
      label: ev.meta.constraints_summary,
    });
  }
  if (ev.meta.stage_from && ev.meta.stage_to) {
    chips.push({
      key: "stage",
      label: `${ev.meta.stage_from} → ${ev.meta.stage_to}`,
      color: appleVibe.accent.primary,
    });
  }
  if (typeof ev.meta.chain_count === "number" && ev.meta.chain_count > 0) {
    chips.push({
      key: "chains",
      label: `${ev.meta.chain_count} chain${ev.meta.chain_count === 1 ? "" : "s"}`,
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: c.color ? `${c.color}10` : appleVibe.surface.chip,
            color: c.color ?? appleVibe.text.tertiary,
            border: c.color
              ? `1px solid ${c.color}26`
              : `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

type VisualForAction = {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  color: string;
};

function visualFor(action: NotebookEvent["action"]): VisualForAction {
  switch (action) {
    case "elect":
      return { icon: Check, label: "Elected", color: appleVibe.stage.outcomes };
    case "reject":
      return { icon: X, label: "Rejected", color: appleVibe.stage.pain };
    case "defer":
      return {
        icon: ChevronDown,
        label: "Deferred",
        color: appleVibe.text.tertiary,
      };
    case "clear":
      return {
        icon: RefreshCw,
        label: "Cleared",
        color: appleVibe.text.tertiary,
      };
    case "rd_iterate":
      return {
        icon: Sparkles,
        label: "Ran experiment",
        color: appleVibe.stage.features,
      };
    case "score":
      return {
        icon: RefreshCw,
        label: "Scored",
        color: appleVibe.stage.features,
      };
    case "approve_bet":
      return {
        icon: Check,
        label: "Approved bet",
        color: appleVibe.stage.outcomes,
      };
    case "compose":
      return {
        icon: Sparkles,
        label: "Composed design",
        color: appleVibe.accent.primary,
      };
    case "generate_batch":
      return {
        icon: Sparkles,
        label: "Generated batch",
        color: appleVibe.text.tertiary,
      };
    case "confirm":
      return {
        icon: Check,
        label: "Confirmed",
        color: appleVibe.text.tertiary,
      };
    case "autopilot_run":
      return {
        icon: Sparkles,
        label: "Autopilot started",
        color: appleVibe.stage.features,
      };
    case "autopilot_iteration":
      return {
        icon: Sparkles,
        label: "Autopilot iteration",
        color: appleVibe.stage.features,
      };
    // ── Phase 10a — system event visuals ──
    case "room_generated":
      return {
        icon: Layers,
        label: "Room generated",
        color: appleVibe.accent.primary,
      };
    case "item_expanded":
      return {
        icon: Sparkles,
        label: "Expanded item",
        color: appleVibe.stage.features,
      };
    case "expansion_spawned":
      return {
        icon: Plus,
        label: "Spawned deeper",
        color: appleVibe.stage.objective,
      };
    case "prototype_status_changed":
      return {
        icon: RefreshCw,
        label: "Prototype status",
        color: appleVibe.stage.features,
      };
    case "finding_acknowledged":
      return {
        icon: ChevronDown,
        label: "Acknowledged finding",
        color: appleVibe.text.tertiary,
      };
    case "finding_dismissed":
      return {
        icon: X,
        label: "Dismissed finding",
        color: appleVibe.text.tertiary,
      };
    case "finding_resolved":
      return {
        icon: Check,
        label: "Resolved finding",
        color: appleVibe.stage.outcomes,
      };
    case "theme_distilled":
      return {
        icon: ArrowRight,
        label: "Distilled into room",
        color: appleVibe.accent.primary,
      };
    case "concept_branched":
      return {
        icon: ArrowRight,
        label: "Branched from concept",
        color: appleVibe.accent.primary,
      };
    case "constraints_set":
      return {
        icon: RefreshCw,
        label: "Updated constraints",
        color: appleVibe.text.tertiary,
      };
    case "stage_transitioned":
      return {
        icon: ArrowRight,
        label: "Stage advanced",
        color: appleVibe.accent.primary,
      };
    default:
      return {
        icon: RefreshCw,
        label: "Event",
        color: appleVibe.text.tertiary,
      };
  }
}

function formatSubject(ev: NotebookEvent): string | null {
  const parts: string[] = [];
  if (ev.subject.variation_name && ev.subject.entity_name) {
    parts.push(
      `${ev.subject.variation_name} · in ${ev.subject.entity_name}`,
    );
  } else if (ev.subject.entity_name) {
    parts.push(ev.subject.entity_name);
  }
  if (ev.subject.chain_label) {
    parts.push(ev.subject.chain_label);
  }
  // Phase 10b — show room context when populated. The space-scoped
  // GET enriches this; the per-room GET leaves it null. Branchless
  // append keeps the format consistent across both panels.
  if (ev.subject.sub_objective_title) {
    parts.push(`Room: ${ev.subject.sub_objective_title}`);
  }
  return parts.length > 0 ? parts.join(" — ") : null;
}

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  // Older than 24h — show local time HH:MM.
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupByDay(
  events: NotebookEvent[],
): Array<{ label: string; events: NotebookEvent[] }> {
  const groups = new Map<string, NotebookEvent[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  for (const ev of events) {
    const d = new Date(ev.created_at);
    d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = "Today";
    else if (d.getTime() === yesterday.getTime()) label = "Yesterday";
    else
      label = new Date(ev.created_at).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    const arr = groups.get(label) ?? [];
    arr.push(ev);
    groups.set(label, arr);
  }
  return Array.from(groups.entries()).map(([label, evs]) => ({
    label,
    events: evs,
  }));
}
