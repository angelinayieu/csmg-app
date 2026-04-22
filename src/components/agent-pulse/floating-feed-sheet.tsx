"use client";

/**
 * Wave D L3.6 — FloatingFeedSheet.
 *
 * Slide-in right-side sheet listing every recent agent finding with
 * triage actions (Review / Act / Dismiss). Opens from AgentPulseModule
 * or the AgentActivityBell.
 *
 * Design:
 *   - Backdrop blur + frosted panel (visionOS language)
 *   - Per-item status transitions optimistic; the row slides out when
 *     dismissed, morphs on review/act via layout animation
 *   - ESC closes. Outside click closes.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Circle, Archive, AlertTriangle, Sparkles, Bell } from "lucide-react";
import type { AgentFinding, AgentFindingStatus } from "@/types";
import { cn } from "@/lib/utils";

export interface FloatingFeedSheetProps {
  open: boolean;
  onClose: () => void;
  findings: AgentFinding[];
  userId: string;
  onMarkReviewed: (id: string, status: AgentFindingStatus) => void;
}

const SPRING = { type: "spring" as const, stiffness: 240, damping: 30 };

export function FloatingFeedSheet({
  open,
  onClose,
  findings,
  onMarkReviewed,
}: FloatingFeedSheetProps) {
  const [filter, setFilter] = useState<"all" | "unread" | "urgent">("unread");
  const [acting, setActing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shown = useMemo(() => {
    let list = findings;
    if (filter === "unread") list = list.filter((f) => f.status === "unread");
    if (filter === "urgent")
      list = list.filter(
        (f) => f.status === "unread" && f.severity === "urgent",
      );
    return list;
  }, [findings, filter]);

  const doAction = async (
    id: string,
    action: "review" | "act" | "dismiss",
  ) => {
    const statusMap: Record<typeof action, AgentFindingStatus> = {
      review: "reviewed",
      act: "acted_on",
      dismiss: "dismissed",
    };
    // Optimistic
    setActing((a) => ({ ...a, [id]: true }));
    onMarkReviewed(id, statusMap[action]);
    try {
      await fetch(`/api/agent-findings/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      /* realtime channel will eventually correct us */
    } finally {
      setActing((a) => ({ ...a, [id]: false }));
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            key="sheet"
            initial={{ x: "100%", opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={SPRING}
            className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/40 bg-white/85 shadow-2xl backdrop-blur-xl"
          >
            <header className="flex items-center justify-between border-b border-neutral-200/70 px-5 py-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">
                  Agent feed
                </div>
                <div className="text-sm font-semibold text-neutral-800">
                  {shown.length} {filter === "all" ? "total" : filter}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800"
                aria-label="Close feed"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex items-center gap-1 border-b border-neutral-200/70 px-5 py-2">
              {(["unread", "urgent", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium capitalize transition",
                    filter === f
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-600 hover:bg-neutral-100",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              <AnimatePresence mode="popLayout" initial={false}>
                {shown.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center py-16 text-center"
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                      <Bell className="h-5 w-5" />
                    </div>
                    <div className="text-sm font-medium text-neutral-700">
                      Nothing here
                    </div>
                    <div className="mt-1 max-w-[220px] text-xs text-neutral-500">
                      {filter === "urgent"
                        ? "No urgent findings right now. Agents will flag surprises and contradictions here."
                        : filter === "unread"
                          ? "All caught up."
                          : "Agents haven't produced any findings yet."}
                    </div>
                  </motion.div>
                ) : (
                  shown.map((f) => (
                    <motion.article
                      key={f.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 24, height: 0, marginBottom: 0 }}
                      transition={SPRING}
                      className="mb-2 rounded-xl border border-neutral-200/80 bg-white/70 p-3 shadow-sm backdrop-blur"
                    >
                      <div className="flex items-start gap-2.5">
                        <FindingIcon severity={f.severity} kind={f.finding_kind} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-neutral-800">
                              {f.summary}
                            </p>
                            <span className="flex-shrink-0 text-[10px] text-neutral-400">
                              {relTime(f.created_at)}
                            </span>
                          </div>
                          {f.rationale && (
                            <p className="mt-1 line-clamp-3 text-xs text-neutral-600">
                              {f.rationale}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-1.5">
                            <FindingAction
                              label="Review"
                              icon={Circle}
                              active={f.status === "reviewed"}
                              disabled={acting[f.id]}
                              onClick={() => doAction(f.id, "review")}
                            />
                            <FindingAction
                              label="Act"
                              icon={CheckCircle2}
                              tone="positive"
                              active={f.status === "acted_on"}
                              disabled={acting[f.id]}
                              onClick={() => doAction(f.id, "act")}
                            />
                            <FindingAction
                              label="Dismiss"
                              icon={Archive}
                              tone="muted"
                              disabled={acting[f.id]}
                              onClick={() => doAction(f.id, "dismiss")}
                            />
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  ))
                )}
              </AnimatePresence>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function FindingIcon({
  severity,
  kind,
}: {
  severity: AgentFinding["severity"];
  kind: AgentFinding["finding_kind"];
}) {
  if (severity === "urgent") {
    return (
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.25} />
      </div>
    );
  }
  if (severity === "notable" || kind === "contradiction_found") {
    return (
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
      <Bell className="h-3.5 w-3.5" strokeWidth={2} />
    </div>
  );
}

function FindingAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
  tone = "neutral",
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "neutral" | "positive" | "muted";
}) {
  const toneClasses = {
    neutral: "hover:bg-neutral-100 text-neutral-600",
    positive: "hover:bg-emerald-50 text-emerald-700",
    muted: "hover:bg-neutral-100 text-neutral-500",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-50",
        toneClasses,
        active && "bg-neutral-900/5",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
