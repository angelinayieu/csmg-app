"use client";

import { CheckCircle2 } from "lucide-react";

export function ConvergenceBridge({ variantCount }: { variantCount: number }) {
  return (
    <div className="relative" style={{ height: 72, margin: "-4px 0" }}>
      {/* Central glass pill */}
      <div
        className="absolute left-1/2 top-1/2 flex items-center gap-2.5 px-3.5 py-2 rounded-full z-[3]"
        style={{
          transform: "translate(-50%, -50%)",
          background: "rgba(255, 255, 255, 0.78)",
          backdropFilter: "blur(18px) saturate(170%)",
          WebkitBackdropFilter: "blur(18px) saturate(170%)",
          border: "1px solid rgba(11,13,18,0.14)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -6px rgba(11,30,80,0.15), 0 2px 4px rgba(11,13,18,0.04)",
        }}
      >
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center"
          style={{
            background: "#fff",
            border: "1.5px solid var(--accent-600)",
            color: "var(--accent-600)",
            boxShadow: "0 0 0 4px rgba(var(--accent-rgb), 0.1)",
          }}
        >
          <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2.5} />
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#0B0D12",
          }}
        >
          Synthesized into variants
        </span>
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 600,
            color: "rgba(11,13,18,0.48)",
          }}
        >
          · {variantCount} {variantCount === 1 ? "option" : "options"}
        </span>
      </div>

      {/* Feed + exit lines */}
      <svg
        aria-hidden
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 72"
      >
        {/* Four feed lines converging to center */}
        {[150, 400, 600, 850].map((x, i) => {
          const color =
            i === 0 ? "#92400E" : i === 1 ? "#065F46" : i === 2 ? "var(--accent-700)" : "#6B21A8";
          return (
            <path
              key={i}
              d={`M ${x} 0 L ${x} 20 Q ${x} 32 ${x + (500 - x) * 0.2} 32 L 500 36`}
              stroke={color}
              strokeWidth={1.4}
              strokeOpacity={0.6}
              strokeLinecap="round"
              fill="none"
            />
          );
        })}
        {/* Exit line */}
        <path
          d="M 500 50 L 500 72"
          stroke="#0B0D12"
          strokeWidth={1.3}
          strokeOpacity={0.3}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
