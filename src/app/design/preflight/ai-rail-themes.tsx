"use client";

// AI Rail · theme exploration.
//
// Three side-by-side variants of the right-side AI rail (the panel
// shown in synergy-ai-rail.tsx). Same content + structure across all
// three — only the surface treatment changes — so the user can pick
// the direction that feels right before we wire it into the real
// component.
//
//   A. Pure frosted white + warm neutrals (most Apple-native)
//   B. Soft warm tint                     (champagne wash, "designed")
//   C. Glass token system                 (uses --glass-* tokens from
//                                          globals.css, gets dark-mode
//                                          support for free)
//
// All three render the same six pieces of rail content (attach
// target, precision slider, divider, mode links, empty state,
// autopilot row) so the comparison isolates pure aesthetics.

import { HelpCircle, Wand2, ChevronRight } from "lucide-react";

// ── Theme contract ────────────────────────────────────────────────
//
// Each variant fills in this set of values; the RailMock below
// renders identical structure with these substituted in.

type Theme = {
  // The rail surface itself
  railBg: string;
  railBackdropFilter: string;
  railBorderLeft: string;

  // Section "card" (used by attach-target + autopilot rows)
  cardBg: string;
  cardShadow: string;

  // Type
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textMonoCap: string; // small caps eyebrow

  // Empty-state card
  emptyBorder: string;
  emptyBg: string;

  // Hairline divider between zones
  dividerBg: string;

  // Slider accent (range thumb/fill)
  sliderAccent: string;

  // Inline · separator between mode links
  modeSeparator: string;
};

const themeA: Theme = {
  railBg: "rgba(255, 255, 255, 0.78)",
  railBackdropFilter: "blur(24px) saturate(180%)",
  railBorderLeft: "0.5px solid rgba(0, 0, 0, 0.04)",
  cardBg: "rgba(255, 255, 255, 0.95)",
  cardShadow:
    "0 0 0 1px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04)",
  textPrimary: "#1d1d1f",
  textSecondary: "rgba(60, 60, 67, 0.6)",
  textTertiary: "rgba(60, 60, 67, 0.4)",
  textMonoCap: "rgba(60, 60, 67, 0.55)",
  emptyBorder: "1px solid rgba(0, 0, 0, 0.06)",
  emptyBg: "rgba(255, 255, 255, 0.5)",
  dividerBg: "rgba(0, 0, 0, 0.04)",
  sliderAccent: "#1d1d1f",
  modeSeparator: "rgba(60, 60, 67, 0.25)",
};

const themeB: Theme = {
  railBg:
    "linear-gradient(180deg, rgba(252, 250, 247, 0.88) 0%, rgba(249, 246, 242, 0.78) 100%)",
  railBackdropFilter: "blur(24px) saturate(180%)",
  railBorderLeft: "0.5px solid rgba(120, 100, 60, 0.06)",
  cardBg: "rgba(255, 255, 255, 0.92)",
  cardShadow:
    "0 0 0 1px rgba(120, 100, 60, 0.05), 0 1px 2px rgba(120, 100, 60, 0.04)",
  textPrimary: "#1d1d1f",
  textSecondary: "rgba(74, 60, 40, 0.62)",
  textTertiary: "rgba(74, 60, 40, 0.42)",
  textMonoCap: "rgba(120, 100, 60, 0.55)",
  emptyBorder: "1px solid rgba(120, 100, 60, 0.08)",
  emptyBg: "rgba(255, 253, 250, 0.6)",
  dividerBg: "rgba(120, 100, 60, 0.06)",
  sliderAccent: "#3a2f1d",
  modeSeparator: "rgba(120, 100, 60, 0.28)",
};

// Variant C uses var() tokens from globals.css so it inherits theme
// (light → frost, dark → smoke) automatically.
const themeC: Theme = {
  railBg: "var(--glass-float-bg)",
  railBackdropFilter: "blur(var(--blur-float)) saturate(180%)",
  railBorderLeft: "1px solid var(--glass-border)",
  cardBg: "var(--glass-card-bg)",
  cardShadow: "var(--shadow-card)",
  textPrimary: "#0a1020",
  textSecondary: "rgba(85, 100, 121, 0.85)",
  textTertiary: "rgba(85, 100, 121, 0.55)",
  textMonoCap: "rgba(85, 100, 121, 0.85)",
  emptyBorder: "1px solid var(--glass-border)",
  emptyBg: "var(--glass-plate-bg)",
  dividerBg: "var(--glass-hairline)",
  sliderAccent: "#086ce8",
  modeSeparator: "var(--glass-border)",
};

