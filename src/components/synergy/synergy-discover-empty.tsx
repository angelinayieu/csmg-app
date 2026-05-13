// ── Synergy Discover — rich empty state (cold-start safety net) ──
//
// When the user has matchable components but the matcher returned
// zero rows, we DON'T just say "no matches." We give them:
//
//   1. Confidence: their N components are indexed
//   2. Context: how active the marketplace is right now
//        (X publishes in last 24h, Y active rooms this week)
//   3. Action: "Lower the bar" → re-fetch with include_exploratory=1
//      which drops the score floor server-side and surfaces parallel
//      ideation candidates the strict threshold filtered out
//   4. Future signal: "Notify me by email when a real match arrives"
//      → flips notify_on_match on the profile (server fans out the
//      actual email when the matcher next inserts a high-score row)
//
// The flow is: don't bounce the user. Show them the marketplace is
// alive, give them a knob, give them a follow-up. The empty state
// IS the cold-start strategy.

"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Compass,
  Flame,
  Lightbulb,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  getMarketplaceStats,
  type MarketplaceStats,
} from "@/lib/synergy/match-client";

interface Props {
  matchableCount: number;
  // True when the user has clicked "Notify me" — disables the button
  // to prevent double-toggle. Hydrated from the profile on mount.
  // Cold-start UX doesn't need to be fancy here — just acknowledge
  // the click stuck.
  initialNotifyOnMatch?: boolean;
  onTryExploratory: () => void;
  exploratoryLoading?: boolean;
}

