"use client";

/**
 * App Card Grid — the final column of the production sequence, visualized.
 *
 * Each card represents a generated, persistent App. The card surfaces its
 * "dominant factors" (top entities it consolidates), health, intervention
 * count, and a subtle status indicator. Hover reveals a popover with two
 * actions: open the app OR open its whiteboard.
 *
 * Visual: Apple Vision Pro frosted tiles with specular rim, subtle drift on
 * hover, and an accent halo that activates on hover.
 */

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useApps, type AppView } from "@/lib/hooks/use-apps";
import { SequenceToAppsBridge } from "./sequence-to-apps-bridge";

const EASE = [0.22, 1, 0.36, 1] as const;

export function AppCardGrid({ spaceId }: { spaceId: string }) {
  const { apps, loading, error, refresh } = useApps(spaceId);

  if (loading) return <AppGridSkeleton />;
  if (error) {
    return (
      <div className="glass-card rounded-[18px] px-6 py-5">
        <p className="text-[13px] text-[color:var(--muted-fg,#86868b)]">
          Couldn&apos;t load apps — {error}
        </p>
        <button
          onClick={() => void refresh()}
          className="mt-3 rounded-full bg-black/5 px-3 py-1 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] hover:bg-black/10"
        >
          Retry
        </button>
      </div>
    );
  }

  if (apps.length === 0) {
    return <EmptyState />;
  }

  // Bridge branches are drawn for up to `gridColumns` apps at xl breakpoint.
  // When there are more apps, rows beyond the first stack normally — we
  // only bridge the first row since that's what visually touches the
  // Production Sequence above.
  const xlColumns = 4;
  const firstRowCount = Math.min(apps.length, xlColumns);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: 0.16 }}
      className="relative"
      aria-label="Generated apps"
    >
      {/* Bent-corner connectors that converge from the Apps pill above to
          each card below — ties the production sequence to its deliverables. */}
      <SequenceToAppsBridge
        appCount={firstRowCount}
        gridColumns={xlColumns}
      />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Apps
          </span>
          <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
            · continuously updated from strategy, research, and your whiteboard
          </span>
        </div>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {apps.length} {apps.length === 1 ? "app" : "apps"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {apps.map((app, idx) => (
          <AppCard
            key={app.id}
            app={app}
            spaceId={spaceId}
            index={idx}
            onRefreshed={() => {
              void refresh();
            }}
          />
        ))}
      </div>
    </motion.section>
  );
}

// ── Single card ──────────────────────────────────────────────────────

