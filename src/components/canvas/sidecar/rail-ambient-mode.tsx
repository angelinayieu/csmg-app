"use client";

// RailAmbientMode — content shown in the right rail when NO shape is
// selected. Replaces the old "click a card to see insights" empty
// state with a live KG snapshot, active strategy, locked insights,
// pairwise pending review queue, and a recent activity feed.
//
// Uses the rail primitives we shipped in /design/preflight so the
// production look matches the design QA harness exactly. No new
// material vocabulary; everything composes from primitives that
// have token-level QA passing.
//
// Data flow:
//   • State zone reads from useRailPulse (rail-pulse aggregator endpoint)
//   • Live activity feed reads from the canvas's existing SSE stream
//     via useRunEventStore — same channel the pipeline-event-painter
//     listens on, so we never poll for events we already have

import { useMemo } from "react";
import {
  ArrowUpRight,
  Pin,
  Search,
  X,
  Pause,
  Sparkles,
  Plug,
  GitBranch,
  Brain,
} from "lucide-react";
import {
  RailSection,
  RailDivider,
  StateCard,
  LiveCard,
  ActionChip,
  StreamingDot,
  CountBadge,
} from "@/components/canvas/rail/primitives";
import { useRailPulse } from "@/components/canvas/hooks/use-rail-pulse";
import { useRunEventStoreOptional } from "@/components/canvas/hooks/run-event-store";
import type { StreamedEvent } from "@/components/canvas/hooks/use-structural-event-stream";

interface Props {
  spaceId: string;
}