export function SynergyDiscoverEmpty({
  matchableCount,
  initialNotifyOnMatch = false,
  onTryExploratory,
  exploratoryLoading = false,
}: Props) {
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [notifyOnMatch, setNotifyOnMatch] = useState(initialNotifyOnMatch);
  const [notifySaving, setNotifySaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    getMarketplaceStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        // Silent — stats are decorative; empty state still works
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleNotify = async () => {
    if (notifySaving) return;
    const next = !notifyOnMatch;
    setNotifySaving(true);
    try {
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notify_on_match: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      setNotifyOnMatch(next);
      toast.success(
        next
          ? "You'll get an email when a strong match lands"
          : "Notifications off",
      );
    } catch (e) {
      toast.error("Couldn't update", { description: (e as Error).message });
    } finally {
      setNotifySaving(false);
    }
  };

  const totalActivity = stats?.total_matchable_components ?? 0;
  const recent24h = stats?.recent_publishes_24h ?? 0;
  const activeRooms = stats?.active_rooms_7d ?? 0;
  const score = stats?.recent_activity_score ?? 0;
  const isHot = score >= 50;

  // Find the most-populated complementary kind for a "X components of
  // kind Y are out there — your component might fit one" framing.
  const distribution = stats?.kind_distribution ?? [];
  const topKind = distribution
    .filter((k) => k.kind !== "core_idea")
    .sort((a, b) => b.count - a.count)[0];

  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white/80 p-8 backdrop-blur"
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.7), 0 12px 32px -10px rgba(15, 23, 42, 0.08)",
      }}
    >
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gray-900">
          <Compass className="h-6 w-6 text-white" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[22px] font-semibold leading-snug text-gray-900">
            Your {matchableCount} component{matchableCount === 1 ? " is" : "s are"} indexed
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-gray-600">
            Scanning the cross-user pool for complementary fits. Strong
            matches surface here as the community grows.
          </p>
        </div>
      </div>

      {/* Marketplace activity strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ActivityStat
          loading={statsLoading}
          icon={Package}
          tone="from-blue-100 to-blue-100 text-blue-700"
          value={totalActivity}
          label="Matchable components"
        />
        <ActivityStat
          loading={statsLoading}
          icon={Sparkles}
          tone="from-emerald-100 to-blue-100 text-emerald-700"
          value={recent24h}
          label="Published past 24h"
        />
        <ActivityStat
          loading={statsLoading}
          icon={Compass}
          tone="from-purple-100 to-indigo-100 text-purple-700"
          value={activeRooms}
          label="Active rooms this week"
        />
        <ActivityStat
          loading={statsLoading}
          icon={Flame}
          tone={
            isHot
              ? "from-orange-100 to-rose-100 text-orange-700"
              : "from-gray-100 to-gray-200 text-gray-600"
          }
          value={`${score}`}
          label={isHot ? "🔥 Active" : "Activity index"}
        />
      </div>

      {/* Topical framing */}
      {topKind && topKind.count > 0 && (
        <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
          <div className="flex items-start gap-2">
            {topKind.kind === "upstream" ? (
              <ArrowUp className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            ) : topKind.kind === "downstream" ? (
              <ArrowDown className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
            )}
            <p className="text-[12px] leading-relaxed text-gray-700">
              <span className="font-semibold">
                {topKind.count} {topKindLabel(topKind.kind)}
              </span>{" "}
              {topKind.kind === "upstream"
                ? "are looking for downstream output. If you produce anything that fits, you'll show up in their feed."
                : topKind.kind === "downstream"
                  ? "are producing outputs. If your project needs any of them, you'll show up in their feed."
                  : "are published in the marketplace. Yours sits alongside them."}
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionCard
          icon={Lightbulb}
          tone="border-blue-200 from-blue-50 to-blue-50/40 ring-blue-100"
          title="Lower the bar"
          body="Surface exploratory matches below the 60-score floor — parallel ideators and weaker complements still worth a look."
          cta={exploratoryLoading ? "Loading…" : "Try exploratory matches"}
          ctaIcon={exploratoryLoading ? Loader2 : RefreshCw}
          ctaSpin={exploratoryLoading}
          onClick={onTryExploratory}
        />
        <ActionCard
          icon={Bell}
          tone={
            notifyOnMatch
              ? "border-emerald-200 from-emerald-50 to-blue-50/40 ring-emerald-100"
              : "border-purple-200 from-purple-50 to-indigo-50/40 ring-purple-100"
          }
          title={notifyOnMatch ? "We’ll email you" : "Get a ping later"}
          body={
            notifyOnMatch
              ? "When a strong match lands, we'll send an email so you don't have to keep checking back."
              : "Opt into a one-time email when the first strong match arrives. We won't spam you."
          }
          cta={
            notifySaving
              ? "Saving…"
              : notifyOnMatch
                ? "Turn off"
                : "Notify me by email"
          }
          ctaIcon={notifySaving ? Loader2 : Bell}
          ctaSpin={notifySaving}
          onClick={toggleNotify}
        />
      </div>

      <p className="mt-5 text-center text-[11px] text-gray-500">
        New matches will land in your inbox as the marketplace grows.
        Anonymous-until-accept holds throughout.
      </p>
    </div>
  );
}

function topKindLabel(kind: string): string {
  switch (kind) {
    case "upstream":
      return "upstream needs";
    case "downstream":
      return "downstream outputs";
    case "polished_product":
      return "polished products";
    case "core_idea":
      return "core ideas";
    default:
      return "components";
  }
}

function ActivityStat({
  loading,
  icon: Icon,
  tone,
  value,
  label,
}: {
  loading: boolean;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  value: number | string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 text-center">
      <div
        className={`mx-auto mb-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="font-display font-numerical text-[22px] font-semibold tabular-nums text-gray-900">
        {loading ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />
        ) : (
          value
        )}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  tone,
  title,
  body,
  cta,
  ctaIcon: CtaIcon,
  ctaSpin,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  body: string;
  cta: string;
  ctaIcon: React.ComponentType<{ className?: string }>;
  ctaSpin?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ring-1 ${tone}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80">
          <Icon className="h-4 w-4 text-gray-700" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-gray-900">{title}</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-700">
            {body}
          </p>
          <button
            onClick={onClick}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-gray-800 transition hover:border-blue-400 hover:text-gray-900"
          >
            <CtaIcon
              className={`h-3 w-3 ${ctaSpin ? "animate-spin" : ""}`}
            />
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}