function AppCard({
  app,
  spaceId,
  index,
  onRefreshed,
}: {
  app: AppView;
  spaceId: string;
  index: number;
  onRefreshed?: () => void;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const dominantNames = app.dominant_entity_codes ?? [];
  const tagline = app.config?.tagline ?? app.description ?? "";
  const intCount = app.intervention_count ?? 0;
  const intDone = app.interventions_completed ?? 0;
  const healthPct = app.health_score != null ? Math.round(app.health_score) : null;

  const appHref = `/app/space/${spaceId}/app/${app.id}`;
  const whiteboardHref = `/app/space/${spaceId}/app/${app.id}/whiteboard`;
  const isStale = app.stale_reason != null;

  const handleRefresh = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/apps/${app.id}/refresh`, { method: "POST" });
      if (res.ok && onRefreshed) onRefreshed();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: 0.18 + index * 0.04 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="group relative"
    >
      {/* Accent halo — brightens on hover. When stale, bias to amber. */}
      <motion.div
        aria-hidden
        animate={{ opacity: hovered ? 1 : isStale ? 0.6 : 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="pointer-events-none absolute -inset-0.5 rounded-[18px] opacity-0 blur-lg"
        style={{
          background: isStale
            ? "linear-gradient(135deg, rgba(255,159,10,0.35), rgba(255,159,10,0.1))"
            : "linear-gradient(135deg, rgba(var(--accent-rgb),0.35), rgba(var(--accent-rgb),0.1))",
        }}
      />

      {/* Stale ribbon — pulses subtly */}
      {isStale ? (
        <motion.div
          aria-hidden
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm"
          style={{
            background: "rgba(255,159,10,0.18)",
            color: "#8a4a00",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <motion.span
            className="h-[5px] w-[5px] rounded-full"
            style={{ background: "#ff9f0a", boxShadow: "0 0 6px #ff9f0a" }}
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          {describeStale(app.stale_reason)}
        </motion.div>
      ) : null}

      <motion.button
        onClick={() => router.push(appHref)}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.99 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="relative flex h-full w-full flex-col items-start rounded-[18px] bg-white/50 p-5 text-left ring-1 ring-white/60 shadow-[0_6px_20px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
        style={{
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
        }}
        aria-label={`Open app ${app.name}`}
      >
        {/* Status strip */}
        <div className="mb-3 flex w-full items-center justify-between">
          <StatusPill status={app.status} />
          {healthPct != null ? (
            <HealthRing pct={healthPct} />
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#86868b)]">
              {app.app_type}
            </span>
          )}
        </div>

        {/* Name + tagline */}
        <h3 className="line-clamp-2 text-[16px] font-semibold leading-[1.25] tracking-[-0.005em] text-[color:var(--fg,#1d1d1f)]">
          {app.name}
        </h3>
        {tagline ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-[1.45] text-[color:var(--muted-fg,#48484a)]">
            {tagline}
          </p>
        ) : null}

        {/* Dominant factors */}
        <div className="mt-4 w-full">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#86868b)]">
            Dominant factors
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dominantNames.slice(0, 4).map((code) => (
              <span
                key={code}
                className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[color:var(--fg,#1d1d1f)]"
              >
                {code}
              </span>
            ))}
            {dominantNames.length > 4 ? (
              <span className="rounded-md bg-black/5 px-1.5 py-0.5 text-[11px] text-[color:var(--muted-fg,#86868b)]">
                +{dominantNames.length - 4}
              </span>
            ) : null}
            {dominantNames.length === 0 ? (
              <span className="text-[11px] italic text-[color:var(--muted-fg,#86868b)]">
                None yet
              </span>
            ) : null}
          </div>
        </div>

        {/* Footer: interventions + app_type */}
        <div className="mt-4 flex w-full items-center justify-between border-t border-white/40 pt-3 text-[11px] text-[color:var(--muted-fg,#6b7280)]">
          <span>
            <span className="font-mono font-semibold tabular-nums text-[color:var(--fg,#1d1d1f)]">
              {intDone}/{intCount}
            </span>{" "}
            interventions
          </span>
          {app.serves_goal_title ? (
            <span
              className="max-w-[120px] truncate"
              title={app.serves_goal_title}
            >
              goal: {app.serves_goal_title}
            </span>
          ) : (
            <span>{app.app_type}</span>
          )}
        </div>
      </motion.button>

      {/* Hover popover */}
      <AnimatePresence>
        {hovered ? (
          <motion.div
            key="popover"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="absolute right-3 top-3 z-20 flex overflow-hidden rounded-full shadow-lg ring-1 ring-white/70"
            style={{
              background: "rgba(255,255,255,0.72)",
              backdropFilter: "blur(24px) saturate(200%)",
              WebkitBackdropFilter: "blur(24px) saturate(200%)",
            }}
          >
            <Link
              href={appHref}
              onClick={(e) => e.stopPropagation()}
              className="px-3 py-1.5 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] hover:bg-white/60"
            >
              Open app
            </Link>
            <div className="w-px bg-white/60" />
            <Link
              href={whiteboardHref}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] hover:bg-white/60"
            >
              <WhiteboardIcon />
              Canvas
            </Link>
            {isStale ? (
              <>
                <div className="w-px bg-white/60" />
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-[#8a4a00] hover:bg-white/60 disabled:opacity-60"
                  style={{ background: "rgba(255,159,10,0.08)" }}
                >
                  <motion.span
                    animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
                    transition={{ duration: 0.8, repeat: refreshing ? Infinity : 0, ease: "linear" }}
                    className="inline-flex"
                  >
                    <RefreshIcon />
                  </motion.span>
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function StatusPill({ status }: { status: AppView["status"] }) {
  const palette: Record<AppView["status"], { bg: string; fg: string; label: string }> = {
    proposed: { bg: "rgba(0,0,0,0.05)", fg: "#48484a", label: "Proposed" },
    approved: { bg: "rgba(0,122,255,0.1)", fg: "#007AFF", label: "Approved" },
    active: { bg: "rgba(48,209,88,0.12)", fg: "#1d7a3a", label: "Active" },
    paused: { bg: "rgba(255,149,0,0.12)", fg: "#8a4a00", label: "Paused" },
    retired: { bg: "rgba(0,0,0,0.05)", fg: "#86868b", label: "Retired" },
  };
  const p = palette[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: p.bg, color: p.fg }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: p.fg, boxShadow: `0 0 4px ${p.fg}` }}
      />
      {p.label}
    </span>
  );
}

function HealthRing({ pct }: { pct: number }) {
  const radius = 8;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="relative h-[22px] w-[22px]" aria-label={`Health ${pct}%`}>
      <svg viewBox="0 0 22 22" className="h-full w-full -rotate-90">
        <circle cx="11" cy="11" r={radius} stroke="rgba(0,0,0,0.08)" strokeWidth="2" fill="none" />
        <motion.circle
          cx="11"
          cy="11"
          r={radius}
          stroke="rgb(var(--accent-rgb))"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: EASE }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold tabular-nums text-[color:var(--fg,#1d1d1f)]">
        {pct}
      </span>
    </div>
  );
}

function WhiteboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="1.5" y="2" width="9" height="7" rx="1.2" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M3 4.5 L5 6 L7 4 L9 6.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M10 4.5 A4 4 0 1 0 10.5 7.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M10.5 2.5 L10.5 4.8 L8 4.8"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function describeStale(reason: AppView["stale_reason"]): string {
  switch (reason) {
    case "kg_changed":
      return "KG changed";
    case "new_research":
      return "New research";
    case "user_feedback":
      return "Your feedback";
    case "strategy_regen":
      return "Strategy regen";
    case "whiteboard_edit":
      return "Whiteboard edit";
    default:
      return "Stale";
  }
}

// ── Skeleton + Empty states ──────────────────────────────────────────

function AppGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: i * 0.05 }}
          className="h-[200px] rounded-[18px] bg-white/30 ring-1 ring-white/40"
          style={{
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div className="animate-pulse p-5">
            <div className="h-3 w-16 rounded bg-black/5" />
            <div className="mt-3 h-4 w-2/3 rounded bg-black/5" />
            <div className="mt-2 h-3 w-full rounded bg-black/5" />
            <div className="mt-6 flex gap-1.5">
              <div className="h-5 w-8 rounded bg-black/5" />
              <div className="h-5 w-8 rounded bg-black/5" />
              <div className="h-5 w-8 rounded bg-black/5" />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="glass-card flex flex-col items-center justify-center rounded-[18px] px-8 py-12 text-center"
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/50 ring-1 ring-white/60">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="2.5" y="3" width="13" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M5 6 L8 9 L11 5.5 L14 9" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-[color:var(--fg,#1d1d1f)]">
        No apps yet
      </h3>
      <p className="mt-1 max-w-md text-[13px] leading-[1.5] text-[color:var(--muted-fg,#6b7280)]">
        Apps are generated from your strategy. Once the pipeline runs and
        strategy-refresh completes, your apps will appear here — each with its
        own whiteboard and intervention cluster.
      </p>
    </motion.div>
  );
}
