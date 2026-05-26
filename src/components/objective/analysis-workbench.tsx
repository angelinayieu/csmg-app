"use client";

// ── Analysis Workbench ────────────────────────────────────────────
//
// The cross-room "reading" surface — mounted on the parent objective
// canvas page above the room grid. Two layers:
//
//   • Strip — always-visible single-line summary (counts by category,
//     last-scan timestamp, rescan button). Click to expand.
//   • Panel — full workbench with FINDINGS (auto Tier 1) + OPERATIONS
//     (on-demand Tier 2/3).
//
// All state lives on spaces.synthesis_data.cross_room_analysis via
// the /scan, /run, /disposition routes. The workbench re-scans
// silently on first open + lazy-refreshes on user click.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Compass,
  RefreshCw,
  Sparkles,
  X,
  Check,
  Pause,
  Layers,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── Local type mirrors (kept narrow to avoid client/server cross-bundle) ──

type AnalysisCategory =
  | "friction"
  | "redundancy"
  | "gap"
  | "bottleneck"
  | "priority"
  | "structure"
  | "theme";

type AnalysisSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

type FindingDisposition =
  | "open"
  | "acknowledged"
  | "resolved"
  | "dismissed";

interface AnalysisFinding {
  id: string;
  analysis_key: string;
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  tier: 1 | 2 | 3;
  title: string;
  summary: string;
  body: Record<string, unknown>;
  references: {
    room_ids: string[];
    item_ids: string[];
  };
  disposition: FindingDisposition;
  generated_at: string;
}

interface CrossRoomAnalysisState {
  state_hash: string;
  scanned_at: string;
  findings: AnalysisFinding[];
}

interface OperationCatalogEntry {
  key: string;
  label: string;
  description: string;
}

interface Props {
  spaceId: string;
  /** Cached initial analysis snapshot from the server. */
  initialAnalysis: CrossRoomAnalysisState | null;
  /** Map of room id → room title for rendering. */
  roomTitles: Record<string, string>;
  /** Tier 2 operations the user can fire from the workbench. */
  operations: OperationCatalogEntry[];
}

const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  friction: "Frictions",
  redundancy: "Redundancies",
  gap: "Gaps",
  bottleneck: "Bottlenecks",
  priority: "Priorities",
  structure: "Structure",
  theme: "Themes",
};

const CATEGORY_COLOR: Record<AnalysisCategory, string> = {
  friction: "rgba(220,38,38,0.85)", // red
  redundancy: "rgba(124,58,237,0.85)", // purple
  gap: "rgba(217,119,6,0.85)", // amber
  bottleneck: "rgba(234,88,12,0.85)", // orange
  priority: "rgba(37,99,235,0.85)", // blue
  structure: "rgba(22,163,74,0.85)", // green
  theme: "rgba(124,58,237,0.85)", // purple
};

const SEVERITY_RANK: Record<AnalysisSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

type Tab = "all" | AnalysisCategory;

