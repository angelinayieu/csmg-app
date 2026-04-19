"use client";

interface HeroMetricProps {
  label: string;
  value: string;
  unit?: string;
  delta?: { display: string; positive?: boolean };
  accent?: boolean;
}

export function HeroMetric({ label, value, unit, delta, accent }: HeroMetricProps) {
  return (
    <div
      className="px-3.5 py-2.5 rounded-[10px]"
      style={{
        background: accent
          ? "rgba(var(--accent-rgb), 0.08)"
          : "rgba(255, 255, 255, 0.55)",
        border: accent
          ? "1px solid rgba(var(--accent-rgb), 0.2)"
          : "1px solid rgba(11,13,18,0.08)",
      }}
    >
      <div
        className="font-mono mb-1"
        style={{
          fontSize: "9.5px",
          fontWeight: 700,
          color: "rgba(11,13,18,0.48)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="tabular-nums"
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: accent ? "var(--accent-700)" : "#0a0b0f",
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize: 11,
              color: "rgba(11,13,18,0.48)",
              fontWeight: 500,
            }}
          >
            {unit}
          </span>
        )}
      </div>
      {delta && (
        <div
          className="mt-1 font-mono"
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: delta.positive !== false ? "#047857" : "#B91C1C",
          }}
        >
          {delta.display}
        </div>
      )}
    </div>
  );
}
