"use client";

import { useEffect, useState } from "react";

interface HealthRingGaugeProps {
  score: number;               // 0-100
  label?: string;              // "TWIN HEALTH"
  sublabel?: string;           // "Composite · weighted by frame"
  delta30d?: number;           // e.g., +3.2
  size?: number;               // px, default 360
  totalLabs: number;
  totalFrames: number;
  totalAtoms: number;
}

const CIRCUMFERENCE_FACTOR = 2 * Math.PI;

export function HealthRingGauge({
  score,
  label = "TWIN HEALTH",
  sublabel = "Composite · weighted by frame",
  delta30d,
  size = 360,
  totalLabs,
  totalFrames,
  totalAtoms,
}: HealthRingGaugeProps) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const [ringProgress, setRingProgress] = useState(0);

  const radius = size * 0.411; // ~148 for size=360
  const circumference = radius * CIRCUMFERENCE_FACTOR;
  const center = size / 2;

  // Animate on mount and whenever score changes
  useEffect(() => {
    const startTime = performance.now();
    const duration = 1600;
    const startVal = 0;

    let frame = 0;
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(startVal + (score - startVal) * eased);
      setRingProgress(eased * (score / 100));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    const timeoutId = window.setTimeout(() => {
      frame = requestAnimationFrame(animate);
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [score]);

  const dashOffset = circumference * (1 - ringProgress);

  const whole = Math.floor(animatedScore);
  const dec = Math.floor((animatedScore - whole) * 10);

  return (
    <div
      data-no-pan
      data-no-zoom
      className="twin-core pointer-events-auto cursor-pointer"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: size,
        height: size,
        zIndex: 10,
      }}
    >
      {/* Ring SVG */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{
          width: "100%",
          height: "100%",
          transform: "rotate(-90deg)",
        }}
      >
        <defs>
          <linearGradient id="ot-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent-400)" />
            <stop offset="50%" stopColor="var(--accent-600)" />
            <stop offset="100%" stopColor="var(--accent-700)" />
          </linearGradient>
          <filter id="ot-ring-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer dashed decorative ring */}
        <circle
          cx={center}
          cy={center}
          r={size * 0.472}
          fill="none"
          stroke="var(--accent-100)"
          strokeWidth="1"
          strokeDasharray="2 4"
          opacity="0.7"
        />

        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#eef0f2"
          strokeWidth="22"
          strokeLinecap="round"
        />

        {/* Progress ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#ot-ring-grad)"
          strokeWidth="22"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          filter="url(#ot-ring-glow)"
          style={{ transition: "stroke-dashoffset 0.2s linear" }}
        />
      </svg>

      {/* Content overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          className="flex items-center gap-[7px] font-mono"
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: "#6e7079",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            marginBottom: "6px",
          }}
        >
          <span
            className="relative inline-block"
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#10b981",
              boxShadow: "0 0 0 3px rgba(16,185,129,0.15)",
            }}
          />
          {label}
        </div>
        <div
          style={{
            fontSize: "11.5px",
            color: "#6e7079",
            fontWeight: 500,
            marginBottom: "14px",
            letterSpacing: "-0.01em",
          }}
        >
          {sublabel}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "3px",
            marginBottom: "4px",
            lineHeight: 0.9,
          }}
        >
          <span
            style={{
              fontSize: "96px",
              fontWeight: 800,
              color: "#0a0b0f",
              letterSpacing: "-0.06em",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {whole}
            <span
              style={{
                fontSize: "36px",
                color: "#6e7079",
                fontWeight: 700,
                letterSpacing: "-0.05em",
              }}
            >
              .{dec}
            </span>
          </span>
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: "12px",
            color: "#a4a6ad",
            fontWeight: 500,
            marginTop: "4px",
            letterSpacing: "0.05em",
          }}
        >
          / 100
        </div>
        {typeof delta30d === "number" && (
          <div
            className="font-mono"
            style={{
              fontSize: "12px",
              color: delta30d >= 0 ? "#10b981" : "#ef4444",
              fontWeight: 700,
              marginTop: "10px",
              letterSpacing: "-0.005em",
            }}
          >
            {delta30d >= 0 ? "↑" : "↓"} {Math.abs(delta30d).toFixed(1)} past 30d
          </div>
        )}

        {/* Footer labels */}
        <div
          className="font-mono"
          style={{
            position: "absolute",
            bottom: "20px",
            display: "flex",
            gap: "16px",
            fontSize: "9px",
            color: "#a4a6ad",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <span>
            <strong style={{ color: "#1d1f24", fontWeight: 800 }}>{totalLabs}</strong> LABS
          </span>
          <span>
            <strong style={{ color: "#1d1f24", fontWeight: 800 }}>{totalFrames}</strong> FRAMES
          </span>
          <span>
            <strong style={{ color: "#1d1f24", fontWeight: 800 }}>{totalAtoms}</strong> ATOMS
          </span>
        </div>
      </div>
    </div>
  );
}
