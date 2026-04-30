"use client";

// /design/preflight/node-signature-band — sketch (v4): five forecast
// indicator designs for app cards, lined up so you can pick the one
// that lands. No gradient bars. No rings. Each design carries the same
// three pieces of info — direction, magnitude, spread — but presents
// them with a different aesthetic.

import {
  ArrowDownRight,
  ArrowUpRight,
  Activity,
  Brain,
  Coffee,
  Droplets,
  FlaskConical,
  Minus,
  Moon,
  PenLine,
  Smile,
  Users,
} from "lucide-react";

// ── tokens ────────────────────────────────────────────────────────────
type Polarity = "positive" | "negative" | "neutral";

const POL = {
  positive: { fg: "#3f6b54", bg: "rgba(126,168,147,0.14)", soft: "#7ea893" },
  negative: { fg: "#7d4f49", bg: "rgba(192,140,134,0.14)", soft: "#c08c86" },
  neutral: { fg: "#5d6470", bg: "rgba(155,166,182,0.14)", soft: "#9aa3b1" },
};

const MUTED = "rgba(20,30,60,0.42)";
const TEXT = "#1a1f2c";

function polarityFor(p10: number, p50: number, p90: number): Polarity {
  const crossesZero = p10 < -0.005 && p90 > 0.005;
  if (crossesZero) return "neutral";
  if (p50 > 0.005) return "positive";
  if (p50 < -0.005) return "negative";
  return "neutral";
}

