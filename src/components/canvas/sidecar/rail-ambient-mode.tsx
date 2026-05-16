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
              <InsightCard
                eyebrow="Bottleneck"
                entityName={data.locked_insights.bottleneck.entity_name}
                summary={data.locked_insights.bottleneck.summary}
                extraLine={
                  data.locked_insights.bottleneck.unlock_summary
                    ? `Unblocks: ${data.locked_insights.bottleneck.unlock_summary}`
                    : data.locked_insights.bottleneck.scope_label ?? undefined
                }
                accent="#b42318"
              />
            )}
            {data.locked_insights.leverage_top.slice(0, 2).map((lp) => (
              <InsightCard
                key={lp.entity_id}
                eyebrow="Leverage"
                entityName={lp.entity_name}
                summary={lp.summary}
                accent="#15803d"
              />
            ))}
            {data.locked_insights.risk_top.slice(0, 1).map((rp) => (
              <InsightCard
                key={rp.entity_id}
                eyebrow="Risk"
                entityName={rp.entity_name}
                summary={rp.summary}
                accent="#a16207"
              />
            ))}
          </RailSection>
        )}

      {/* Synthesis-in-progress — KG has nodes but synthesis hasn't
          landed yet. Replaces the silent "blank rail" window between
          decompose finishing and synthesize writing back. */}
      {data && data.synthesis_in_progress && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(6,108,232,0.05)",
            border: "1px solid rgba(6,108,232,0.18)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "rgba(85,100,121,0.95)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 4,
              color: "#086ce8",
            }}
          >
            <StreamingDot status="running" />
            <span>Synthesizing</span>
          </div>
          <span>
            Strategy and insights land here once synthesis finishes — typically ~55s after decompose.
          </span>
        </div>
      )}

      {/* No-synthesis guidance — quiet state, not anti-information. Only
          shown when there's no KG at all (truly empty workspace). */}
      {data && !data.has_synthesis && !data.synthesis_in_progress && (
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

// ── Insight card ─────────────────────────────────────────────────

interface InsightCardProps {
  eyebrow: string;
  entityName: string | null;
  summary: string;
  extraLine?: string;
  accent: string;
}

// One-card abstraction for bottleneck / leverage / risk rows. Picks
// the right title source (entity name preferred, summary's first
// sentence as a last resort) so we never render the eyebrow word
// duplicated as the title or the same string in both slots.
function InsightCard({
  eyebrow,
  entityName,
  summary,
  extraLine,
  accent,
}: InsightCardProps) {
  const cleanSummary = (summary ?? "").trim();
  const hasName = entityName != null && entityName.length > 0;

  // Title: hydrated entity name when present, otherwise the first
  // sentence of the summary (so we still surface SOMETHING readable
  // when synthesis omits the name). Subtitle differs: when we use
  // the summary as title, subtitle becomes the rest of the summary.
  let title: string;
  let subtitle: string | undefined;
  if (hasName) {
    title = entityName;
    subtitle = truncateAtWord(cleanSummary, 110) || undefined;
  } else if (cleanSummary.length > 0) {
    const split = splitFirstSentence(cleanSummary);
    title = split.first;
    subtitle = split.rest
      ? truncateAtWord(split.rest, 110)
      : undefined;
  } else {
    // Nothing usable — render only the eyebrow with a tiny "(awaiting
    // synthesis)" stub so the user knows the slot exists.
    title = "—";
    subtitle = "awaiting synthesis";
  }

  return (
    <StateCard
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      accent={accent}
    >
      {extraLine && (
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            color: "#556479",
            lineHeight: 1.4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {extraLine}
        </div>
      )}
    </StateCard>
  );
}

// Truncate at a word boundary, append "…". Never returns a string
// with a half-broken word like "productivi".
function truncateAtWord(text: string, maxLen: number): string {
  const t = (text ?? "").trim();
  if (t.length <= maxLen) return t;
  const slice = t.slice(0, maxLen);
  // Prefer a sentence-end inside the window when one exists; this
  // produces nicer-looking subtitles than always cutting at a space.
  const lastSentence = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (lastSentence > maxLen * 0.55) {
    return slice.slice(0, lastSentence + 1);
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.55) {
    return slice.slice(0, lastSpace).trimEnd() + "…";
  }
  return slice.trimEnd() + "…";
}

// Split "Foo. Bar baz." → { first: "Foo.", rest: "Bar baz." }. When
// there's no sentence boundary, returns the whole string as `first`.
function splitFirstSentence(text: string): { first: string; rest: string } {
  const t = text.trim();
  const m = t.match(/^(.+?[.!?])\s+([\s\S]+)$/);
  if (m) return { first: m[1].trim(), rest: m[2].trim() };
  return { first: t, rest: "" };
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
  //
  // We do a single forward pass to build a name lookup from prior
  // entity_added events so edge_added / cycle_detected rows can show
  // the named endpoints ("linked X ↔ Y") instead of an opaque "+ edge".
  const persistedKinds = new Set(Object.keys(ACTIVITY_ICON));
  const nameByEntityId = new Map<string, string>();
  for (const s of streamed) {
    if (s?.event.type === "entity_added") {
      const ev = s.event as { entityId?: string; name?: string };
      if (ev.entityId && typeof ev.name === "string" && ev.name.trim()) {
        nameByEntityId.set(ev.entityId, ev.name.trim());
      }
    }
  }

  const filtered: StreamedEvent[] = [];
  for (let i = streamed.length - 1; i >= 0 && filtered.length < 5; i--) {
    const s = streamed[i];
    if (!s || !persistedKinds.has(s.event.type)) continue;
    filtered.push(s);
  }
  return filtered.map((s) => ({
    timestamp: s.emittedAt,
    label: labelForEvent(s.event, nameByEntityId),
    Icon: ACTIVITY_ICON[s.event.type] ?? Sparkles,
  }));
}

function labelForEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ev: any,
  nameByEntityId: Map<string, string>,
): string {
  const nameOf = (id: string | undefined): string => {
    if (!id) return "entity";
    return nameByEntityId.get(id) ?? shortenId(id);
  };
  switch (ev?.type) {
    case "entity_added":
      return `+ ${ev.name ?? "entity"}`;
    case "edge_added": {
      const src = nameOf(ev.sourceEntityId);
      const tgt = nameOf(ev.targetEntityId);
      const conf =
        typeof ev.confidence === "number" && Number.isFinite(ev.confidence)
          ? ` · ${Math.round(ev.confidence * 100)}%`
          : "";
      return `linked ${src} ↔ ${tgt}${conf}`;
    }
    case "cycle_detected": {
      const ids = Array.isArray(ev.entityIds) ? ev.entityIds : [];
      if (ids.length >= 2) {
        const names = ids.slice(0, 3).map((id: string) => nameOf(id));
        const tail = ids.length > 3 ? " → …" : "";
        return `cycle: ${names.join(" → ")}${tail}`;
      }
      return "cycle detected";
    }
    case "bridge_formed": {
      const src = nameOf(ev.sourceEntityId);
      const tgt = nameOf(ev.targetEntityId);
      return `bridge ${src} ⇄ ${tgt}`;
    }
    case "strategy_consensus_ready":
      return "strategy locked";
    case "research_started":
      return "research started";
    case "proposal_ready":
      return typeof ev.title === "string" && ev.title.length > 0
        ? `proposal: ${ev.title}`
        : "proposal ready";
    default:
      return String(ev?.type ?? "event").replace(/_/g, " ");
  }
}

// UUIDs are useless in the rail — when we don't have a name cached,
// show a short stub instead so the row stays scannable.
function shortenId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 4) + "…" + id.slice(-3);
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
