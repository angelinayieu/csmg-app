// ── Synergy Discover — client composition ──
//
// Renders the match feed with kind/score filters, anonymous-until-
// matched cards, and a placeholder "Connect" button (Phase 4c wires
// the request flow). Empty states distinguish "no matchable
// components" from "no matches yet."

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Compass,
  Filter,
  Inbox,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { listMatches, type RedactedMatch } from "@/lib/synergy/match-client";
import { RequestConnectionModal } from "@/components/synergy/request-connection-modal";

interface Props {
  matchableCount: number;
  initialMatches: RedactedMatch[];
}

type MatchKindFilter = "all" | "complement" | "parallel";

export function SynergyDiscoverClient({
  matchableCount,
  initialMatches,
}: Props) {
  const [matches, setMatches] = useState<RedactedMatch[]>(initialMatches);
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<MatchKindFilter>("all");
  const [minScore, setMinScore] = useState(60);
  // Pair-keyed set: "{my_component_id}:{their_component_id}". Used to
  // show "Requested" state on cards optimistically after the modal
  // succeeds, without having to refetch matches.
  const [requestedPairs, setRequestedPairs] = useState<Set<string>>(new Set());
  const [pendingMatch, setPendingMatch] = useState<RedactedMatch | null>(null);

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const page = await listMatches({
        limit: 50,
        minScore,
        // map UI filter to API filter — "complement" maps to a_needs_b
        // OR b_needs_a, but the API takes one value. For "complement"
        // we request without a filter and post-filter client-side.
      });
      const filtered =
        kindFilter === "all"
          ? page.matches
          : page.matches.filter((m) => m.direction.kind === kindFilter);
      setMatches(filtered);
    } catch (e) {
      toast.error("Couldn't load matches", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  // ── Empty states ──

  if (matchableCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <Lock className="mx-auto mb-3 h-6 w-6 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">
          No matchable components yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          Publish a strategy first — your matchable components are what
          we use to find complementary collaborators.
        </p>
        <a
          href="/app/synergy"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          <Sparkles className="h-4 w-4" />
          Go to your brainstorms
        </a>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <Compass className="mx-auto mb-3 h-6 w-6 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          No matches yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          {matchableCount} matchable component
          {matchableCount === 1 ? "" : "s"} indexed. The matcher hasn&apos;t
          run for them yet, or the community pool is sparse for your
          domain. Try running it now — we&apos;ll notify you as the pool
          grows.
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Check for new matches
        </button>
      </div>
    );
  }

  // ── Match feed ──

  const pairKey = (m: RedactedMatch) => `${m.mine.id}:${m.theirs.id}`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-1">
            <FilterChip
              label="All"
              active={kindFilter === "all"}
              onClick={() => setKindFilter("all")}
            />
            <FilterChip
              label="Complement"
              icon={ArrowLeftRight}
              active={kindFilter === "complement"}
              onClick={() => setKindFilter("complement")}
            />
            <FilterChip
              label="Parallel"
              icon={ArrowDownToLine}
              active={kindFilter === "parallel"}
              onClick={() => setKindFilter("parallel")}
            />
          </div>
          <ScoreSlider value={minScore} onChange={setMinScore} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/synergy/requests"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400"
          >
            <Inbox className="h-3 w-3" /> Inbox
          </Link>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </button>
        </div>
      </div>

      <ul className="space-y-4">
        {matches.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            requested={requestedPairs.has(pairKey(m))}
            onRequest={() => setPendingMatch(m)}
          />
        ))}
      </ul>

      {pendingMatch && (
        <RequestConnectionModal
          match={pendingMatch}
          open={!!pendingMatch}
          onClose={() => setPendingMatch(null)}
          onSent={() => {
            setRequestedPairs((prev) => {
              const next = new Set(prev);
              next.add(pairKey(pendingMatch));
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "bg-blue-600 text-white shadow-sm"
          : "text-gray-700 hover:bg-gray-100",
      ].join(" ")}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

function ScoreSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1">
      <Filter className="h-3 w-3 text-gray-500" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
        min score
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-blue-600"
      />
      <span className="font-mono text-[10px] text-blue-600">{value}</span>
    </div>
  );
}

// ── Match card ──

const KIND_LABEL: Record<string, string> = {
  upstream: "upstream need",
  downstream: "downstream output",
  core_idea: "core idea",
  polished_product: "polished product",
};

function MatchCard({
  match,
  requested,
  onRequest,
}: {
  match: RedactedMatch;
  requested: boolean;
  onRequest: () => void;
}) {
  const isComplement = match.direction.kind === "complement";
  const mineNeedsTheirs = match.direction.mine_needs_theirs;
  const theirsNeedsMine = match.direction.theirs_needs_mine;
  const flowLabel = isComplement
    ? mineNeedsTheirs
      ? "They produce what you need"
      : theirsNeedsMine
        ? "You produce what they need"
        : "Complementary"
    : "Parallel — co-ideation potential";
  const highFit = match.scores.final >= 80;

  return (
    <li className="group rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider",
              isComplement
                ? "bg-blue-100 text-blue-700"
                : "bg-purple-100 text-purple-700",
            ].join(" ")}
          >
            {isComplement ? (
              <ArrowLeftRight className="h-3 w-3" />
            ) : (
              <ArrowDownToLine className="h-3 w-3" />
            )}
            {flowLabel}
          </span>
          {highFit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-100 to-cyan-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
              <Sparkles className="h-3 w-3" /> high fit
            </span>
          )}
        </div>
        <ScorePills scores={match.scores} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Side title="YOU" data={match.mine} role="mine" needs={!mineNeedsTheirs && theirsNeedsMine ? "produce" : mineNeedsTheirs ? "need" : null} />
        <FlowArrow direction={mineNeedsTheirs ? "right" : theirsNeedsMine ? "left" : "both"} />
        <Side
          title="ANONYMOUS"
          data={match.theirs}
          role="theirs"
          needs={mineNeedsTheirs ? "produce" : theirsNeedsMine ? "need" : null}
        />
      </div>

      {match.rationale && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-[12px] leading-relaxed text-gray-700">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-blue-700">
            why →
          </span>
          {match.rationale}
        </div>
      )}

      {match.theirs.objective_statement && (
        <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-gray-600">
          <Target className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
          <span>
            <span className="font-mono uppercase tracking-wider text-gray-500">
              their objective:
            </span>{" "}
            {match.theirs.objective_statement}
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {requested ? (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-[12px] font-semibold text-emerald-700">
            <Sparkles className="h-3 w-3" /> Request sent
          </span>
        ) : (
          <button
            onClick={onRequest}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
          >
            Request connection
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={() => toast.info("Skipping. Refresh later for new matches.")}
          className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-400"
        >
          Skip
        </button>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-gray-500">
          {formatRelative(match.computed_at)}
        </span>
      </div>
    </li>
  );
}

function Side({
  title,
  data,
  role,
  needs,
}: {
  title: string;
  data: {
    kind: string;
    subkind: string | null;
    label_public: string;
    description_public: string;
  };
  role: "mine" | "theirs";
  needs: "need" | "produce" | null;
}) {
  const tint =
    role === "mine"
      ? "border-blue-200 bg-blue-50/40"
      : "border-emerald-200 bg-emerald-50/40";
  return (
    <div className={`rounded-xl border ${tint} p-3`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-600">
          {title}
        </span>
        {needs && (
          <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
            {needs === "need" ? "needs" : "produces"}
          </span>
        )}
        <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
          {KIND_LABEL[data.kind] ?? data.kind}
        </span>
      </div>
      <div className="text-[13px] font-semibold text-gray-900">
        {data.label_public}
      </div>
      <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-gray-700">
        {data.description_public}
      </p>
    </div>
  );
}

function FlowArrow({ direction }: { direction: "left" | "right" | "both" }) {
  return (
    <div className="hidden items-center justify-center md:flex">
      <div className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-cyan-100">
        {direction === "right" ? (
          <ArrowRight className="h-4 w-4 text-blue-600" />
        ) : direction === "left" ? (
          <ArrowRight className="h-4 w-4 -scale-x-100 text-emerald-600" />
        ) : (
          <ArrowLeftRight className="h-4 w-4 text-purple-600" />
        )}
      </div>
    </div>
  );
}

function ScorePills({
  scores,
}: {
  scores: RedactedMatch["scores"];
}) {
  return (
    <div className="flex items-center gap-1">
      <Pill label="final" value={scores.final} tone="blue" big />
      <Pill label="comp" value={scores.complementarity} tone="emerald" />
      <Pill label="goal" value={scores.goal_alignment} tone="purple" />
    </div>
  );
}

function Pill({
  label,
  value,
  tone,
  big = false,
}: {
  label: string;
  value: number;
  tone: "blue" | "emerald" | "purple";
  big?: boolean;
}) {
  const toneClass = {
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    purple: "bg-purple-100 text-purple-700",
  }[tone];
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${toneClass} ${big ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className={big ? "text-[11px]" : ""}>{value}</span>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
