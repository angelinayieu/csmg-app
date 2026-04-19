"use client";

// ── WhiteboardSparkline ──
//
// Compact SVG sparkline on node cards. Renders a solid historical line + an
// optional dashed prediction segment with an endpoint dot. Phase A just
// generates synthetic "trajectory" data from entity signals (importance,
// confidence, convergence-ness). Phase C (predictions) will replace the
// synthetic data with real convergent-point / cycle projections.

import React from "react";

export interface SparklineData {
  // Normalized series — each value in [0,1]. We map to SVG y-space.
  historical: number[];
  // Optional predicted continuation. Also in [0,1].
  predicted?: number[];
  // Color for historical line + area fill
  color: string;
  // Color for predicted line (defaults to positive-green or negative-red
  // based on trajectory direction).
  predictionColor?: string;
  // Short label rendered at the left (e.g. the current %).
  label: string;
  // Short label rendered at the right describing prediction (e.g. "→ 96%").
  predictionLabel?: string;
}

interface Props {
  data: SparklineData;
  width?: number;
  height?: number;
  // When true, colors and typography are inverted for dark (hero-tier) cards.
  dark?: boolean;
  className?: string;
}

export function WhiteboardSparkline({ data, width = 160, height = 34, dark = false, className }: Props) {
  const { historical, predicted, color, label, predictionLabel, predictionColor } = data;
  if (historical.length < 2) return null;

  // Layout math — split canvas between historical and predicted segments.
  const padX = 2;
  const padY = 3;
  const historicalFraction = predicted && predicted.length > 0 ? 0.7 : 1.0;
  const historicalWidth = (width - padX * 2) * historicalFraction;
  const predictedWidth = (width - padX * 2) - historicalWidth;

  const yOf = (v: number) => padY + (1 - Math.max(0, Math.min(1, v))) * (height - padY * 2);

  // Historical path
  const histPoints = historical.map((v, i) => ({
    x: padX + (i / Math.max(1, historical.length - 1)) * historicalWidth,
    y: yOf(v),
  }));
  const histPath = histPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const histEndPoint = histPoints[histPoints.length - 1];

  // Predicted path (continuation from historical end)
  let predPath: string | null = null;
  let predEndPoint: { x: number; y: number } | null = null;
  let predZonePath: string | null = null;
  if (predicted && predicted.length > 0) {
    // Prepend historical's end so the dashed line visually starts from the dot.
    const points = [histEndPoint, ...predicted.map((v, i) => ({
      x: padX + historicalWidth + ((i + 1) / predicted.length) * predictedWidth,
      y: yOf(v),
    }))];
    predPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    predEndPoint = points[points.length - 1];
    // Fill zone under the prediction — communicates "this is where we're headed"
    predZonePath = `${predPath} L${predEndPoint.x.toFixed(1)},${(height - padY).toFixed(1)} L${histEndPoint.x.toFixed(1)},${(height - padY).toFixed(1)} Z`;
  }

  // Area under historical (fill)
  const areaPath = `${histPath} L${histEndPoint.x.toFixed(1)},${(height - padY).toFixed(1)} L${padX.toFixed(1)},${(height - padY).toFixed(1)} Z`;

  const labelFill = dark ? "white" : color;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ display: "block", width: "100%", height: `${height}px` }}
    >
      {/* Predicted zone fill (very subtle) */}
      {predZonePath && (
        <path
          d={predZonePath}
          fill={dark ? "white" : predictionColor ?? color}
          opacity={dark ? 0.08 : 0.06}
        />
      )}
      {/* Historical area fill */}
      <path d={areaPath} fill={dark ? "white" : color} opacity={dark ? 0.12 : 0.15} />
      {/* Historical line */}
      <path
        d={histPath}
        fill="none"
        stroke={dark ? "white" : color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Predicted dashed line */}
      {predPath && (
        <path
          d={predPath}
          fill="none"
          stroke={dark ? "rgba(255,255,255,0.55)" : predictionColor ?? color}
          strokeWidth={1.4}
          strokeDasharray="3 2"
          strokeLinecap="round"
          opacity={0.75}
        />
      )}
      {/* Historical endpoint dot */}
      <circle
        cx={histEndPoint.x}
        cy={histEndPoint.y}
        r={2.5}
        fill={dark ? "white" : color}
      />
      {/* Predicted endpoint dot */}
      {predEndPoint && (
        <circle
          cx={predEndPoint.x}
          cy={predEndPoint.y}
          r={2}
          fill={dark ? "white" : predictionColor ?? color}
          opacity={0.7}
        />
      )}
      {/* Labels */}
      <text
        x={padX + 1}
        y={padY + 6}
        fill={labelFill}
        fontSize={7.5}
        fontWeight={700}
        letterSpacing="0.02em"
      >
        {label}
      </text>
      {predictionLabel && (
        <text
          x={width - padX - 1}
          y={padY + 6}
          fill={dark ? "rgba(255,255,255,0.7)" : predictionColor ?? color}
          fontSize={7.5}
          fontWeight={700}
          textAnchor="end"
        >
          {predictionLabel}
        </text>
      )}
    </svg>
  );
}