export function AnalysisWorkbench({
  spaceId,
  initialAnalysis,
  roomTitles,
  operations,
}: Props) {
  const [analysis, setAnalysis] = useState<CrossRoomAnalysisState | null>(
    initialAnalysis,
  );
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [runningOp, setRunningOp] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  // Visible findings = non-dismissed, optionally filtered by tab.
  const visibleFindings = useMemo(() => {
    if (!analysis) return [];
    const live = analysis.findings.filter(
      (f) => f.disposition !== "dismissed",
    );
    const filtered = tab === "all" ? live : live.filter((f) => f.category === tab);
    return filtered.slice().sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return a.title.localeCompare(b.title);
    });
  }, [analysis, tab]);

  // Category breakdown for the strip's count summary.
  const breakdown = useMemo(() => {
    const counts: Record<AnalysisCategory, number> = {
      friction: 0,
      redundancy: 0,
      gap: 0,
      bottleneck: 0,
      priority: 0,
      structure: 0,
      theme: 0,
    };
    const live = (analysis?.findings ?? []).filter(
      (f) => f.disposition !== "dismissed",
    );
    for (const f of live) counts[f.category] += 1;
    return counts;
  }, [analysis]);
  const totalLive = useMemo(
    () => Object.values(breakdown).reduce((a, b) => a + b, 0),
    [breakdown],
  );

  const lastScanLabel = useMemo(() => {
    if (!analysis?.scanned_at) return null;
    const t = new Date(analysis.scanned_at).getTime();
    const diff = Date.now() - t;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }, [analysis]);

  const rescan = useCallback(
    async (force = false) => {
      setScanning(true);
      setScanError(null);
      try {
        const res = await fetch("/api/brainstorm/space/analysis/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            mode: force ? "force" : "default",
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setScanError(json?.error ?? "Scan failed.");
          return;
        }
        if (json?.analysis) setAnalysis(json.analysis as CrossRoomAnalysisState);
      } catch (err) {
        setScanError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setScanning(false);
      }
    },
    [spaceId],
  );

  const runOp = useCallback(
    async (operationKey: string, force = false) => {
      setRunningOp(operationKey);
      setOpError(null);
      try {
        const res = await fetch("/api/brainstorm/space/analysis/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            operationKey,
            mode: force ? "force" : "default",
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setOpError(json?.error ?? "Operation failed.");
          return;
        }
        if (json?.analysis)
          setAnalysis(json.analysis as CrossRoomAnalysisState);
      } catch (err) {
        setOpError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setRunningOp(null);
      }
    },
    [spaceId],
  );

  const setDisposition = useCallback(
    async (findingId: string, disposition: FindingDisposition) => {
      // Optimistic local update.
      setAnalysis((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          findings: prev.findings.map((f) =>
            f.id === findingId ? { ...f, disposition } : f,
          ),
        };
      });
      try {
        await fetch("/api/brainstorm/space/analysis/disposition", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, findingId, disposition }),
        });
      } catch {
        // Soft-fail — UI already updated optimistically.
      }
    },
    [spaceId],
  );

  // Auto-scan once on mount when no cached analysis exists. Free —
  // Tier 1 is sync-shaped and cheap.
  useEffect(() => {
    if (analysis) return;
    void rescan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stripBg = "rgba(124,58,237,0.05)";
  const stripBorder = "rgba(124,58,237,0.18)";

  return (
    <div
      className="mb-5 rounded-2xl border"
      style={{
        background: stripBg,
        borderColor: stripBorder,
        borderRadius: appleVibe.radius.md,
      }}
    >
      {/* ── Strip — single line summary, always visible ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <Sparkles
            className="h-3.5 w-3.5 flex-shrink-0"
            strokeWidth={2}
            style={{ color: "rgba(124,58,237,0.85)" }}
          />
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "rgba(76,29,149,0.95)" }}
          >
            Analysis
          </span>
          <span
            className="text-[12.5px] font-medium"
            style={{ color: appleVibe.text.primary }}
          >
            {totalLive === 0
              ? "No findings yet"
              : `${totalLive} finding${totalLive === 1 ? "" : "s"}`}
          </span>
          {totalLive > 0 && (
            <span
              className="text-[11px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              · {summarizeBreakdown(breakdown)}
            </span>
          )}
          {lastScanLabel && (
            <span
              className="ml-auto text-[10.5px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              scanned {lastScanLabel}
            </span>
          )}
        </button>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void rescan(true);
            }}
            disabled={scanning}
            title="Rescan"
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
            style={{
              background: "transparent",
              color: appleVibe.text.tertiary,
              cursor: scanning ? "wait" : "pointer",
            }}
          >
            <RefreshCw
              className={`h-3 w-3 ${scanning ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            {scanning ? "scanning" : "rescan"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full"
            style={{
              background: "rgba(124,58,237,0.10)",
              color: "rgba(76,29,149,0.95)",
            }}
            aria-label={expanded ? "Collapse workbench" : "Expand workbench"}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {/* ── Panel — expanded view ── */}
      {expanded && (
        <div
          className="border-t px-4 py-3"
          style={{ borderColor: stripBorder }}
        >
          {scanError && (
            <p
              className="mb-2 text-[11px] font-light"
              style={{ color: "rgba(127,29,29,0.95)" }}
            >
              {scanError}
            </p>
          )}

          {/* Findings */}
          <div className="mb-4">
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Findings
              </span>
              <span className="ml-1 mr-2 text-[10.5px] font-light" style={{ color: appleVibe.text.faint }}>
                ·
              </span>
              <TabChip label={`All (${totalLive})`} active={tab === "all"} onClick={() => setTab("all")} />
              {(Object.keys(breakdown) as AnalysisCategory[])
                .filter((cat) => breakdown[cat] > 0)
                .map((cat) => (
                  <TabChip
                    key={cat}
                    label={`${CATEGORY_LABEL[cat]} (${breakdown[cat]})`}
                    active={tab === cat}
                    onClick={() => setTab(cat)}
                    color={CATEGORY_COLOR[cat]}
                  />
                ))}
            </div>

            {visibleFindings.length === 0 ? (
              <p
                className="text-[12px] font-light italic"
                style={{ color: appleVibe.text.tertiary }}
              >
                {analysis === null
                  ? "Running first scan…"
                  : tab === "all"
                    ? "No findings yet. Try a different room generation or run an operation below."
                    : `No ${CATEGORY_LABEL[tab].toLowerCase()} findings.`}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleFindings.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    spaceId={spaceId}
                    roomTitles={roomTitles}
                    onAcknowledge={() => setDisposition(f.id, "acknowledged")}
                    onResolve={() => setDisposition(f.id, "resolved")}
                    onDismiss={() => setDisposition(f.id, "dismissed")}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Operations */}
          {operations.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Operations · on-demand
                </span>
              </div>
              {opError && (
                <p
                  className="mb-2 text-[11px] font-light"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  {opError}
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {operations.map((op) => (
                  <li
                    key={op.key}
                    className="flex items-start justify-between gap-3 rounded-xl px-2.5 py-1.5"
                    style={{
                      background: "rgba(255,255,255,0.6)",
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[12px] font-semibold"
                        style={{ color: appleVibe.text.primary }}
                      >
                        {op.label}
                      </div>
                      <div
                        className="text-[11px] font-light leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {op.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runOp(op.key, false)}
                      disabled={runningOp === op.key}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                      style={{
                        background: appleVibe.accent.primary,
                        color: appleVibe.text.onAccent,
                        cursor:
                          runningOp === op.key ? "wait" : "pointer",
                        opacity: runningOp === op.key ? 0.7 : 1,
                      }}
                    >
                      <Sparkles className="h-2.5 w-2.5" strokeWidth={2} />
                      {runningOp === op.key ? "Running…" : "Run"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Finding card ──────────────────────────────────────────────────────

function FindingCard({
  finding,
  spaceId,
  roomTitles,
  onAcknowledge,
  onResolve,
  onDismiss,
}: {
  finding: AnalysisFinding;
  spaceId: string;
  roomTitles: Record<string, string>;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const color = CATEGORY_COLOR[finding.category];
  const ack = finding.disposition === "acknowledged";
  const resolved = finding.disposition === "resolved";
  const opacity = ack ? 0.65 : 1;
  const isRecommend = finding.analysis_key === "recommend_next_move";
  const isTheme = finding.analysis_key === "distill_concepts";
  const ringDecor =
    finding.severity === "critical" || finding.severity === "high"
      ? `0 0 0 2px ${color}1F`
      : undefined;

  // Sub-branch state — when the user clicks "Distill into sub-objective"
  // on a theme finding. Optimistic: navigate as soon as the route
  // returns the new id.
  const [branching, setBranching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const spawnedSubId =
    typeof finding.body?.spawned_sub_objective_id === "string"
      ? (finding.body.spawned_sub_objective_id as string)
      : null;

  async function distillIntoSubObjective() {
    if (branching) return;
    setBranching(true);
    setBranchError(null);
    try {
      // Compose a clean description: the theme's body.description +
      // the why_it_recurs line if present. Falls back to summary.
      const themeDescription =
        typeof finding.body?.description === "string"
          ? (finding.body.description as string)
          : finding.summary;
      const whyItRecurs =
        typeof finding.body?.why_it_recurs === "string"
          ? (finding.body.why_it_recurs as string)
          : "";
      const description = whyItRecurs
        ? `${themeDescription}\n\nWhy this recurs across rooms: ${whyItRecurs}`
        : themeDescription;
      const title =
        typeof finding.body?.name === "string"
          ? (finding.body.name as string)
          : finding.title;
      const res = await fetch(
        "/api/brainstorm/space/analysis/sub-branch/sub-objective",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            findingId: finding.id,
            title,
            description,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setBranchError(json?.error ?? "Sub-branch failed.");
        return;
      }
      const newId =
        typeof json?.subObjectiveId === "string" ? json.subObjectiveId : "";
      if (newId) {
        router.push(`/app/objective/${spaceId}/sub/${newId}`);
      }
    } catch (err) {
      setBranchError(
        err instanceof Error ? err.message : "Network error.",
      );
    } finally {
      setBranching(false);
    }
  }

  return (
    <li
      className="rounded-2xl p-2.5"
      style={{
        background: resolved
          ? "rgba(22,163,74,0.04)"
          : "rgba(255,255,255,0.7)",
        border: `1px solid ${resolved ? "rgba(22,163,74,0.22)" : appleVibe.stroke.hairline}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: appleVibe.radius.md,
        opacity,
        boxShadow: ringDecor,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color }}
            >
              {CATEGORY_LABEL[finding.category]}
            </span>
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              · {finding.severity}
            </span>
            {finding.tier > 1 && (
              <span
                className="text-[9.5px] font-light italic"
                style={{ color: appleVibe.text.faint }}
              >
                · LLM
              </span>
            )}
          </div>
          <div
            className="mt-0.5 text-[12.5px] font-semibold leading-snug"
            style={{ color: appleVibe.text.primary }}
          >
            {finding.title}
          </div>
          <p
            className="mt-1 text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {finding.summary}
          </p>

          {/* Room references */}
          {finding.references.room_ids.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {finding.references.room_ids.map((rid) => {
                const title = roomTitles[rid] ?? rid.slice(0, 6);
                return (
                  <a
                    key={rid}
                    href={`/app/objective/${spaceId}/sub/${rid}`}
                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      background: "rgba(15,23,42,0.04)",
                      color: appleVibe.text.secondary,
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                    }}
                    title={`Open ${title}`}
                  >
                    <Layers className="h-2.5 w-2.5" strokeWidth={2} />
                    {title}
                  </a>
                );
              })}
            </div>
          )}

          {/* Theme evidence — surface inline */}
          {isTheme &&
            Array.isArray(finding.body.evidence) && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {(finding.body.evidence as string[]).slice(0, 3).map((e, i) => (
                  <li
                    key={i}
                    className="text-[11px] font-light italic leading-snug"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {e}
                  </li>
                ))}
              </ul>
            )}

          {/* Recommend-next-move detail — next_steps + effort + learn */}
          {isRecommend && (
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.isArray(finding.body?.next_steps) &&
                (finding.body.next_steps as string[]).length > 0 && (
                  <div>
                    <div
                      className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      Next steps
                    </div>
                    <ol className="mt-0.5 list-decimal space-y-0.5 pl-4">
                      {(finding.body.next_steps as string[]).map((s, i) => (
                        <li
                          key={i}
                          className="text-[11px] font-light leading-snug"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {s}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              <div className="flex flex-wrap gap-3 text-[10.5px]">
                {typeof finding.body?.estimated_effort === "string" &&
                  (finding.body.estimated_effort as string).length > 0 && (
                    <span style={{ color: appleVibe.text.tertiary }}>
                      <span className="font-semibold uppercase tracking-[0.1em]">
                        Effort:
                      </span>{" "}
                      {finding.body.estimated_effort as string}
                    </span>
                  )}
                {typeof finding.body?.what_youll_learn === "string" &&
                  (finding.body.what_youll_learn as string).length > 0 && (
                    <span
                      className="italic"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      You&rsquo;ll know:{" "}
                      {finding.body.what_youll_learn as string}
                    </span>
                  )}
              </div>
            </div>
          )}

          {/* Sub-branch affordance — only on theme findings.
              When already spawned, show the link instead of the button. */}
          {isTheme && (
            <div className="mt-2">
              {spawnedSubId ? (
                <a
                  href={`/app/objective/${spaceId}/sub/${spawnedSubId}`}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{
                    background: "rgba(22,163,74,0.10)",
                    color: "rgba(20,83,45,0.95)",
                    border: "1px solid rgba(22,163,74,0.25)",
                  }}
                >
                  <ArrowRight className="h-2.5 w-2.5" strokeWidth={2.5} />
                  Open spawned room
                </a>
              ) : (
                <button
                  type="button"
                  onClick={distillIntoSubObjective}
                  disabled={branching}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{
                    background: branching
                      ? appleVibe.surface.chip
                      : "rgba(124,58,237,0.10)",
                    color: "rgba(76,29,149,0.95)",
                    border: "1px solid rgba(124,58,237,0.25)",
                    cursor: branching ? "wait" : "pointer",
                    opacity: branching ? 0.7 : 1,
                  }}
                >
                  <Compass className="h-2.5 w-2.5" strokeWidth={2.5} />
                  {branching ? "Spawning…" : "Distill into sub-objective"}
                </button>
              )}
              {branchError && (
                <p
                  className="mt-1 text-[10.5px] font-light"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  {branchError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Disposition buttons */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <DispositionBtn
            active={resolved}
            onClick={onResolve}
            color="rgba(22,163,74,0.85)"
            title={resolved ? "Resolved" : "Mark resolved"}
            Icon={Check}
          />
          <DispositionBtn
            active={ack}
            onClick={onAcknowledge}
            color="rgba(217,119,6,0.85)"
            title={ack ? "Acknowledged" : "Acknowledge"}
            Icon={Pause}
          />
          <DispositionBtn
            active={false}
            onClick={onDismiss}
            color="rgba(220,38,38,0.85)"
            title="Dismiss (hide)"
            Icon={X}
          />
        </div>
      </div>
    </li>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────

function TabChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={{
        background: active
          ? "rgba(15,23,42,0.08)"
          : "rgba(255,255,255,0.6)",
        color: active
          ? appleVibe.text.primary
          : appleVibe.text.secondary,
        border: `1px solid ${active ? "rgba(15,23,42,0.18)" : appleVibe.stroke.hairline}`,
      }}
    >
      {color && (
        <span
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

function DispositionBtn({
  active,
  onClick,
  color,
  title,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  title: string;
  Icon: typeof Check;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-all"
      style={{
        background: active ? `${color.replace("0.85", "0.14")}` : "transparent",
        color: active ? color : appleVibe.text.tertiary,
        border: `1px solid ${active ? color : appleVibe.stroke.hairline}`,
      }}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
    </button>
  );
}

function summarizeBreakdown(b: Record<AnalysisCategory, number>): string {
  const parts: string[] = [];
  (Object.keys(b) as AnalysisCategory[]).forEach((cat) => {
    if (b[cat] > 0) {
      parts.push(`${b[cat]} ${CATEGORY_LABEL[cat].toLowerCase()}`);
    }
  });
  return parts.slice(0, 3).join(" · ");
}

