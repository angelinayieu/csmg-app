"use client";

// ── Reflexive pulse shape ─────────────────────────────────────────────
//
// The operational-view glance at the prospector / coverage / calibration
// subsystems. Anchored inside the Reflexive room; the spawner
// (canvas-reflexive-spawner.tsx) owns the polling + scan-now plumbing
// and mutates this shape's props to drive renders.
//
// Design intent (Apple-quiet):
//   - Two metric bars (Coverage, Depth) carry the primary read
//   - A single Calibration line — "awaiting reviews" until N≥3 verdicts
//     have landed, then % chip with traffic-light hue
//   - Footer: "Scan now" primary + "Open inbox →" secondary link
//   - Empty state, scanning state, post-scan delta banner all baked in
//   - No status dots, no per-dimension breakdown, no inline edge inbox —
//     those belong on the dedicated intelligence page
//
// Interaction: the "Scan now" button dispatches a window custom event
// that the spawner listens to, so the shape view stays a pure renderer
// (no editor handle in the React tree, matches the mechanism-card +
// other operational-shape patterns in this folder).

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useCallback, useEffect, useState } from "react";
import type { ReflexivePulseShape } from "./types";

export const REFLEXIVE_PULSE_DEFAULT_W = 360;
export const REFLEXIVE_PULSE_DEFAULT_H = 200;

// Minimum user verdicts before the calibration row shows a numeric
// acceptance percentage. Below this, the row reads "awaiting reviews."
// The rationale (from the audit's open question #2): a single rejected
// edge would otherwise show "0%" in red and slander the system.
const CALIBRATION_AWAITING_THRESHOLD = 3;

// Post-scan delta banner dwell time. Matches the dashboard's 8s pattern.
const DELTA_BANNER_MS = 8000;

export class ReflexivePulseShapeUtil extends BaseBoxShapeUtil<ReflexivePulseShape> {
  static override type = "reflexive-pulse" as const;
  static override props: RecordProps<ReflexivePulseShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    totalChecks: T.number,
    totalPossiblePairs: T.number,
    levelTwoPlus: T.number,
    acceptancePct: T.number.nullable(),
    verdictCount: T.number,
    proposedEdgesCount: T.number,
    lastCheckedAt: T.string.nullable(),
    pulse: T.number,
    lastScanDelta: T.string.nullable(),
    scanning: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => true;

  override onResize = (
    shape: ReflexivePulseShape,
    info: TLResizeInfo<ReflexivePulseShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): ReflexivePulseShape["props"] {
    return {
      w: REFLEXIVE_PULSE_DEFAULT_W,
      h: REFLEXIVE_PULSE_DEFAULT_H,
      spaceId: "",
      totalChecks: 0,
      totalPossiblePairs: 0,
      levelTwoPlus: 0,
      acceptancePct: null,
      verdictCount: 0,
      proposedEdgesCount: 0,
      lastCheckedAt: null,
      pulse: 0,
      lastScanDelta: null,
      scanning: false,
    };
  }

  component(shape: ReflexivePulseShape) {
    return <ReflexivePulseView shape={shape} />;
  }

  indicator(shape: ReflexivePulseShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}

function ReflexivePulseView({ shape }: { shape: ReflexivePulseShape }) {
  const {
    w,
    h,
    spaceId,
    totalChecks,
    totalPossiblePairs,
    levelTwoPlus,
    acceptancePct,
    verdictCount,
    proposedEdgesCount,
    lastCheckedAt,
    pulse,
    lastScanDelta,
    scanning,
  } = shape.props;

  // Derived metrics — pure computation, no fetches in the view.
  const coveragePct =
    totalPossiblePairs > 0
      ? Math.min(100, Math.round((totalChecks / totalPossiblePairs) * 100))
      : 0;
  const depthPct =
    totalChecks > 0
      ? Math.min(100, Math.round((levelTwoPlus / totalChecks) * 100))
      : 0;
  const isEmpty = totalChecks === 0;
  const lastAgoText = formatAgo(lastCheckedAt);

  // Post-scan delta banner — surfaces lastScanDelta for DELTA_BANNER_MS
  // after `pulse` changes, then collapses. Pure local state so the
  // banner doesn't persist across tldraw shape rehydration.
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (!lastScanDelta) return;
    setBannerVisible(true);
    const t = window.setTimeout(() => setBannerVisible(false), DELTA_BANNER_MS);
    return () => window.clearTimeout(t);
  }, [pulse, lastScanDelta]);

  // Calibration row — three states: awaiting / numeric / null endpoint.
  // The numeric chip uses a traffic-light hue tuned to be quiet (low
  // saturation Apple-flat tints, not screaming).
  const calibrationContent = renderCalibration(acceptancePct, verdictCount);

  const onScanClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (scanning) return;
      window.dispatchEvent(
        new CustomEvent("interaxis:reflexive-scan-now", {
          detail: { shapeId: shape.id, spaceId },
        }),
      );
    },
    [shape.id, spaceId, scanning],
  );

  const onOpenInboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("interaxis:navigate", {
          detail: { href: `/app/space/${spaceId}/intelligence` },
        }),
      );
    },
    [spaceId],
  );

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: 16,
          background: "#fff",
          borderRadius: 12,
          border: "1px solid rgba(11,13,18,0.08)",
          boxShadow:
            "0 1px 2px rgba(11,13,18,0.04), 0 4px 12px -4px rgba(11,13,18,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
          userSelect: "none",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Header: REFLEXIVE LOOP + freshness indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 10,
            borderBottom: "1px solid rgba(11,13,18,0.06)",
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(11,13,18,0.62)",
            }}
          >
            Reflexive loop
          </span>
          <span
            title={lastCheckedAt ? `Last check: ${lastCheckedAt}` : "Never scanned"}
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "rgba(11,13,18,0.46)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {lastAgoText ? `⟳ ${lastAgoText}` : "never scanned"}
          </span>
        </div>

        {/* Delta banner — appears for 8s after a scan completes */}
        {bannerVisible && lastScanDelta && (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(16,185,129,0.08)",
              color: "#047857",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "-0.005em",
            }}
          >
            {lastScanDelta}
          </div>
        )}

        {/* Metric rows */}
        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            <MetricRow
              label="Coverage"
              valueText={`${coveragePct} %`}
              barPct={coveragePct}
              barColor="#10B981"
              subline={`${totalChecks.toLocaleString()} of ${totalPossiblePairs.toLocaleString()} pairs checked`}
              dimmed={scanning}
            />
            <MetricRow
              label="Depth"
              valueText={`${depthPct} %`}
              barPct={depthPct}
              barColor="#6366F1"
              subline={`${levelTwoPlus.toLocaleString()} at L2+ · ${(totalChecks - levelTwoPlus).toLocaleString()} breadth-scan`}
              dimmed={scanning}
            />
            <CalibrationRow
              acceptancePct={acceptancePct}
              verdictCount={verdictCount}
              calibrationContent={calibrationContent}
            />
          </>
        )}

        {/* Action row — pushed to the bottom by flex */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingTop: 10,
            borderTop: "1px solid rgba(11,13,18,0.06)",
          }}
        >
          <button
            onClick={onScanClick}
            disabled={scanning}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: scanning ? "rgba(11,13,18,0.06)" : "#0B0D12",
              color: scanning ? "rgba(11,13,18,0.46)" : "#fff",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              border: "none",
              cursor: scanning ? "default" : "pointer",
              transition: "background 120ms ease-out",
            }}
          >
            {scanning ? "Scanning…" : "Scan now"}
          </button>
          <button
            onClick={onOpenInboxClick}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 0",
              fontSize: 10.5,
              fontWeight: 500,
              color: "rgba(11,13,18,0.58)",
              cursor: "pointer",
              letterSpacing: "-0.005em",
            }}
          >
            Open inbox
            {proposedEdgesCount > 0 ? ` · ${proposedEdgesCount} new` : ""}
            {" →"}
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