// ── Mock rail body ────────────────────────────────────────────────
//
// Mirrors the structure of <SynergyAIRail> but with hard-coded text
// so it stays static and self-contained. The visual treatment is
// driven entirely by the `theme` prop.

function RailMock({ theme }: { theme: Theme }) {
  return (
    <aside
      style={{
        width: 300,
        height: 540,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 16,
        overflow: "hidden",
        background: theme.railBg,
        backdropFilter: theme.railBackdropFilter,
        WebkitBackdropFilter: theme.railBackdropFilter,
        borderLeft: theme.railBorderLeft,
        borderRadius: 12,
      }}
    >
      {/* Attach-target card */}
      <div
        style={{
          borderRadius: 12,
          background: theme.cardBg,
          boxShadow: theme.cardShadow,
          padding: "10px 12px",
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
          <span style={monoCap(theme)}>Will attach under</span>
          <span style={{ ...monoCap(theme), fontSize: 9, opacity: 0.7 }}>
            Seed · fallback
          </span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            fontWeight: 500,
            color: theme.textPrimary,
            letterSpacing: "-0.005em",
          }}
        >
          Your idea
        </div>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 10.5,
            lineHeight: 1.4,
            color: theme.textSecondary,
          }}
        >
          Select a card on the canvas to attach under it instead.
        </p>
      </div>

      {/* Precision slider row */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={monoCap(theme)}>Precision</span>
            <HelpCircle
              size={11}
              strokeWidth={1.5}
              style={{ color: theme.textTertiary }}
            />
          </div>
          <span style={{ ...monoCap(theme), color: theme.textPrimary }}>
            Lv 3 · Balanced
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          defaultValue={3}
          aria-label="precision demo"
          style={{
            marginTop: 6,
            width: "100%",
            height: 2,
            accentColor: theme.sliderAccent,
          }}
        />
      </div>

      {/* Hairline */}
      <div style={{ height: 1, background: theme.dividerBg }} />

      {/* Mode links */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "4px 12px",
          fontSize: 12,
          color: theme.textPrimary,
        }}
      >
        <span style={{ fontWeight: 500 }}>Decompose</span>
        <span style={{ color: theme.modeSeparator }}>·</span>
        <span style={{ fontWeight: 500 }}>Questions</span>
        <span style={{ color: theme.modeSeparator }}>·</span>
        <span style={{ fontWeight: 500 }}>Research</span>
      </div>

      {/* Empty state */}
      <div
        style={{
          borderRadius: 12,
          border: theme.emptyBorder,
          background: theme.emptyBg,
          padding: "20px 16px",
          textAlign: "center",
          fontSize: 11.5,
          lineHeight: 1.45,
          color: theme.textSecondary,
        }}
      >
        <Wand2
          size={18}
          strokeWidth={1.5}
          style={{
            display: "block",
            margin: "0 auto 6px",
            color: theme.textTertiary,
          }}
        />
        Speak freely or run a mode above. Then click any generated idea
        to add it onto the board.
      </div>

      {/* Spacer pushes autopilot to the bottom */}
      <div style={{ flex: 1 }} />

      {/* Autopilot row (collapsed) */}
      <div
        style={{
          borderRadius: 12,
          background: theme.cardBg,
          boxShadow: theme.cardShadow,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChevronRight
            size={11}
            strokeWidth={1.5}
            style={{ color: theme.textTertiary }}
          />
          <span style={monoCap(theme)}>Autopilot</span>
          <span style={{ fontSize: 11, color: theme.textPrimary }}>
            3 rounds
          </span>
        </div>
      </div>
    </aside>
  );
}

