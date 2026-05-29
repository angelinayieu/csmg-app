"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { StageCard, type StageStatus } from "./stage-card";

type StageId = "setup" | "kg" | "refine" | "evidence" | "proposal" | "twin";

interface StageView {
  id: StageId;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  detailLines: string[];
}

interface TwinProposalLite {
  id: string;
  justification: {
    chosen_approach?: string;
    confidence?: number;
    key_tradeoffs?: Array<{ tradeoff: string; chosen_side: string; why: string }>;
    alternatives_rejected?: Array<{
      name: string;
      description: string;
      why_rejected: string;
    }>;
    mechanism_ids?: string[];
    generated_at?: string;
  };
  user_status: string;
  generated_at: string;
}

interface StatusResponse {
  runStatus: "running" | "completed" | "failed";
  spaceId: string;
  startedAt: string;
  lastEventAt?: string;
  errorMessage: string | null;
  strategyGenerated?: boolean;
  stages: StageView[];
  twinProposal: TwinProposalLite | null;
}

// If the run is "running" but no event has landed in this long, the
// orchestrator is almost certainly dead (function killed / process
// crashed). The orchestrator pings a heartbeat every 30s, so 2.5 min of
// silence = ~5 missed heartbeats — safely past jitter.
const STALE_MS = 150_000;

const STAGE_META: Record<StageId, { title: string; subtitle: string }> = {
  setup: {
    title: "Setup",
    subtitle: "Space + run created, papers attached",
  },
  kg: {
    title: "Knowledge graph",
    subtitle: "Decompose prompt + papers into entities / edges / cycles",
  },
  refine: {
    title: "Refine graph",
    subtitle: "Critique + augment — close gaps, densify edges (standard & deep)",
  },
  evidence: {
    title: "Evidence grounding",
    subtitle:
      "Extract effect sizes from papers → pool into edge strengths (standard & deep)",
  },
  proposal: {
    title: "Synthesis",
    subtitle: "Compute landscape coverage, leverage points, claims",
  },
  twin: {
    title: "Strategy + twin proposal",
    subtitle: "Generate ranked strategies and materialize twin_proposals row",
  },
};

const EMPTY_STAGES: StageView[] = (
  ["setup", "kg", "refine", "evidence", "proposal", "twin"] as StageId[]
).map((id) => ({
  id,
  status: "queued",
  startedAt: null,
  finishedAt: null,
  summary: null,
  detailLines: [],
}));

// Poll cadence for the status endpoint (ms). Polling instead of SSE —
// resilient to remounts; each request rebuilds full state server-side.
const POLL_MS = 2000;