function MetricRow({
  label,
  valueText,
  barPct,
  barColor,
  subline,
  dimmed,
}: {
  label: string;
  valueText: string;
  barPct: number;
  barColor: string;
  subline: string;
  dimmed: boolean;
}) {
  return (
    <div
      style={{
        opacity: dimmed ? 0.6 : 1,
        transition: "opacity 180ms ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: "#0B0D12",
            letterSpacing: "-0.01em",
          }}
        >
          {valueText}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          height: 6,
          width: "100%",
          background: "rgba(11,13,18,0.06)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, barPct))}%`,
            background: barColor,
            borderRadius: 4,
            transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
      <p
        style={{
          margin: "4px 0 0",
          fontSize: 9.5,
          color: "rgba(11,13,18,0.48)",
          letterSpacing: "-0.005em",
        }}
      >
        {subline}
      </p>
    </div>
  );
}

function CalibrationRow({
  acceptancePct,
  verdictCount,
  calibrationContent,
}: {
  acceptancePct: number | null;
  verdictCount: number;
  calibrationContent: { chip: React.ReactNode; subline: string };
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
          }}
        >
          Calibration
        </span>
        {calibrationContent.chip}
      </div>
      <p
        style={{
          margin: "4px 0 0",
          fontSize: 9.5,
          color: "rgba(11,13,18,0.48)",
          letterSpacing: "-0.005em",
        }}
      >
        {calibrationContent.subline}
      </p>
    </div>
  );
}

function renderCalibration(
  acceptancePct: number | null,
  verdictCount: number,
): { chip: React.ReactNode; subline: string } {
  // "Awaiting" until at least N verdicts — protects against a single
  // rejection landing the row at 0% red.
  if (acceptancePct === null || verdictCount < CALIBRATION_AWAITING_THRESHOLD) {
    return {
      chip: (
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "rgba(11,13,18,0.42)",
            fontStyle: "italic",
          }}
        >
          awaiting reviews
        </span>
      ),
      subline: "Accept verdicts in the inbox to calibrate",
    };
  }

  // Numeric chip with quiet traffic-light hue. Thresholds set so a
  // mid-acceptance rate doesn't read as alarming.
  const tone =
    acceptancePct >= 70
      ? { bg: "rgba(16,185,129,0.10)", fg: "#047857" }
      : acceptancePct >= 40
        ? { bg: "rgba(217,119,6,0.10)", fg: "#B45309" }
        : { bg: "rgba(225,29,72,0.10)", fg: "#BE123C" };

  return {
    chip: (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 7px",
          borderRadius: 5,
          background: tone.bg,
          color: tone.fg,
          fontSize: 10,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {acceptancePct}%
      </span>
    ),
    subline: `${verdictCount} verdicts in last 30 days`,
  };
}

function EmptyState() {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 11,
        lineHeight: 1.5,
        color: "rgba(11,13,18,0.52)",
        letterSpacing: "-0.005em",
      }}
    >
      Prospector hasn&apos;t run yet. Tap{" "}
      <span style={{ fontWeight: 600, color: "#0B0D12" }}>Scan now</span> to
      start mapping the pair space.
    </p>
  );
}

// Human-readable elapsed time. "2h ago", "5d ago", "3w ago"; bigger
// than ~12w shows the date itself.
function formatAgo(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 12) return `${weeks}w ago`;
  return new Date(then).toLocaleDateString();
}