// ── Synthetic data generator ──
// Phase A: derive a plausible trajectory from entity signals. This lets every
// hero/key node show a sparkline without needing real timeseries data.
// The data isn't lying — the "current position" reflects the actual weight.
// Phase C will replace this with real projection data from convergent points.

export function synthesizeSparkline(opts: {
  weight: number;        // 0..100 composite weight
  confidence: number;    // 0..1
  isConvergence: boolean;
  layerColor: string;
  hasPrediction: boolean;
}): SparklineData {
  const normWeight = opts.weight / 100;
  const normConf = opts.confidence;

  // Historical: builds up toward the current weight. Rising series if weight
  // is high; dipping-then-recovery if convergence (multiple paths stabilizing).
  const historical: number[] = [];
  const segments = 8;
  const baseline = Math.max(0.15, normWeight - 0.35);
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    let v = baseline + (normWeight - baseline) * t;
    // Convergence nodes: add a small dip in the middle to show the "meeting"
    if (opts.isConvergence && i > 2 && i < 5) {
      v -= 0.08;
    }
    // Slight noise (deterministic — not truly random) based on confidence
    const noise = (Math.sin(i * 1.7) * 0.04 + Math.cos(i * 2.3) * 0.03) * (1 - normConf);
    historical.push(Math.max(0, Math.min(1, v + noise)));
  }

  // Predicted continuation — only for high-weight nodes with some confidence
  let predicted: number[] | undefined;
  let predictionLabel: string | undefined;
  let predictionColor: string | undefined;

  if (opts.hasPrediction && opts.weight >= 70) {
    // Project forward — slight continuation of trend, magnitude proportional to confidence
    const predSegments = 4;
    predicted = [];
    const last = historical[historical.length - 1];
    const secondLast = historical[historical.length - 2];
    const trend = last - secondLast;
    for (let i = 1; i <= predSegments; i++) {
      const projected = last + trend * i * (0.8 + normConf * 0.4);
      predicted.push(Math.max(0, Math.min(1, projected)));
    }
    const delta = predicted[predicted.length - 1] - last;
    const finalWeight = Math.round(predicted[predicted.length - 1] * 100);
    const arrow = delta > 0.03 ? "↑" : delta < -0.03 ? "↓" : "→";
    predictionLabel = `${arrow} ${finalWeight}%`;
    predictionColor = delta > 0.03 ? "#24c36e" : delta < -0.03 ? "#ff4d4d" : opts.layerColor;
  }

  return {
    historical,
    predicted,
    color: opts.layerColor,
    predictionColor,
    label: `${opts.weight}%`,
    predictionLabel,
  };
}
