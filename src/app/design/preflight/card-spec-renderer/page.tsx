"use client";

// /design/preflight/card-spec-renderer
//
// End-to-end test of the CardSpecRenderer dispatch path. Every
// archetype rendered as both an "expanded" lab-style widget and a
// "compact" canvas-shape-sized chip, in both "forecast" and "live"
// modes. If any rendering issue exists, this page surfaces it before
// the canvas drop or lab panel does.
//
// The mock specs are hand-authored, mirroring the JSON the
// CardGenerator agent will produce at T7. Keep these examples in sync
// with realistic agent output so the page also serves as a contract
// reference.

import { CardSpecRenderer } from "@/components/cards";
import type { CardSpec } from "@/types/card-spec";

const SPECS: Array<{ id: string; label: string; spec: CardSpec }> = [
  {
    id: "consumer-health",
    label: "Consumer health · Sleep monitor",
    spec: {
      archetype: "consumer-health",
      header: {
        icon: "moon",
        iconFg: "#b45309",
        iconBg: "#fef3c7",
        name: "Sleep tracker",
        badge: "Forecast",
      },
      slots: {
        metric: "6.5",
        unit: "hr",
        status: "Restful nights expected",
        viz: {
          kind: "ring-grid",
          hits: [true, true, true, true, false, true, true],
          color: "#f59e0b",
        },
      },
    },
  },
  {
    id: "clinical-intervention",
    label: "Clinical intervention · MBSR",
    spec: {
      archetype: "clinical-intervention",
      header: {
        icon: "stethoscope",
        iconFg: "#be185d",
        iconBg: "#fde7ef",
        name: "MBSR · 8-wk protocol",
        badge: "Forecast",
      },
      slots: {
        subtitle: "150 min/wk · Stress reduction",
        dosePct: 0.62,
        outcomes: [
          { label: "Perceived stress", pct: 68 },
          { label: "Sleep quality", pct: 52 },
          { label: "Affect balance", pct: 41 },
        ],
        onsetCopy: "Onset 2w · Plateau 8w",
        accent: "#be185d",
      },
    },
  },
  {
    id: "workflow-habit",
    label: "Workflow habit · Daily journaling",
    spec: {
      archetype: "workflow-habit",
      header: {
        icon: "zap",
        iconFg: "#047857",
        iconBg: "#d1fae5",
        name: "Daily journal",
        badge: "Forecast",
      },
      slots: {
        count: "6",
        outOf: "of 7",
        cadenceCopy: "Daily · 3 min · 8 AM",
        streak: [true, true, true, false, true, true, true],
        color: "#10b981",
      },
    },
  },
  {
    id: "game-progression",
    label: "Game progression · Working memory",
    spec: {
      archetype: "game-progression",
      header: {
        icon: "game",
        iconFg: "#7c3aed",
        iconBg: "#ede9fe",
        name: "N-Back trainer",
        badge: "Forecast",
      },
      slots: {
        currentLevel: "L4",
        nextLevel: "L5",
        progress: 0.62,
        cadenceCopy: "3×/wk · Working memory",
        scoreRange: [0, 24],
        best: 18,
        color: "#7c3aed",
      },
    },
  },
  {
    id: "biomarker-time-course",
    label: "Biomarker time-course · MBSR labs",
    spec: {
      archetype: "biomarker-time-course",
      header: {
        icon: "flask",
        iconFg: "#be185d",
        iconBg: "#fde7ef",
        name: "MBSR · biomarker panel",
        badge: "Forecast",
      },
      slots: {
        subtitle: "Stress → HPA cascade · weekly biomarker draw",
        biomarkers: [
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
        ],
        horizon: "12-week trajectory · weekly samples",
      },
    },
  },
  {
    id: "social-cohort",
    label: "Social cohort · Group therapy",
    spec: {
      archetype: "social-cohort",
      header: {
        icon: "users",
        iconFg: "#0d9488",
        iconBg: "#ccfbf1",
        name: "Group therapy · 8-wk MBSR",
        badge: "Forecast",
      },
      slots: {
        subtitle: "8-wk MBSR · group of 15",
        cohortSize: 15,
        attending: 13,
        status: "Low dropout · 4 wk in",
        avatarColors: ["#fb923c", "#a78bfa", "#34d399", "#f472b6", "#60a5fa"],
        color: "#0d9488",
      },
    },
  },
];

export default function CardSpecRendererPreflight() {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        background: "#fafafb",
        fontFamily:
          '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        color: "#1a1f2c",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "64px 48px 120px",
          display: "flex",
          flexDirection: "column",
          gap: 56,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(20,30,60,0.45)",
            }}
          >
            CardSpecRenderer · dispatch test
          </div>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            Every archetype, every mode, every size.
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "rgba(20,30,60,0.6)",
              margin: 0,
              maxWidth: 680,
              lineHeight: 1.55,
            }}
          >
            The dispatcher reads the spec&apos;s <code>archetype</code>{" "}
            discriminator and routes to the right renderer. Each row
            below shows the same spec rendered four ways: expanded
            forecast (lab/dashboard), expanded live (deployed app), and
            two compact variants (canvas card).
          </p>
        </header>

        {SPECS.map(({ id, label, spec }) => (
          <section key={id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(20,30,60,0.5)",
              }}
            >
              {label}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 240px 240px",
                gap: 24,
                alignItems: "start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Caption>Expanded · Forecast</Caption>
                <CardSpecRenderer spec={spec} mode="forecast" size="expanded" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Caption>Expanded · Live</Caption>
                <CardSpecRenderer spec={spec} mode="live" size="expanded" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Caption>Compact · Forecast</Caption>
                <div style={{ width: 220, minHeight: 196 }}>
                  <CardSpecRenderer spec={spec} mode="forecast" size="compact" />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Caption>Compact · Live</Caption>
                <div style={{ width: 220, minHeight: 196 }}>
                  <CardSpecRenderer spec={spec} mode="live" size="compact" />
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "rgba(20,30,60,0.42)",
      }}
    >
      {children}
    </span>
  );
}