function fmt(v: number, opts: { sign?: boolean; decimals?: number } = {}) {
  const { sign = true, decimals = 0 } = opts;
  const s = sign && v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(decimals)}%`;
}

interface ForecastProps {
  p10: number;
  p50: number;
  p90: number;
}

// ── Design A — Notion-style tag pill ──────────────────────────────────
// Solid soft-bg pill with colored text. Inline, low-key, like a Notion
// status tag. Spread sits below in muted mono numerals.
function DesignA({ p10, p50, p90 }: ForecastProps) {
  const pol = polarityFor(p10, p50, p90);
  const c = POL[pol];
  const label = pol === "neutral" ? "uncertain" : `${fmt(p50)} expected`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <span
        style={{
          padding: "3px 10px",
          borderRadius: 999,
          background: c.bg,
          color: c.fg,
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: MUTED,
          fontFamily: '"SF Mono", ui-monospace, monospace',
          fontVariantNumeric: "tabular-nums",
          paddingLeft: 2,
        }}
      >
        {fmt(p10)} … {fmt(p90)}
      </span>
    </div>
  );
}

// ── Design B — Apple Stocks ───────────────────────────────────────────
// Big bold number, directional arrow icon, tiny spread caption. Reads
// like a stock ticker — fastest "is this good or bad" scan.
function DesignB({ p10, p50, p90 }: ForecastProps) {
  const pol = polarityFor(p10, p50, p90);
  const c = POL[pol];
  const Icon = pol === "positive" ? ArrowUpRight : pol === "negative" ? ArrowDownRight : Minus;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon style={{ width: 14, height: 14, color: c.fg, strokeWidth: 2.4 }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: c.fg,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {pol === "neutral" ? "—" : fmt(p50)}
        </span>
      </div>
      <span
        style={{
          fontSize: 10.5,
          color: MUTED,
          fontFamily: '"SF Mono", ui-monospace, monospace',
          fontVariantNumeric: "tabular-nums",
          paddingLeft: 20,
        }}
      >
        {fmt(p10)} → {fmt(p90)}
      </span>
    </div>
  );
}

// ── Design C — Linear / Figma minimal dot ─────────────────────────────
// 6px solid dot + plain text, single line. Spread on a second line
// in tabular numerals. Quietest of the lot.
function DesignC({ p10, p50, p90 }: ForecastProps) {
  const pol = polarityFor(p10, p50, p90);
  const c = POL[pol];
  const headline =
    pol === "neutral" ? "could go either way" : `${fmt(p50)} expected`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: c.soft,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontSize: 12.5,
            color: TEXT,
            fontWeight: 500,
            letterSpacing: "-0.005em",
          }}
        >
          {headline}
        </span>
      </div>
      <span
        style={{
          fontSize: 10,
          color: MUTED,
          fontFamily: '"SF Mono", ui-monospace, monospace',
          fontVariantNumeric: "tabular-nums",
          paddingLeft: 14,
        }}
      >
        range {fmt(p10)} … {fmt(p90)}
      </span>
    </div>
  );
}

// ── Design D — Inline range tick ──────────────────────────────────────
// A horizontal "number line" with 0 at center, a small filled segment
// where the forecast sits, no gradient, no dot. The range itself IS
// the visualization. Headline above.
function DesignD({ p10, p50, p90 }: ForecastProps) {
  const pol = polarityFor(p10, p50, p90);
  const c = POL[pol];
  const headline = pol === "neutral" ? "uncertain" : `${fmt(p50)} expected`;

  // Number line spans -30% to +30% (six DOMAIN points)
  const DOMAIN = 0.3;
  const toPct = (v: number) => ((Math.max(-DOMAIN, Math.min(DOMAIN, v)) + DOMAIN) / (2 * DOMAIN)) * 100;
  const leftPct = toPct(p10);
  const rightPct = toPct(p90);
  const p50Pct = toPct(p50);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 12.5,
          color: pol === "neutral" ? TEXT : c.fg,
          fontWeight: 500,
          letterSpacing: "-0.005em",
        }}
      >
        {headline}
      </span>
      <div
        style={{
          position: "relative",
          height: 14,
          marginTop: 2,
        }}
        title={`${fmt(p10)} … ${fmt(p50)} … ${fmt(p90)}`}
      >
        {/* baseline */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 6,
            height: 1,
            background: "rgba(20,30,60,0.08)",
          }}
        />
        {/* zero tick */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 3,
            width: 1,
            height: 7,
            background: "rgba(20,30,60,0.18)",
          }}
        />
        {/* range bar */}
        <div
          style={{
            position: "absolute",
            left: `${leftPct}%`,
            width: `${rightPct - leftPct}%`,
            top: 5,
            height: 3,
            background: c.soft,
            borderRadius: 2,
          }}
        />
        {/* p50 tick */}
        <div
          style={{
            position: "absolute",
            left: `calc(${p50Pct}% - 1px)`,
            top: 1,
            width: 2,
            height: 11,
            background: c.fg,
            borderRadius: 1,
          }}
        />
      </div>
    </div>
  );
}

// ── Design E — Pure type, no chrome ───────────────────────────────────
// Just bold colored numerals + tiny gray spread on the same line.
// The most Notion-document-like.
function DesignE({ p10, p50, p90 }: ForecastProps) {
  const pol = polarityFor(p10, p50, p90);
  const c = POL[pol];
  const num = pol === "neutral" ? "—" : fmt(p50);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: c.fg,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {num}
      </span>
      <span
        style={{
          fontSize: 11,
          color: MUTED,
          fontFamily: '"SF Mono", ui-monospace, monospace',
          fontVariantNumeric: "tabular-nums",
        }}
      >
        ±{fmt((p90 - p10) / 2, { sign: false, decimals: 0 })}
      </span>
    </div>
  );
}

// ── App-card mock ────────────────────────────────────────────────────
type AppType = "monitor" | "tool" | "dashboard";

const APP_TYPE_ACCENT: Record<AppType, { fg: string; bg: string }> = {
  monitor: { fg: "#b45309", bg: "#fef3c7" },
  tool: { fg: "#047857", bg: "#d1fae5" },
  dashboard: { fg: "#1d4ed8", bg: "#dbeafe" },
};

function AppCard({
  name,
  appType,
  forecast,
}: {
  name: string;
  appType: AppType;
  forecast: React.ReactNode;
}) {
  const acc = APP_TYPE_ACCENT[appType];
  return (
    <div
      style={{
        width: 232,
        borderRadius: 14,
        background: "#ffffff",
        border: "1px solid rgba(10,30,80,0.07)",
        boxShadow: "0 8px 22px -10px rgba(8,30,80,0.10), 0 2px 6px rgba(8,30,80,0.04)",
        padding: "14px 16px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            padding: "2px 7px",
            borderRadius: 4,
            background: acc.bg,
            color: acc.fg,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          {appType}
        </span>
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: TEXT,
          letterSpacing: "-0.01em",
        }}
      >
        {name}
      </div>
      <div>{forecast}</div>
    </div>
  );
}

// ── Rich preview cards ───────────────────────────────────────────────
// Each rich card mimics the look of an active app dashboard widget
// (icon + big metric + sparkline-style viz) but is labeled "Forecast"
// so it reads as a preview of what the app would render once deployed.

const DAYS_M_S = ["M", "T", "W", "T", "F", "S", "S"];

function BarChart7({
  values,
  color,
  faintColor,
}: {
  values: number[];
  color: string;
  faintColor: string;
}) {
  const W = 138;
  const H = 56;
  const barW = 7;
  const gap = (W - barW * 7) / 6;
  const maxV = Math.max(...values, 1);
  return (
    <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      {values.map((v, i) => {
        const h = Math.max(6, (v / maxV) * H);
        const x = i * (barW + gap);
        const isPeak = v === maxV;
        return (
          <rect
            key={i}
            x={x}
            y={H - h}
            width={barW}
            height={h}
            rx={3.5}
            fill={isPeak ? color : faintColor}
          />
        );
      })}
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={i * (barW + gap) + barW / 2}
          y={H + 13}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

function RingGrid7({
  hits,
  color,
}: {
  hits: boolean[];
  color: string;
}) {
  const W = 138;
  const H = 56;
  const slot = W / 7;
  const r = 8;
  const cy = H - r - 2;
  return (
    <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      {hits.map((hit, i) => {
        const cx = slot * i + slot / 2;
        return (
          <g key={i}>
            <text
              x={cx}
              y={cy - r - 5}
              fontSize="9"
              fill={hit ? "#6b7180" : "#cbd5dc"}
              textAnchor="middle"
              fontFamily="-apple-system, system-ui"
              fontWeight={500}
            >
              {hit ? "✓" : "✕"}
            </text>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={hit ? color : "#dee3eb"}
              strokeWidth={1.8}
            />
          </g>
        );
      })}
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={slot * i + slot / 2}
          y={H + 13}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

function LineChart7({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const W = 138;
  const H = 56;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.01, max - min);
  const points = values.map((v, i) => {
    const x = (i / 6) * W;
    const y = H - ((v - min) / range) * H * 0.85 - 4;
    return { x, y };
  });
  // Smooth path via quadratic curves between mid-points
  const pathParts: string[] = [];
  pathParts.push(`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    pathParts.push(
      `Q ${cx.toFixed(1)} ${prev.y.toFixed(1)} ${cx.toFixed(1)} ${((prev.y + curr.y) / 2).toFixed(1)}`,
    );
    pathParts.push(`Q ${cx.toFixed(1)} ${curr.y.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`);
  }
  const linePath = pathParts.join(" ");
  const fillPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  const gradientId = `lc-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={(i / 6) * W}
          y={H + 13}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor={i === 0 ? "start" : i === 6 ? "end" : "middle"}
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

interface RichCardProps {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  iconColor: string;
  iconBg: string;
  name: string;
  metric: string;
  unit?: string;
  status: string;
  viz: React.ReactNode;
  badge?: string;
}

function RichCard({
  Icon,
  iconColor,
  iconBg,
  name,
  metric,
  unit,
  status,
  viz,
  badge = "Forecast",
}: RichCardProps) {
  return (
    <div
      style={{
        width: 360,
        borderRadius: 22,
        background: "#ffffff",
        border: "1px solid rgba(10,30,80,0.05)",
        boxShadow:
          "0 12px 32px -16px rgba(8,30,80,0.16), 0 4px 12px rgba(8,30,80,0.05)",
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: iconBg,
              display: "grid",
              placeItems: "center",
              color: iconColor,
            }}
          >
            <Icon size={16} strokeWidth={2.2} />
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: TEXT,
              letterSpacing: "-0.015em",
            }}
          >
            {name}
          </span>
        </div>
        <span
          style={{
            fontSize: 12.5,
            color: "rgba(20,30,60,0.45)",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {badge}
          <span style={{ fontSize: 13, opacity: 0.7 }}>›</span>
        </span>
      </header>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 600,
                color: TEXT,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {metric}
            </span>
            {unit && (
              <span
                style={{
                  fontSize: 14,
                  color: "rgba(20,30,60,0.55)",
                  fontWeight: 500,
                }}
              >
                {unit}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: 13,
              color: "rgba(20,30,60,0.55)",
              letterSpacing: "-0.005em",
            }}
          >
            {status}
          </span>
        </div>
        <div>{viz}</div>
      </div>
    </div>
  );
}

// ── Archetype helpers (Section G) ────────────────────────────────────

// Logistic dose-response curve. The dot marks the current dosage.
function DoseResponseCurve({ color, dosePct = 0.62 }: { color: string; dosePct?: number }) {
  const W = 200;
  const H = 64;
  const k = 8;
  const x0 = 0.5;
  const points: [number, number][] = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const y = 1 / (1 + Math.exp(-k * (t - x0)));
    points.push([t * W, H - y * (H - 8) - 4]);
  }
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  // current-dose marker
  const dotX = dosePct * W;
  const dotY = H - (1 / (1 + Math.exp(-k * (dosePct - x0)))) * (H - 8) - 4;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* baseline */}
      <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="rgba(20,30,60,0.08)" strokeWidth={1} />
      {/* curve */}
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* current-dose dot */}
      <circle cx={dotX} cy={dotY} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

// Three horizontal mini-bars with label + percentage (cognition-template-style).
function OutcomeBars({
  items,
  color,
}: {
  items: Array<{ label: string; pct: number }>;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 32px", gap: 8, alignItems: "center" }}>
          <span
            style={{
              fontSize: 11,
              color: "rgba(20,30,60,0.7)",
              letterSpacing: "-0.005em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </span>
          <div style={{ position: "relative", height: 4, background: "rgba(20,30,60,0.06)", borderRadius: 2 }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${it.pct}%`,
                background: color,
                borderRadius: 2,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: "rgba(20,30,60,0.55)",
              fontFamily: '"SF Mono", ui-monospace, monospace',
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
              fontWeight: 500,
            }}
          >
            {it.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

// Seven streak dots with day labels and a numeric tally.
function StreakDots({
  done,
  color,
}: {
  done: boolean[];
  color: string;
}) {
  const W = 138;
  const H = 56;
  const slot = W / 7;
  const r = 6;
  const cy = H / 2;
  return (
    <svg width={W} height={H + 14} viewBox={`0 0 ${W} ${H + 14}`}>
      {done.map((d, i) => (
        <circle
          key={i}
          cx={slot * i + slot / 2}
          cy={cy}
          r={r}
          fill={d ? color : "transparent"}
          stroke={d ? color : "#cdd2da"}
          strokeWidth={1.6}
        />
      ))}
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={slot * i + slot / 2}
          y={H + 11}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

// ── Archetype A · Clinical intervention ──────────────────────────────
function ClinicalCard({
  name,
  subtitle,
  outcomes,
  onset,
  accent,
  Icon,
  iconBg,
  dosePct,
}: {
  name: string;
  subtitle: string;
  outcomes: Array<{ label: string; pct: number }>;
  onset: string;
  accent: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  iconBg: string;
  dosePct: number;
}) {
  return (
    <div
      style={{
        width: 360,
        borderRadius: 18,
        background: "#ffffff",
        border: "1px solid rgba(10,30,80,0.06)",
        boxShadow: "0 12px 32px -16px rgba(8,30,80,0.14), 0 3px 10px rgba(8,30,80,0.04)",
        padding: "18px 20px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* left rail */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: accent,
          opacity: 0.85,
        }}
      />
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: iconBg,
              color: accent,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon size={14} strokeWidth={2.4} />
          </span>
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              background: iconBg,
              color: accent,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            Intervention
          </span>
        </div>
        <span style={{ fontSize: 12, color: "rgba(20,30,60,0.45)", fontWeight: 500 }}>
          Forecast ›
        </span>
      </header>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: "-0.015em" }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: "rgba(20,30,60,0.55)", marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <DoseResponseCurve color={accent} dosePct={dosePct} />
      <OutcomeBars items={outcomes} color={accent} />
      <div
        style={{
          fontSize: 11,
          color: "rgba(20,30,60,0.45)",
          paddingTop: 8,
          borderTop: "1px solid rgba(20,30,60,0.06)",
          fontFamily: '"SF Mono", ui-monospace, monospace',
          letterSpacing: "0.01em",
        }}
      >
        {onset}
      </div>
    </div>
  );
}

// ── Biomarker time-course archetype ───────────────────────────────────

function BiomarkerMiniLine({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const W = 130;
  const H = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.01, max - min);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return [x, y] as [number, number];
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const fillPath = `${path} L ${W} ${H} L 0 ${H} Z`;
  const id = `bm-${color.replace("#", "")}-${values.length}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BiomarkerCard({
  name,
  subtitle,
  biomarkers,
  horizon,
  accent,
  Icon,
  iconBg,
}: {
  name: string;
  subtitle: string;
  biomarkers: Array<{ label: string; values: number[]; color: string; current: string; target: string }>;
  horizon: string;
  accent: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  iconBg: string;
}) {
  return (
    <div
      style={{
        width: 360,
        borderRadius: 18,
        background: "#ffffff",
        border: "1px solid rgba(10,30,80,0.06)",
        boxShadow: "0 12px 32px -16px rgba(8,30,80,0.14), 0 3px 10px rgba(8,30,80,0.04)",
        padding: "18px 20px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: accent,
          opacity: 0.85,
        }}
      />
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: iconBg,
              color: accent,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon size={14} strokeWidth={2.4} />
          </span>
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              background: iconBg,
              color: accent,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            Biomarkers
          </span>
        </div>
        <span style={{ fontSize: 12, color: "rgba(20,30,60,0.45)", fontWeight: 500 }}>
          Forecast ›
        </span>
      </header>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: "-0.015em" }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: "rgba(20,30,60,0.55)", marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {biomarkers.map((bm, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "78px 1fr 70px",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(20,30,60,0.7)" }}>
              {bm.label}
            </span>
            <BiomarkerMiniLine values={bm.values} color={bm.color} />
            <span
              style={{
                fontSize: 10,
                color: "rgba(20,30,60,0.55)",
                fontFamily: '"SF Mono", ui-monospace, monospace',
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            >
              {bm.current}
              <span style={{ opacity: 0.5 }}> → {bm.target}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "rgba(20,30,60,0.45)",
          paddingTop: 8,
          borderTop: "1px solid rgba(20,30,60,0.06)",
          fontFamily: '"SF Mono", ui-monospace, monospace',
          letterSpacing: "0.01em",
        }}
      >
        {horizon}
      </div>
    </div>
  );
}

// ── Social cohort archetype ───────────────────────────────────────────

function CohortAvatars({ colors, total }: { colors: string[]; total: number }) {
  const visible = colors.slice(0, 5);
  const overflow = total - visible.length;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {visible.map((c, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: c,
            border: "2px solid #fff",
            marginLeft: i === 0 ? 0 : -10,
            zIndex: visible.length - i,
            boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
          }}
        />
      ))}
      {overflow > 0 && (
        <div
          style={{
            marginLeft: -10,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "#f1f5f9",
            border: "2px solid #fff",
            display: "grid",
            placeItems: "center",
            fontSize: 10,
            fontWeight: 600,
            color: "#475569",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ── examples ─────────────────────────────────────────────────────────
const STATES: Array<{
  name: string;
  appType: AppType;
  p10: number;
  p50: number;
  p90: number;
}> = [
  { name: "Sleep tracker", appType: "monitor", p10: 0.05, p50: 0.12, p90: 0.18 },
  { name: "Caffeine logger", appType: "tool", p10: -0.13, p50: -0.08, p90: -0.03 },
  { name: "Mood journal", appType: "dashboard", p10: -0.12, p50: 0.01, p90: 0.16 },
];

const DESIGNS: Array<{
  id: string;
  title: string;
  caption: string;
  Component: React.FC<ForecastProps>;
}> = [
  {
    id: "A",
    title: "Tag pill",
    caption: "Notion-style status tag. Soft fill, colored text.",
    Component: DesignA,
  },
  {
    id: "B",
    title: "Stock ticker",
    caption: "Apple Stocks. Big number + directional arrow.",
    Component: DesignB,
  },
  {
    id: "C",
    title: "Dot + line",
    caption: "Linear / Figma. Tiny solid dot, plain text.",
    Component: DesignC,
  },
  {
    id: "D",
    title: "Number line",
    caption: "Range bar centered on zero. Position = polarity.",
    Component: DesignD,
  },
  {
    id: "E",
    title: "Pure type",
    caption: "No chrome at all. Bold numeral + spread.",
    Component: DesignE,
  },
];

// ── page ─────────────────────────────────────────────────────────────
export default function ForecastBrainstormPreflight() {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        fontFamily:
          '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        color: TEXT,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, #fafbff 0%, #f3f5fa 60%, #ecf0f6 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "80px 56px 120px",
          display: "flex",
          flexDirection: "column",
          gap: 56,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(20,30,60,0.45)",
            }}
          >
            forecast indicator · brainstorm
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            Five directions. Pick one.
          </h1>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.55,
              color: "rgba(20,30,60,0.62)",
              maxWidth: 600,
              margin: 0,
            }}
          >
            Each row is one design. Each column is the same three states:
            expected upside, expected downside, uncertain.
          </p>
        </header>

        {/* Each design as a row */}
        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
          {DESIGNS.map((d) => (
            <section key={d.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(20,30,60,0.4)",
                    fontFamily: '"SF Mono", ui-monospace, monospace',
                  }}
                >
                  {d.id}
                </span>
                <h2
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: "-0.015em",
                    margin: 0,
                  }}
                >
                  {d.title}
                </h2>
                <span
                  style={{
                    fontSize: 13,
                    color: "rgba(20,30,60,0.55)",
                  }}
                >
                  {d.caption}
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {STATES.map((s, i) => (
                  <AppCard
                    key={i}
                    name={s.name}
                    appType={s.appType}
                    forecast={
                      <d.Component p10={s.p10} p50={s.p50} p90={s.p90} />
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* ── 6th direction: rich preview cards ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(20,30,60,0.45)",
              }}
            >
              F · preview as deployed
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              The proposal looks like the app it would become.
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "rgba(20,30,60,0.6)",
                margin: 0,
                maxWidth: 640,
                lineHeight: 1.5,
              }}
            >
              Same shape as a deployed dashboard widget — icon, big number,
              caption, sparkline. The only difference is the top-right
              label says <em>Forecast</em> instead of <em>Today</em>, and
              the data is the simulator&apos;s prediction, not user
              telemetry.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, max-content)",
              gap: 24,
            }}
          >
            <RichCard
              Icon={Moon}
              iconColor="#b45309"
              iconBg="#fef3c7"
              name="Sleep"
              metric="6.5"
              unit="hr"
              status="Restful nights expected"
              viz={
                <RingGrid7
                  hits={[true, true, true, true, false, true, true]}
                  color="#f59e0b"
                />
              }
            />
            <RichCard
              Icon={Coffee}
              iconColor="#7c5841"
              iconBg="#f0e3d4"
              name="Caffeine"
              metric="145"
              unit="mg"
              status="Below threshold"
              viz={
                <BarChart7
                  values={[0.95, 0.78, 0.6, 0.52, 0.4, 0.32, 0.28]}
                  color="#a07550"
                  faintColor="#e3d2bf"
                />
              }
            />
            <RichCard
              Icon={Smile}
              iconColor="#7c3aed"
              iconBg="#ede9fe"
              name="Mood"
              metric="7.2"
              unit="/ 10"
              status="Stable upward"
              viz={
                <LineChart7
                  values={[5.2, 5.6, 6.0, 6.3, 6.8, 7.0, 7.2]}
                  color="#8b5cf6"
                />
              }
            />
            <RichCard
              Icon={Droplets}
              iconColor="#1d4ed8"
              iconBg="#dbeafe"
              name="Hydration"
              metric="2,400"
              unit="ml"
              status="On target"
              viz={
                <BarChart7
                  values={[0.65, 0.78, 0.85, 0.92, 0.88, 0.95, 1.0]}
                  color="#3b82f6"
                  faintColor="#bfd6fa"
                />
              }
            />
          </div>
        </section>

        {/* ── Section G: archetype library ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(20,30,60,0.45)",
              }}
            >
              G · archetype library
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              The card adapts to what the app actually is.
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "rgba(20,30,60,0.6)",
                margin: 0,
                maxWidth: 700,
                lineHeight: 1.55,
              }}
            >
              No single shape works for every app. The Twin&apos;s domain
              template declares which archetypes are allowed, and a{" "}
              <strong>CardGenerator agent</strong> picks one per app at
              T7 based on what kind of intervention it is. Four shown
              here, more can be added.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, max-content)",
              gap: 24,
            }}
          >
            {/* Consumer Health archetype */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                consumer health
              </span>
              <RichCard
                Icon={Moon}
                iconColor="#b45309"
                iconBg="#fef3c7"
                name="Sleep"
                metric="6.5"
                unit="hr"
                status="Restful nights expected"
                viz={
                  <RingGrid7
                    hits={[true, true, true, true, false, true, true]}
                    color="#f59e0b"
                  />
                }
              />
            </div>

            {/* Clinical Intervention archetype */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                clinical intervention
              </span>
              <ClinicalCard
                Icon={Activity}
                iconBg="#ede9fe"
                accent="#7c3aed"
                name="Structured Exercise"
                subtitle="150 min/wk · Anti-inflammatory"
                dosePct={0.62}
                outcomes={[
                  { label: "IL-6 reduction", pct: 42 },
                  { label: "Fatigue", pct: 31 },
                  { label: "Cortisol", pct: 15 },
                ]}
                onset="Onset 2w · Plateau 20w"
              />
            </div>

            {/* Workflow / Habit archetype */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                workflow · habit
              </span>
              <RichCard
                Icon={PenLine}
                iconColor="#0284c7"
                iconBg="#e0f2fe"
                name="Mood journal"
                metric="6"
                unit="of 7"
                status="Daily · 3 min · 8 AM"
                viz={
                  <StreakDots
                    done={[true, true, true, false, true, true, true]}
                    color="#0284c7"
                  />
                }
              />
            </div>

            {/* Game / Progression archetype */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                game · progression
              </span>
              <RichCard
                Icon={Brain}
                iconColor="#be185d"
                iconBg="#fce7f3"
                name="Cognitive training"
                metric="L4"
                unit="→ L5"
                status="3×/wk · Working memory"
                viz={
                  <div style={{ width: 138, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div
                      style={{
                        position: "relative",
                        height: 7,
                        borderRadius: 4,
                        background: "rgba(20,30,60,0.06)",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          width: "62%",
                          height: "100%",
                          borderRadius: 4,
                          background: "#ec4899",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        color: "rgba(20,30,60,0.5)",
                        fontFamily: '"SF Mono", ui-monospace, monospace',
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span>850</span>
                      <span>best 920</span>
                      <span>1100</span>
                    </div>
                  </div>
                }
              />
            </div>
          </div>

          {/* Auto-agent explainer */}
          <div
            style={{
              marginTop: 12,
              padding: 20,
              borderRadius: 14,
              background: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(20,30,60,0.05)",
              fontSize: 13,
              lineHeight: 1.6,
              color: "rgba(20,30,60,0.7)",
              maxWidth: 760,
            }}
          >
            <strong style={{ color: TEXT }}>How an app gets its card.</strong>{" "}
            At T7 the <code>CardGenerator</code> agent reads (a) the App
            row + manifest, (b) the Twin&apos;s domain template (which
            declares allowed archetypes — cognition→clinical, sleep→
            consumer-health, habits→workflow, etc.), and (c) the
            simulator&apos;s output shape (single endpoint vs. multiple
            outcomes vs. progression metric). It picks an archetype,
            maps simulator output → archetype slots, and persists a{" "}
            <code>card_spec</code> JSON on the App row. The renderer is
            dumb — it just reads the spec. Users can override (swap
            archetype, edit metric labels, choose a different viz)
            per-app and the override sticks.
          </div>
        </section>

        {/* ── Section H: same app, three archetypes ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(20,30,60,0.45)",
              }}
            >
              H · how the agent picks
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              Same app. Three valid renderings. Agent picks one.
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "rgba(20,30,60,0.6)",
                margin: 0,
                maxWidth: 700,
                lineHeight: 1.55,
              }}
            >
              <strong>Mediterranean Diet</strong> rendered three ways. In
              the cognition domain template the simulator returns
              biomarker outcomes (LDL, CRP, HbA1c), so the agent picks{" "}
              <em>clinical-intervention</em>. If the same app belonged to
              a wellness domain that returned only an adherence score,
              the agent would pick <em>consumer-health</em> instead.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, max-content)",
              gap: 20,
            }}
          >
            {/* Pick 1: Clinical (the agent's choice) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "#7c3aed",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                ✓ agent&apos;s pick · clinical
              </span>
              <ClinicalCard
                Icon={Activity}
                iconBg="#ede9fe"
                accent="#7c3aed"
                name="Mediterranean Diet"
                subtitle="Score ≥ 7 · Anti-inflammatory dietary"
                dosePct={0.55}
                outcomes={[
                  { label: "LDL cholesterol", pct: 34 },
                  { label: "CRP", pct: 28 },
                  { label: "HbA1c", pct: 22 },
                ]}
                onset="Onset 4w · Plateau 24w"
              />
            </div>

            {/* Pick 2: Consumer health */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                alternative · consumer
              </span>
              <RichCard
                Icon={Activity}
                iconColor="#7c3aed"
                iconBg="#ede9fe"
                name="Mediterranean Diet"
                metric="7.4"
                unit="/ 10"
                status="Adherence score"
                viz={
                  <BarChart7
                    values={[0.65, 0.72, 0.78, 0.74, 0.85, 0.8, 0.82]}
                    color="#8b5cf6"
                    faintColor="#dccffb"
                  />
                }
              />
            </div>

            {/* Pick 3: Workflow */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                alternative · workflow
              </span>
              <RichCard
                Icon={Activity}
                iconColor="#7c3aed"
                iconBg="#ede9fe"
                name="Mediterranean Diet"
                metric="6"
                unit="of 7"
                status="Daily meal log · 30 sec"
                viz={
                  <StreakDots
                    done={[true, true, false, true, true, true, true]}
                    color="#8b5cf6"
                  />
                }
              />
            </div>
          </div>

          {/* Decision rationale */}
          <div
            style={{
              marginTop: 4,
              padding: "16px 20px",
              borderRadius: 12,
              background: "rgba(124,58,237,0.06)",
              border: "1px solid rgba(124,58,237,0.18)",
              fontSize: 12.5,
              lineHeight: 1.65,
              color: "rgba(20,30,60,0.78)",
              maxWidth: 760,
              fontFamily:
                '-apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
            }}
          >
            <strong style={{ color: "#7c3aed" }}>Agent decision trace.</strong>{" "}
            <code>simulation.kind</code> = <code>multi-endpoint</code>{" "}
            (LDL, CRP, HbA1c) → forces{" "}
            <code>clinical-intervention</code> (rule 1, lossless mapping).{" "}
            Validated against <code>domainPolicy.allowedArchetypes</code>{" "}
            for cognition: passes. The other two renderings would lose
            the multi-endpoint information, so they&apos;re rejected
            even though they&apos;re also valid for the cognition
            domain.
          </div>

          {/* Schema pointer */}
          <div
            style={{
              padding: 18,
              borderRadius: 12,
              background: "rgba(20,30,60,0.04)",
              border: "1px solid rgba(20,30,60,0.06)",
              fontSize: 12.5,
              lineHeight: 1.7,
              color: "rgba(20,30,60,0.7)",
              maxWidth: 760,
              fontFamily: '"SF Mono", ui-monospace, monospace',
            }}
          >
            <span
              style={{
                fontFamily:
                  '-apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
                fontWeight: 600,
                color: TEXT,
              }}
            >
              Schema
            </span>{" "}
            ·{" "}
            <code>src/types/card-spec.ts</code> — discriminated union
            for <code>CardSpec</code>, slot shapes per archetype, the
            agent&apos;s input/output contract, and a reference{" "}
            <code>defaultArchetypeFor()</code> implementation. The
            archetype list extends without rewriting existing renderers.
          </div>
        </section>

        {/* ── Section I: two more archetypes from the library ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(20,30,60,0.45)",
              }}
            >
              I · two more from the library
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              When clinical doesn&apos;t go far enough.
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "rgba(20,30,60,0.6)",
                margin: 0,
                maxWidth: 700,
                lineHeight: 1.55,
              }}
            >
              <strong>Biomarker time-course</strong> for cognition apps
              where the simulator returns trajectories instead of point
              outcomes. <strong>Social cohort</strong> for group programs
              where adherence is the dominant signal, not biomarker
              change.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, max-content)",
              gap: 24,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                biomarker · time-course
              </span>
              <BiomarkerCard
                Icon={FlaskConical}
                iconBg="#fde7ef"
                accent="#be185d"
                name="MBSR · 8-wk protocol"
                subtitle="Stress → HPA cascade · weekly biomarker draw"
                horizon="12-week trajectory · weekly samples"
                biomarkers={[
                  {
                    label: "IL-6",
                    color: "#be185d",
                    current: "3.8",
                    target: "2.1",
                    values: [0.95, 0.92, 0.88, 0.79, 0.7, 0.61, 0.5, 0.44, 0.4, 0.38, 0.36, 0.35],
                  },
                  {
                    label: "Cortisol AM",
                    color: "#0891b2",
                    current: "18.4",
                    target: "12.0",
                    values: [0.9, 0.88, 0.84, 0.81, 0.74, 0.68, 0.62, 0.56, 0.52, 0.5, 0.48, 0.46],
                  },
                  {
                    label: "BDNF",
                    color: "#65a30d",
                    current: "22.1",
                    target: "32.0",
                    values: [0.3, 0.32, 0.36, 0.42, 0.48, 0.55, 0.6, 0.66, 0.72, 0.76, 0.8, 0.84],
                  },
                ]}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "rgba(20,30,60,0.4)",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  textTransform: "uppercase",
                }}
              >
                social · cohort
              </span>
              <RichCard
                Icon={Users}
                iconColor="#0d9488"
                iconBg="#ccfbf1"
                name="Group therapy"
                metric="13"
                unit="/ 15"
                status="Low dropout · 4 wk in"
                badge="Forecast"
                viz={
                  <CohortAvatars
                    total={15}
                    colors={[
                      "#fb923c",
                      "#a78bfa",
                      "#34d399",
                      "#f472b6",
                      "#60a5fa",
                    ]}
                  />
                }
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
