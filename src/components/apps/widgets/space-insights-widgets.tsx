"use client";

// ── Space-level insight widgets ──────────────────────────────────────
//
// Three widgets that render the "what's happening in this space right now"
// strip on the dashboard. All three read from the space's resolved data
// context — they're reusable in any dashboard manifest, not tied to a
// specific page.
//
//   - external_signal_banner   Intelligence radar signals (outside-world events)
//   - kg_top_insights          Synthesis quality + top leverage/risk summary
//   - contributors_strip       Agents + human collaborators on this space
//
// Each widget is tolerant of missing data — if the resolver returns an
// empty list, the widget either hides (banner) or shows a quiet empty state
// (insights, contributors). None of these should ever crash on bad input.

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";

const EASE = [0.22, 1, 0.36, 1] as const;

// ══════════════════════════════════════════════════════════════════════
// external_signal_banner
// ══════════════════════════════════════════════════════════════════════
//
// Surfaces high-severity, recently-detected signals from the intelligence
// radar. This is the "X company released a new database, yesterday" chip
// in the mockup — the user's interrupt layer for external-world changes.

interface ExternalSignalBannerConfig {
  /** Max signals shown at once. Rotates when more exist. Default 2. */
  max_visible?: number;
  /** Only show signals newer than this many hours. Default 72 (3 days). */
  fresh_hours?: number;
  /** Only show signals of these severities. Default ["high", "medium"]. */
  severities?: Array<"high" | "medium" | "low">;
}

interface SignalLite {
  id?: string | null;
  entity_name?: string | null;
  type?: string | null;
  severity?: "high" | "medium" | "low" | string | null;
  description?: string | null;
  detected_at?: string | null;
  status?: string | null;
  related_internal_entities?: string[] | null;
}

export function ExternalSignalBanner({
  instance,
  context,
}: WidgetComponentProps<ExternalSignalBannerConfig>) {
  const cfg = instance.config ?? {};
  const maxVisible = cfg.max_visible ?? 2;
  const freshHours = cfg.fresh_hours ?? 72;
  const severities = cfg.severities ?? ["high", "medium"];

  const res = context.resolve<SignalLite[]>(instance.bindings?.signals);
  const raw = Array.isArray(res.value) ? res.value : [];

  // Filter + rank: active/escalated, fresh, severity-matched, newest first.
  const ranked = useMemo(() => {
    const threshold = Date.now() - freshHours * 60 * 60 * 1000;
    const filtered = raw.filter((s) => {
      if (!s) return false;
      if (s.status && s.status !== "active" && s.status !== "escalated") return false;
      if (s.severity && !severities.includes(s.severity as "high" | "medium" | "low")) return false;
      if (s.detected_at) {
        const ts = new Date(s.detected_at).getTime();
        if (!Number.isNaN(ts) && ts < threshold) return false;
      }
      return Boolean(s.description || s.entity_name);
    });
    // Sort: high before medium before low, then newest first
    const sevRank = (s: string | null | undefined): number =>
      s === "high" ? 0 : s === "medium" ? 1 : 2;
    filtered.sort((a, b) => {
      const ra = sevRank(a.severity);
      const rb = sevRank(b.severity);
      if (ra !== rb) return ra - rb;
      const ta = a.detected_at ? new Date(a.detected_at).getTime() : 0;
      const tb = b.detected_at ? new Date(b.detected_at).getTime() : 0;
      return tb - ta;
    });
    return filtered.slice(0, maxVisible);
  }, [raw, freshHours, severities, maxVisible]);

  if (ranked.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {ranked.map((signal, idx) => (
        <SignalChip key={signal.id ?? `sig-${idx}`} signal={signal} idx={idx} />
      ))}
    </div>
  );
}