function monoCap(theme: Theme): React.CSSProperties {
  return {
    fontFamily: '"SF Mono", ui-monospace, monospace',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: theme.textMonoCap,
  };
}

// ── Section export ────────────────────────────────────────────────

export function AIRailThemesSection() {
  const variants: Array<{
    letter: string;
    title: string;
    tagline: string;
    notes: string[];
    theme: Theme;
  }> = [
    {
      letter: "A",
      title: "Pure frosted white",
      tagline: "Apple-native · warm neutrals",
      notes: [
        "Rail bg: frosted white 78% — drops the gray tint that fights with white cards.",
        "Section cards: white + dual hairline shadow (no gray fill, no harsh border).",
        "Type: warm near-black #1d1d1f primary, Apple secondary-label grays.",
        "Left edge: 0.5px hairline at 4% opacity — present but not a wall.",
        "Empty state: solid soft border (no more dashed dev-feel).",
      ],
      theme: themeA,
    },
    {
      letter: "B",
      title: "Soft warm tint",
      tagline: "Champagne wash · intentional",
      notes: [
        "Rail bg: vertical champagne gradient — reads as 'designed', stays calm.",
        "Cards stay pure white so they pop softly off the wash.",
        "Type carries a faint warm undertone (rgba(74,60,40,…)) for cohesion.",
        "Trade-off: slight risk of clashing with the cool-blue accent system.",
      ],
      theme: themeB,
    },
    {
      letter: "C",
      title: "Glass token system",
      tagline: "Uses --glass-* · dark-mode for free",
      notes: [
        "Rail bg: var(--glass-float-bg) + var(--blur-float) — proper depth tier.",
        "Cards: var(--glass-card-bg) + var(--shadow-card) — token-driven.",
        "Inherits [data-theme=\"dark\"] automatically (smoke glass below).",
        "Most architecturally correct; least bespoke control over the look.",
      ],
      theme: themeC,
    },
  ];

  return (
    <section
      style={{
        maxWidth: 1480,
        margin: "0 auto",
        padding: "0 48px 96px",
      }}
    >
      <header
        style={{
          marginBottom: 24,
          padding: "20px 0",
          borderTop: "1px solid rgba(15,23,42,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(85,100,121,0.85)",
              margin: 0,
            }}
          >
            AI rail · theme exploration
          </h2>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#086ce8",
              padding: "2px 7px",
              borderRadius: 999,
              background: "rgba(8,108,232,0.08)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            3 variants · pick one
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "#556479",
            lineHeight: 1.55,
            maxWidth: 880,
          }}
        >
          Same rail content (attach-target card, precision slider, mode
          links, empty state, autopilot row) rendered in three surface
          treatments. The current production rail uses pale gray
          tinted bg with gray-50/60 section cards and dashed empty
          states — feels muddy + dev-tool. These three each fix that
          differently.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 24,
        }}
      >
        {variants.map((v) => (
          <VariantColumn key={v.letter} variant={v} />
        ))}
      </div>
    </section>
  );
}

function VariantColumn({
  variant,
}: {
  variant: {
    letter: string;
    title: string;
    tagline: string;
    notes: string[];
    theme: Theme;
  };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#086ce8",
              letterSpacing: "-0.02em",
            }}
          >
            {variant.letter}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#0a1020",
              letterSpacing: "-0.01em",
            }}
          >
            {variant.title}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#556479",
            letterSpacing: "0.02em",
          }}
        >
          {variant.tagline}
        </div>
      </div>

      {/* Backdrop so the rail's translucence reads as translucent.
          Mirrors the canvas-ish surface the real rail sits on. */}
      <div
        style={{
          padding: 12,
          borderRadius: 16,
          background:
            "radial-gradient(circle at 20% 30%, #eef2f9 0%, #e6ecf6 100%)",
          border: "1px solid rgba(15,23,42,0.04)",
        }}
      >
        <RailMock theme={variant.theme} />
      </div>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {variant.notes.map((n, i) => (
          <li
            key={i}
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: "#3f4a5e",
              paddingLeft: 10,
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 8,
                width: 3,
                height: 3,
                borderRadius: "50%",
                background: "#086ce8",
              }}
            />
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}