export function RailAmbientMode({ spaceId }: Props) {
  const pulse = useRailPulse(spaceId);
  // useRunEventStoreOptional returns null when no run is active —
  // ambient mode renders gracefully whether or not a run is in flight.
  const runStore = useRunEventStoreOptional();
  const events = runStore?.events ?? [];

  // Derive a 5-event activity preview from the live SSE stream. We
  // only surface persisted-artifact events (per the structural-events
  // memory rule) — entity_added / edge_added / cycle_detected /
  // bridge_formed / strategy_consensus_ready. Everything else is
  // thinking-trace noise and belongs in the audit drawer, not the rail.
  const activity = useMemo(() => buildActivityPreview(events), [events]);

  const data = pulse.data;
  const streamingStatus = pulse.error
    ? "error"
    : pulse.loading
      ? "running"
      : "running";

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {/* ── Header bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "rgba(85,100,121,0.85)" }}
        >
          Ambient
        </span>
        <span className="flex-1" />
        <StreamingDot
          status={streamingStatus as "running" | "paused" | "error"}
          label={pulse.loading ? "syncing" : "live"}
        />
      </div>

      {/* ── State zone ─────────────────────────────────────────── */}

      <RailSection title="KG snapshot">
        <StateCard
          title={
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {(data?.snapshot?.entity_count ?? 0).toLocaleString()} entities ·{" "}
              {(data?.snapshot?.edge_count ?? 0).toLocaleString()} edges ·{" "}
              {(data?.snapshot?.cycle_count ?? 0).toLocaleString()}{" "}
              {(data?.snapshot?.cycle_count ?? 0) === 1 ? "cycle" : "cycles"}
            </span>
          }
          subtitle={
            data?.snapshot?.last_paper_landed_at
              ? `Last paper · ${formatRelative(data.snapshot.last_paper_landed_at)}`
              : pulse.lastFetchedAt
                ? `Synced · ${formatRelative(pulse.lastFetchedAt)}`
                : pulse.loading
                  ? "Syncing…"
                  : "Idle"
          }
        />
      </RailSection>

      {data?.active_strategy && (
        <RailSection title="Active strategy">
          <StateCard
            eyebrow={`#${data.active_strategy.rank} · Active`}
            title={data.active_strategy.title}
            subtitle={
              data.active_strategy.confidence != null
                ? `${formatPosture(data.active_strategy.posture)} · ${data.active_strategy.confidence}%`
                : formatPosture(data.active_strategy.posture)
            }
            accent="#086ce8"
            interactive
            trailing={
              <ArrowUpRight
                style={{ width: 13, height: 13, color: "#556479" }}
              />
            }
          />
        </RailSection>
      )}

      {data &&
        (data.locked_insights.bottleneck ||
          data.locked_insights.leverage_top.length > 0 ||
          data.locked_insights.risk_top.length > 0) && (
          <RailSection title="Locked insights">
            {data.locked_insights.bottleneck && (
              <StateCard
                eyebrow="Bottleneck"
                title={data.locked_insights.bottleneck.summary || "Bottleneck"}
                subtitle={
                  data.locked_insights.bottleneck.blast_radius != null
                    ? `blast radius ${data.locked_insights.bottleneck.blast_radius.toFixed(2)}`
                    : undefined
                }
                accent="#b42318"
              />
            )}
            {data.locked_insights.leverage_top.slice(0, 2).map((lp) => (
              <StateCard
                key={lp.entity_id}
                eyebrow="Leverage"
                title={lp.title}
                subtitle={lp.summary?.slice(0, 80)}
                accent="#15803d"
              />
            ))}
            {data.locked_insights.risk_top.slice(0, 1).map((rp) => (
              <StateCard
                key={rp.entity_id}
                eyebrow="Risk"
                title={rp.title}
                subtitle={rp.summary?.slice(0, 80)}
                accent="#a16207"
              />
            ))}
          </RailSection>
        )}

      {/* No-synthesis guidance — quiet state, not anti-information */}
      {data && !data.has_synthesis && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(8,30,80,0.025)",
            border: "1px dashed rgba(15,23,42,0.06)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "rgba(85,100,121,0.85)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 4,
              color: "rgba(85,100,121,0.7)",
            }}
          >
            No synthesis yet
          </div>
          <span>
            Decompose a prompt or drop a paper to populate strategy + insights here.
          </span>
        </div>
      )}

      {/* ── Live divider + Live zone ────────────────────────────── */}
      <RailDivider label="live" />

      <div
        style={{
          background: "var(--rail-live-bg)",
          borderRadius: 12,
          padding: "8px 6px",
          margin: "-6px -6px 0",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {data && data.live.fresh_pairwise.length > 0 && (
          <RailSection
            title="Fresh"
            zone="live"
            count={data.live.pending_pairwise}
            trailing={
              <ActionChip variant="ghost" icon={Pause} compact>
                Pause
              </ActionChip>
            }
          >
            {data.live.fresh_pairwise.slice(0, 3).map((p, i) => (
              <LiveCard
                key={`${p.source_name}-${p.target_name}-${i}`}
                eyebrow={
                  p.confidence != null
                    ? `Pairwise · ${(p.confidence).toFixed(2)}`
                    : "Pairwise"
                }
                eyebrowAccent="#086ce8"
                title={`${p.source_name} ↔ ${p.target_name}`}
                subtitle={formatRelative(p.observed_at)}
                isFresh={i === 0}
                arrivedAt={Date.parse(p.observed_at)}
                actions={
                  <>
                    <ActionChip variant="primary" icon={Pin} compact>
                      Pin
                    </ActionChip>
                    <ActionChip variant="secondary" icon={Search} compact>
                      Audit
                    </ActionChip>
                    <ActionChip variant="ghost" icon={X} compact>
                      Dismiss
                    </ActionChip>
                  </>
                }
              />
            ))}
          </RailSection>
        )}

        {data && data.live.stale_pair_checks > 0 && (
          <RailSection title="Coverage" zone="live">
            <LiveCard
              eyebrow="Stale"
              eyebrowAccent="#556479"
              title={`${data.live.stale_pair_checks} pair check${data.live.stale_pair_checks === 1 ? "" : "s"} need revisit`}
              subtitle="topology shifted"
              isFresh={false}
              actions={
                <ActionChip variant="primary" compact>
                  Run prospect
                </ActionChip>
              }
            />
          </RailSection>
        )}

        {data && data.live.open_question_count > 0 && (
          <RailSection title="Open questions" zone="live">
            <LiveCard
              eyebrow="Synthesis"
              eyebrowAccent="#a16207"
              title={`${data.live.open_question_count} open question${data.live.open_question_count === 1 ? "" : "s"}`}
              subtitle="from synthesis_data.open_questions"
              isFresh={false}
              actions={
                <>
                  <ActionChip variant="primary" compact>
                    Probe top
                  </ActionChip>
                  <ActionChip variant="secondary" compact>
                    Review
                  </ActionChip>
                </>
              }
            />
          </RailSection>
        )}

        {/* Activity feed — last 5 persisted-artifact events from the
            canvas's existing SSE stream. We deliberately don't add a
            second polling channel; useRunEventStore already gets the
            ticks we need. */}
        {activity.length > 0 && (
          <RailSection title="Activity">
            {activity.map((a, i) => (
              <ActivityRow
                key={`${a.timestamp}-${i}`}
                time={formatActivityTime(a.timestamp)}
                text={a.label}
                Icon={a.Icon}
              />
            ))}
          </RailSection>
        )}

        {/* Quiet idle state when nothing is live yet */}
        {data &&
          data.live.fresh_pairwise.length === 0 &&
          data.live.stale_pair_checks === 0 &&
          data.live.open_question_count === 0 &&
          activity.length === 0 && (
            <div
              style={{
                padding: "16px 8px",
                textAlign: "center",
                fontSize: 10.5,
                color: "rgba(85,100,121,0.55)",
              }}
            >
              No live activity yet. The auto-indicator surfaces fresh items here as the graph grows.
            </div>
          )}
      </div>

      {pulse.error && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.18)",
            color: "#b42318",
            fontSize: 10.5,
          }}
        >
          rail-pulse · {pulse.error}
          <button
            onClick={() => pulse.refresh()}
            style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 700,
              color: "#086ce8",
              background: "transparent",
              border: 0,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