function SignalChip({ signal, idx }: { signal: SignalLite; idx: number }) {
  const palette = signalPalette(signal.severity);
  const agoLabel = signal.detected_at ? formatAgo(signal.detected_at) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE, delay: idx * 0.08 }}
      className="relative flex items-start gap-3 rounded-2xl border border-white/60 bg-gradient-to-r from-white/80 via-white/70 to-white/60 px-4 py-3 shadow-[0_4px_14px_rgba(15,23,42,0.06)]"
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      {/* Accent rail */}
      <span
        className="absolute left-0 top-0 h-full w-[3px] rounded-l-2xl"
        style={{ background: palette.accent }}
      />

      {/* Icon */}
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm"
        style={{ background: palette.iconBg }}
      >
        <SignalIcon type={signal.type} color={palette.iconColor} />
      </div>

      {/* Copy */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {signal.entity_name ? (
            <span className="text-[13px] font-semibold text-[color:var(--fg,#1d1d1f)]">
              {signal.entity_name}
            </span>
          ) : null}
          {signal.severity ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
              style={{ background: palette.chipBg, color: palette.chipFg }}
            >
              {signal.severity}
            </span>
          ) : null}
          {agoLabel ? (
            <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
              · {agoLabel}
            </span>
          ) : null}
        </div>
        {signal.description ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-[color:var(--muted-fg,#48484a)]">
            {signal.description}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}

function SignalIcon({
  type,
  color,
}: {
  type?: string | null;
  color: string;
}) {
  // Icon choice per signal type. Kept simple — strokes only, no fills.
  if (type === "data_release" || type === "database") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <ellipse cx="7" cy="3.5" rx="4.5" ry="1.8" stroke={color} strokeWidth="1.2" fill="none" />
        <path d="M2.5 3.5 V7 C2.5 8 4.5 9 7 9 C9.5 9 11.5 8 11.5 7 V3.5" stroke={color} strokeWidth="1.2" fill="none" />
        <path d="M2.5 7 V10.5 C2.5 11.5 4.5 12.5 7 12.5 C9.5 12.5 11.5 11.5 11.5 10.5 V7" stroke={color} strokeWidth="1.2" fill="none" />
      </svg>
    );
  }
  if (type === "competitor" || type === "market") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <path d="M2 11 L5 7 L8 9 L12 3" stroke={color} strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="3" r="1.2" fill={color} />
      </svg>
    );
  }
  // Default: bell-ish alert
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M7 2 C9 2 10 3.5 10 6 V8 L11 10 H3 L4 8 V6 C4 3.5 5 2 7 2 Z" stroke={color} strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <path d="M5.5 11 C5.5 11.8 6.2 12.5 7 12.5 C7.8 12.5 8.5 11.8 8.5 11" stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function signalPalette(severity: string | null | undefined): {
  accent: string;
  iconBg: string;
  iconColor: string;
  chipBg: string;
  chipFg: string;
} {
  if (severity === "high") {
    return {
      accent: "#FF453A",
      iconBg: "linear-gradient(135deg, #FF5E52, #D83A2E)",
      iconColor: "#fff",
      chipBg: "rgba(255,69,58,0.12)",
      chipFg: "#8a2a2a",
    };
  }
  if (severity === "medium") {
    return {
      accent: "#FF9F0A",
      iconBg: "linear-gradient(135deg, #FFAE2A, #D97A00)",
      iconColor: "#fff",
      chipBg: "rgba(255,159,10,0.12)",
      chipFg: "#8a4a00",
    };
  }
  return {
    accent: "rgb(var(--accent-rgb))",
    iconBg: "linear-gradient(135deg, rgba(var(--accent-rgb), 0.95), rgba(var(--accent-rgb), 0.75))",
    iconColor: "#fff",
    chipBg: "rgba(var(--accent-rgb), 0.1)",
    chipFg: "rgba(var(--accent-rgb), 1)",
  };
}

function formatAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const deltaMs = Date.now() - then;
  const mins = Math.round(deltaMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ══════════════════════════════════════════════════════════════════════
// kg_top_insights
// ══════════════════════════════════════════════════════════════════════
//
// Rolled-up synthesis summary card. Shows overall quality score, top N
// leverage points, top N risks, and the master bottleneck (if any). This
// is the "Knowledge Graph Top Insights — Quality 63/100" card from the
// mockup.

interface KGTopInsightsConfig {
  top_leverage?: number; // default 3
  top_risks?: number;    // default 2
}

interface TopInsightsSnapshot {
  quality_score?: number | null;
  quality_label?: string | null;
  total_entities?: number | null;
  leverage_points?: Array<{
    entity_name?: string | null;
    reason?: string | null;
    downstream_impact?: number | null;
  }>;
  risk_points?: Array<{
    entity_name?: string | null;
    reason?: string | null;
    blast_radius?: number | null;
  }>;
  master_bottleneck?: {
    entity_name?: string | null;
    explanation?: string | null;
  } | null;
  open_question_count?: number | null;
  feedback_loop_count?: number | null;
}

export function KGTopInsights({
  instance,
  context,
}: WidgetComponentProps<KGTopInsightsConfig>) {
  const cfg = instance.config ?? {};
  const topLev = cfg.top_leverage ?? 3;
  const topRisks = cfg.top_risks ?? 2;

  const res = context.resolve<TopInsightsSnapshot>(instance.bindings?.insights);
  const snap = res.value ?? null;

  if (!snap) {
    return (
      <Surface accent="#0ea5e9">
        <WidgetTitle eyebrow="Knowledge Graph" title="Top Insights" />
        <WidgetEmpty>
          Run synthesis to surface leverage points, risks, and quality score.
        </WidgetEmpty>
      </Surface>
    );
  }

  const qualityScore = snap.quality_score ?? null;
  const qualityLabel = snap.quality_label ?? gradeFromQuality(qualityScore);
  const lev = (snap.leverage_points ?? []).slice(0, topLev);
  const risks = (snap.risk_points ?? []).slice(0, topRisks);
  const bottleneck = snap.master_bottleneck;

  return (
    <Surface accent="#0ea5e9">
      <div className="flex items-start justify-between gap-3">
        <WidgetTitle
          eyebrow="Knowledge Graph"
          title="Top Insights"
          subtitle={
            qualityScore != null
              ? `Quality ${Math.round(qualityScore)}/100${qualityLabel ? ` · ${qualityLabel}` : ""}`
              : qualityLabel ?? undefined
          }
        />
        {qualityScore != null ? (
          <QualityPill score={qualityScore} />
        ) : null}
      </div>

      {/* Master bottleneck — loudest finding gets top billing */}
      {bottleneck?.entity_name ? (
        <div
          className="mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
          style={{
            background: "rgba(255,69,58,0.06)",
            borderColor: "rgba(255,69,58,0.20)",
          }}
        >
          <span
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(255,69,58,0.18)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#FF453A" }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a2a2a]">
              Master bottleneck
            </div>
            <div className="mt-0.5 truncate text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
              {bottleneck.entity_name}
            </div>
            {bottleneck.explanation ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-[color:var(--muted-fg,#48484a)]">
                {bottleneck.explanation}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Top leverage */}
      {lev.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#86868b)]">
            Top leverage
          </div>
          <ul className="space-y-1">
            {lev.map((lp, i) => (
              <InsightRow
                key={`lev-${i}`}
                accent="#0A84FF"
                name={lp.entity_name ?? "Leverage point"}
                detail={lp.reason ?? undefined}
                score={lp.downstream_impact ?? undefined}
                scoreLabel="downstream"
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Top risks */}
      {risks.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#86868b)]">
            Top risks
          </div>
          <ul className="space-y-1">
            {risks.map((rp, i) => (
              <InsightRow
                key={`risk-${i}`}
                accent="#FF453A"
                name={rp.entity_name ?? "Risk point"}
                detail={rp.reason ?? undefined}
                score={rp.blast_radius ?? undefined}
                scoreLabel="blast"
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Footer stats — quiet */}
      {(snap.open_question_count || snap.feedback_loop_count) ? (
        <div className="mt-3 flex items-center gap-4 border-t border-gray-200/60 pt-2.5 text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {snap.open_question_count != null ? (
            <span>
              <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                {snap.open_question_count}
              </span>{" "}
              open questions
            </span>
          ) : null}
          {snap.feedback_loop_count != null ? (
            <span>
              <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                {snap.feedback_loop_count}
              </span>{" "}
              loops
            </span>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
}

function InsightRow({
  accent,
  name,
  detail,
  score,
  scoreLabel,
}: {
  accent: string;
  name: string;
  detail?: string;
  score?: number;
  scoreLabel: string;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-0.5 text-[12px]">
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: accent, boxShadow: `0 0 4px ${accent}80` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-[color:var(--fg,#1d1d1f)]">
            {name}
          </span>
          {score != null ? (
            <span className="whitespace-nowrap text-[10px] text-[color:var(--muted-fg,#86868b)]">
              <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                {score}
              </span>{" "}
              {scoreLabel}
            </span>
          ) : null}
        </div>
        {detail ? (
          <p className="mt-0 line-clamp-1 text-[11px] text-[color:var(--muted-fg,#48484a)]">
            {detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function QualityPill({ score }: { score: number }) {
  const color =
    score >= 80 ? "#30D158" : score >= 60 ? "#0A84FF" : score >= 40 ? "#FF9F0A" : "#FF453A";
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="font-mono text-[11px] font-semibold tabular-nums">
        {Math.round(score)}
      </span>
    </div>
  );
}

function gradeFromQuality(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 80) return "strong";
  if (score >= 60) return "developing";
  if (score >= 40) return "fragile";
  return "critical";
}

// ══════════════════════════════════════════════════════════════════════
// contributors_strip
// ══════════════════════════════════════════════════════════════════════
//
// Avatar strip showing who's working on this space. Scoped down: agents
// (from the `agents` table) + the space owner (single user for now).
// Future: add space_collaborators when multi-user lands. The resolver
// contract is stable, so this widget upgrades automatically.

interface ContributorsStripConfig {
  /** Max avatars rendered inline. Rest shown as "+N" overflow chip. Default 5. */
  max_visible?: number;
  /** Show names next to avatars. Default true for spacious layouts. */
  show_names?: boolean;
}

export interface ContributorLite {
  id: string;
  name?: string | null;
  kind: "user" | "agent";
  /** Role or kind of contribution — e.g. "Owner", "Researcher", "Domain Expert". */
  role?: string | null;
  /** Optional avatar URL or letter to render. */
  avatar_url?: string | null;
  /** Last known activity timestamp. Used for hover tooltip. */
  last_active_at?: string | null;
  /** Optional: recent contribution summary for tooltip. */
  recent_contribution?: string | null;
  /** Status — lights the "live" dot. */
  status?: "idle" | "running" | "done" | "failed" | string | null;
}

export function ContributorsStrip({
  instance,
  context,
}: WidgetComponentProps<ContributorsStripConfig>) {
  const cfg = instance.config ?? {};
  const maxVisible = cfg.max_visible ?? 5;
  const showNames = cfg.show_names ?? false;

  const res = context.resolve<ContributorLite[]>(instance.bindings?.contributors);
  const all = Array.isArray(res.value) ? res.value : [];

  if (all.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted-fg,#86868b)]">
        <span>No active agents or collaborators yet.</span>
      </div>
    );
  }

  const visible = all.slice(0, maxVisible);
  const overflow = all.length - visible.length;

  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
        Working on it
      </span>
      <div className={showNames ? "flex items-center gap-2" : "flex items-center -space-x-2"}>
        {visible.map((c, i) => (
          <ContributorBadge
            key={c.id}
            contributor={c}
            idx={i}
            showName={showNames}
          />
        ))}
        {overflow > 0 ? (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-black/5 text-[10px] font-semibold text-[color:var(--muted-fg,#48484a)]"
            title={`${overflow} more`}
          >
            +{overflow}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContributorBadge({
  contributor,
  idx,
  showName,
}: {
  contributor: ContributorLite;
  idx: number;
  showName: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const initial = (contributor.name?.trim()?.charAt(0) ?? (contributor.kind === "agent" ? "A" : "?")).toUpperCase();
  const palette = contributorPalette(contributor.kind, initial);
  const isLive = contributor.status === "running";

  const tooltipId = `contributor-tip-${contributor.id}`;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: EASE, delay: idx * 0.04 }}
        className="flex items-center gap-2"
        aria-describedby={tooltipId}
      >
        <div
          className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-sm"
          style={{ background: palette }}
        >
          {contributor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contributor.avatar_url}
              alt={contributor.name ?? "Contributor"}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <span>{initial}</span>
          )}
          {/* Live indicator — agent currently running */}
          {isLive ? (
            <motion.span
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white"
              style={{ background: "#30D158" }}
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}
          {/* Agent vs human micro-indicator */}
          {!isLive && contributor.kind === "agent" ? (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white"
              style={{ background: "rgba(var(--accent-rgb), 0.9)" }}
              title="AI agent"
            />
          ) : null}
        </div>
        {showName && contributor.name ? (
          <div className="flex flex-col leading-tight">
            <span className="text-[11.5px] font-medium text-[color:var(--fg,#1d1d1f)]">
              {contributor.name}
            </span>
            {contributor.role ? (
              <span className="text-[10px] text-[color:var(--muted-fg,#86868b)]">
                {contributor.role}
              </span>
            ) : null}
          </div>
        ) : null}
      </motion.div>

      {/* Hover popover */}
      <AnimatePresence>
        {hovered ? (
          <motion.div
            key="tip"
            id={tooltipId}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="pointer-events-none absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-lg border border-white/60 bg-white/90 p-2.5 text-[11px] shadow-lg"
            style={{
              backdropFilter: "blur(18px) saturate(180%)",
              WebkitBackdropFilter: "blur(18px) saturate(180%)",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-[6px] w-[6px] rounded-full"
                style={{
                  background: isLive ? "#30D158" : "rgba(0,0,0,0.2)",
                  boxShadow: isLive ? "0 0 6px #30D158" : undefined,
                }}
              />
              <span className="font-semibold text-[color:var(--fg,#1d1d1f)]">
                {contributor.name ?? "Unknown"}
              </span>
              <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
                {contributor.kind}
              </span>
            </div>
            {contributor.role ? (
              <div className="mt-1 text-[color:var(--muted-fg,#48484a)]">
                {contributor.role}
              </div>
            ) : null}
            {contributor.recent_contribution ? (
              <div className="mt-1 line-clamp-2 text-[color:var(--muted-fg,#48484a)]">
                {contributor.recent_contribution}
              </div>
            ) : null}
            {contributor.last_active_at ? (
              <div className="mt-1 text-[color:var(--muted-fg,#86868b)]">
                Last active {formatAgo(contributor.last_active_at)}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function contributorPalette(kind: "user" | "agent", initial: string): string {
  if (kind === "agent") {
    return "linear-gradient(135deg, rgb(var(--accent-rgb)), rgba(var(--accent-rgb), 0.75))";
  }
  // Deterministic gradient per initial
  const gradients = [
    "linear-gradient(135deg, #4fa3ff, #0051ff)",
    "linear-gradient(135deg, #6a7cff, #3c44d9)",
    "linear-gradient(135deg, #5fbaff, #1a7aff)",
    "linear-gradient(135deg, #8b9dff, #5562e6)",
    "linear-gradient(135deg, #2d8cff, #003bc4)",
  ];
  const idx = initial.charCodeAt(0) % gradients.length;
  return gradients[idx];
}