export function StrategyLabLiveView({
  runId,
  spaceId,
  initialStatus,
  initialPrompt,
  startedAt,
}: {
  runId: string;
  spaceId: string;
  initialStatus: "running" | "completed" | "failed";
  initialPrompt: string;
  startedAt: string;
}) {
  const [stages, setStages] = useState<StageView[]>(EMPTY_STAGES);
  const [runStatus, setRunStatus] = useState<
    "running" | "completed" | "failed"
  >(initialStatus);
  const [twinProposal, setTwinProposal] = useState<TwinProposalLite | null>(
    null,
  );
  const [pollError, setPollError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  // `now` is null on the server + first paint → no hydration mismatch;
  // starts ticking after mount so running-stage durations advance live.
  const [now, setNow] = useState<number | null>(null);
  const stopped = useRef(false);

  // ── Single poll ──
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/strategy-lab/status?runId=${runId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setPollError(`status ${res.status}`);
        return;
      }
      const data = (await res.json()) as StatusResponse;
      setPollError(null);
      setStages(data.stages);
      setRunStatus(data.runStatus);
      if (data.lastEventAt) setLastEventAt(data.lastEventAt);
      if (data.twinProposal) setTwinProposal(data.twinProposal);
      if (data.runStatus !== "running") stopped.current = true;
    } catch (err) {
      setPollError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  // ── Poll loop ──
  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await poll();
      if (cancelled || stopped.current) return;
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  // ── Ticking clock for running-stage durations ──
  useEffect(() => {
    setNow(Date.now());
    if (runStatus !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runStatus]);

  const elapsed = (() => {
    const start = Date.parse(startedAt);
    if (!Number.isFinite(start)) return null;
    const finishedTs = stages
      .map((s) => (s.finishedAt ? Date.parse(s.finishedAt) : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const end = runStatus === "running" ? now : finishedTs || now;
    if (end == null) return null;
    return Math.max(0, Math.round((end - start) / 1000));
  })();

  // Stalled = running, but the orchestrator's heartbeat has gone silent.
  const isStalled =
    runStatus === "running" &&
    now != null &&
    lastEventAt != null &&
    now - Date.parse(lastEventAt) > STALE_MS;

  return (
    <div
      className="min-h-screen w-full px-4 py-12"
      style={{
        background:
          "radial-gradient(at 20% 0%, rgba(124,58,237,0.05), transparent 50%), radial-gradient(at 80% 100%, rgba(37,99,235,0.04), transparent 50%), #FAFBFC",
      }}
    >
      <div className="w-full max-w-3xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/app/strategy-lab"
              className="text-[12px]"
              style={{ color: "rgba(15,23,42,0.5)" }}
            >
              ← New strategy
            </Link>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background:
                    runStatus === "completed"
                      ? "#16A34A"
                      : runStatus === "failed"
                        ? "#DC2626"
                        : "#D97706",
                }}
              />
              <span
                className="text-[10.5px] font-semibold uppercase tracking-wide"
                style={{
                  color:
                    runStatus === "completed"
                      ? "#16A34A"
                      : runStatus === "failed"
                        ? "#DC2626"
                        : "#D97706",
                  letterSpacing: "0.05em",
                }}
              >
                {runStatus}
              </span>
              {elapsed != null && (
                <span
                  className="text-[10.5px]"
                  style={{ color: "rgba(15,23,42,0.4)" }}
                >
                  · {elapsed}s
                </span>
              )}
            </div>
          </div>
          <h1
            className="text-[20px] font-semibold tracking-tight leading-snug"
            style={{ color: "#0F172A", letterSpacing: "-0.015em" }}
          >
            {initialPrompt || "Strategy Lab run"}
          </h1>
        </header>

        {isStalled && (
          <div
            className="mb-4 px-5 py-4 rounded-2xl"
            style={{
              background:
                "linear-gradient(180deg, rgba(217,119,6,0.08) 0%, white 40%)",
              border: "1px solid rgba(217,119,6,0.28)",
            }}
          >
            <h3
              className="text-[14px] font-semibold tracking-tight mb-1"
              style={{ color: "#92400E" }}
            >
              This run appears to have stalled
            </h3>
            <p className="text-[12.5px]" style={{ color: "rgba(15,23,42,0.7)" }}>
              No progress for over {Math.round(STALE_MS / 60000)} minutes — the
              server may have timed out mid-stage. The work so far is saved; you
              can start a fresh run (papers stay uploaded).
            </p>
            <div className="mt-3">
              <Link
                href="/app/strategy-lab"
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium inline-block"
                style={{ background: "rgba(15,23,42,0.92)", color: "white" }}
              >
                Start a new run
              </Link>
            </div>
          </div>
        )}

        {pollError && runStatus === "running" && !isStalled && (
          <div
            className="mb-4 px-4 py-2.5 rounded-lg text-[12px]"
            style={{
              background: "rgba(217,119,6,0.06)",
              border: "1px solid rgba(217,119,6,0.15)",
              color: "rgba(146,64,14,0.95)",
            }}
          >
            Reconnecting… ({pollError})
          </div>
        )}

        {/* Stage cards */}
        <div className="space-y-3">
          {stages.map((stage, i) => {
            const meta = STAGE_META[stage.id];
            const startTs = stage.startedAt ? Date.parse(stage.startedAt) : null;
            const endTs = stage.finishedAt ? Date.parse(stage.finishedAt) : null;
            const duration =
              startTs && endTs
                ? Math.max(0, Math.round((endTs - startTs) / 1000))
                : stage.status === "running" && startTs && now != null
                  ? Math.max(0, Math.round((now - startTs) / 1000))
                  : null;
            return (
              <StageCard
                key={stage.id}
                index={i + 1}
                title={meta.title}
                subtitle={meta.subtitle}
                status={stage.status}
                durationSeconds={duration}
                summary={
                  stage.summary && stage.status !== "running"
                    ? stage.summary
                    : undefined
                }
                details={
                  stage.detailLines.length > 0 ? (
                    <pre
                      className="whitespace-pre-wrap font-mono text-[11.5px]"
                      style={{ color: "rgba(15,23,42,0.65)" }}
                    >
                      {stage.detailLines.join("\n")}
                    </pre>
                  ) : undefined
                }
              />
            );
          })}
        </div>

        {/* Terminal twin proposal card */}
        {twinProposal && (
          <TwinProposalTerminalCard proposal={twinProposal} spaceId={spaceId} />
        )}

        {/* Failure summary */}
        {runStatus === "failed" && !twinProposal && (() => {
          const failed = stages.find((s) => s.status === "failed");
          const failMsg = failed?.summary ?? "";
          // Recognize LLM provider quota/billing failures across all the
          // text we have for the failed stage (the summary + the detail
          // log lines, which carry the response body the orchestrator
          // captured).
          const haystack = `${failMsg} ${(failed?.detailLines ?? []).join(" ")}`;
          const isQuota =
            /quota|insufficient_quota|billing|add credits|rate.?limit|429/i.test(
              haystack,
            );

          if (isQuota) {
            return (
              <div
                className="mt-5 px-5 py-4 rounded-2xl"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(217,119,6,0.08) 0%, white 40%)",
                  border: "1px solid rgba(217,119,6,0.28)",
                  boxShadow: "0 1px 2px rgba(11,18,40,0.04)",
                }}
              >
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide mb-2"
                  style={{
                    background: "rgba(217,119,6,0.12)",
                    color: "rgba(146,64,14,0.95)",
                    letterSpacing: "0.05em",
                  }}
                >
                  Provider quota
                </div>
                <h3
                  className="text-[15px] font-semibold tracking-tight mb-1"
                  style={{ color: "#92400E" }}
                >
                  LLM API quota exhausted
                </h3>
                <p
                  className="text-[12.5px] leading-relaxed"
                  style={{ color: "rgba(15,23,42,0.7)" }}
                >
                  The <strong>{failed?.id === "proposal" ? "Synthesis" : failed?.id === "twin" ? "Strategy" : "pipeline"}</strong> stage
                  couldn&rsquo;t complete because an AI provider returned a
                  quota / billing limit. This pipeline calls both Anthropic
                  and OpenAI — the synthesis step uses OpenAI, so check that
                  account&rsquo;s credits first. Everything else in the run
                  succeeded; once credits are restored, re-run and it will
                  proceed to a strategy.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href="https://platform.openai.com/account/billing"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                    style={{ background: "rgba(217,119,6,0.95)", color: "white" }}
                  >
                    Add OpenAI credits ↗
                  </a>
                  <a
                    href="https://console.anthropic.com/settings/billing"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                    style={{
                      background: "white",
                      color: "rgba(15,23,42,0.7)",
                      border: "1px solid rgba(15,23,42,0.12)",
                    }}
                  >
                    Anthropic billing ↗
                  </a>
                  <Link
                    href="/app/strategy-lab"
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                    style={{
                      background: "rgba(15,23,42,0.92)",
                      color: "white",
                    }}
                  >
                    Try again
                  </Link>
                </div>
                {failMsg && (
                  <p
                    className="mt-3 text-[11px] font-mono"
                    style={{ color: "rgba(15,23,42,0.4)" }}
                  >
                    {failMsg}
                  </p>
                )}
              </div>
            );
          }

          return (
            <div
              className="mt-5 px-5 py-4 rounded-2xl"
              style={{
                background: "white",
                border: "1px solid rgba(220,38,38,0.2)",
                boxShadow: "0 1px 2px rgba(11,18,40,0.04)",
              }}
            >
              <h3
                className="text-[14px] font-semibold tracking-tight mb-1"
                style={{ color: "#DC2626" }}
              >
                Run failed
              </h3>
              <p
                className="text-[12.5px]"
                style={{ color: "rgba(15,23,42,0.65)" }}
              >
                {failMsg ||
                  "Chain did not reach a strategy. Expand the failed stage's details for the underlying error."}
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  href="/app/strategy-lab"
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                  style={{ background: "rgba(15,23,42,0.92)", color: "white" }}
                >
                  Try again
                </Link>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function TwinProposalTerminalCard({
  proposal,
  spaceId,
}: {
  proposal: TwinProposalLite;
  spaceId: string;
}) {
  const j = proposal.justification ?? {};
  return (
    <div
      className="mt-5 rounded-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, rgba(124,58,237,0.06) 0%, white 35%)",
        border: "1px solid rgba(124,58,237,0.18)",
        boxShadow: "0 6px 24px -10px rgba(124,58,237,0.25)",
      }}
    >
      <div
        className="px-5 py-4 border-b"
        style={{ borderColor: "rgba(124,58,237,0.1)" }}
      >
        <div className="flex items-center justify-between">
          <div
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
            style={{
              background: "rgba(124,58,237,0.1)",
              color: "rgba(124,58,237,0.9)",
              letterSpacing: "0.05em",
            }}
          >
            Twin Proposal
          </div>
          {typeof j.confidence === "number" && (
            <span
              className="text-[11px] font-medium"
              style={{ color: "rgba(15,23,42,0.55)" }}
            >
              {j.confidence}% confidence
            </span>
          )}
        </div>
        <h3
          className="text-[16px] font-semibold tracking-tight mt-2 leading-snug"
          style={{ color: "#0F172A", letterSpacing: "-0.015em" }}
        >
          {j.chosen_approach || "Twin proposal materialized."}
        </h3>
      </div>

      {j.key_tradeoffs && j.key_tradeoffs.length > 0 && (
        <div className="px-5 py-4">
          <h4
            className="text-[10.5px] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "rgba(15,23,42,0.5)", letterSpacing: "0.05em" }}
          >
            Key tradeoffs
          </h4>
          <ul className="space-y-2.5">
            {j.key_tradeoffs.slice(0, 4).map((t, i) => (
              <li
                key={i}
                className="text-[12.5px]"
                style={{ color: "rgba(15,23,42,0.75)" }}
              >
                <div className="font-medium" style={{ color: "#0F172A" }}>
                  {t.tradeoff}
                </div>
                <div className="text-[12px] mt-0.5">
                  Chose <strong>{t.chosen_side}</strong> — {t.why}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {j.alternatives_rejected && j.alternatives_rejected.length > 0 && (
        <div
          className="px-5 py-4 border-t"
          style={{ borderColor: "rgba(15,23,42,0.05)" }}
        >
          <h4
            className="text-[10.5px] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "rgba(15,23,42,0.5)", letterSpacing: "0.05em" }}
          >
            Alternatives rejected
          </h4>
          <ul className="space-y-2">
            {j.alternatives_rejected.slice(0, 3).map((a, i) => (
              <li
                key={i}
                className="text-[12px]"
                style={{ color: "rgba(15,23,42,0.7)" }}
              >
                <span className="font-medium" style={{ color: "#0F172A" }}>
                  {a.name}
                </span>{" "}
                — {a.why_rejected}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="px-5 py-3 flex items-center justify-between border-t"
        style={{
          borderColor: "rgba(15,23,42,0.05)",
          background: "rgba(15,23,42,0.015)",
        }}
      >
        <span className="text-[11px]" style={{ color: "rgba(15,23,42,0.5)" }}>
          {j.mechanism_ids?.length ?? 0} mechanisms · {proposal.user_status}
        </span>
        <Link
          href={`/app/space/${spaceId}`}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: "rgba(124,58,237,0.92)", color: "white" }}
        >
          Open in lab →
        </Link>
      </div>
    </div>
  );
}