// ── Activity feed projection ─────────────────────────────────────

interface ActivityRow {
  timestamp: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

const ACTIVITY_ICON: Record<string, ActivityRow["Icon"]> = {
  entity_added: Sparkles,
  edge_added: Plug,
  cycle_detected: GitBranch,
  bridge_formed: Plug,
  strategy_consensus_ready: Sparkles,
  research_started: Brain,
  proposal_ready: Sparkles,
};

function buildActivityPreview(streamed: StreamedEvent[]): ActivityRow[] {
  // Last 5 persisted-artifact events from the SSE store. Drops
  // thinking-trace events (reasoning_chunk, etc.) per
  // feedback_structural_events_only memory rule.
  const persistedKinds = new Set(Object.keys(ACTIVITY_ICON));
  const filtered: StreamedEvent[] = [];
  for (let i = streamed.length - 1; i >= 0 && filtered.length < 5; i--) {
    const s = streamed[i];
    if (!s || !persistedKinds.has(s.event.type)) continue;
    filtered.push(s);
  }
  return filtered.map((s) => ({
    timestamp: s.emittedAt,
    label: labelForEvent(s.event),
    Icon: ACTIVITY_ICON[s.event.type] ?? Sparkles,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelForEvent(ev: any): string {
  switch (ev?.type) {
    case "entity_added":
      return `+ ${ev.name ?? "entity"}`;
    case "edge_added":
      return "+ edge";
    case "cycle_detected":
      return "Cycle detected";
    case "bridge_formed":
      return "Bridge formed";
    case "strategy_consensus_ready":
      return "Strategy locked";
    default:
      return String(ev?.type ?? "event").replace(/_/g, " ");
  }
}

function ActivityRow({
  time,
  text,
  Icon,
}: {
  time: string;
  text: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 4px",
        fontSize: 10.5,
      }}
    >
      <span
        style={{
          fontFamily: '"SF Mono", ui-monospace, monospace',
          color: "#556479",
          width: 30,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {time}
      </span>
      <Icon
        style={{
          width: 11,
          height: 11,
          strokeWidth: 1.5,
          color: "#556479",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: "#0a1020",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ── Format helpers ───────────────────────────────────────────────

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const ageMs = Date.now() - t;
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

function formatActivityTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "·";
  const ageMs = Date.now() - t;
  if (ageMs < 60_000) return "now";
  if (ageMs < 3_600_000) return `·${Math.round(ageMs / 60_000)}m`;
  if (ageMs < 86_400_000) return `·${Math.round(ageMs / 3_600_000)}h`;
  return `·${Math.round(ageMs / 86_400_000)}d`;
}

function formatPosture(p: string): string {
  if (!p) return "—";
  return p
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// CountBadge import-anchor — used elsewhere in the rail; keep so
// linter doesn't drop the type when the count display is moved
// out of RailSection.
void CountBadge;
