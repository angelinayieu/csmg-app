"use client";

// /design/preflight — design system QA harness.
//
// Single-purpose dev page that renders every rail + probe-trail
// primitive in isolation, plus composed examples of the right rail
// (Ambient mode) and a probe rabbit-hole trail.
//
// The point: get tokens, materials, motion right BEFORE wiring any
// data sources. Quality at this scale degrades from the *edges
// between elements* — looking at them adjacent in this harness
// catches what looks-fine-in-Figma-cheap-in-the-browser before it
// ships.
//
// Reach via http://localhost:3000/design/preflight (no auth gate).

import { useState } from "react";
import {
  Sparkles,
  Search,
  FileText,
  Brain,
  Plug,
  AlertTriangle,
  Pin,
  X,
  ArrowUpRight,
  Settings,
  Pause,
} from "lucide-react";
import {
  RailSection,
  RailDivider,
  StateCard,
  LiveCard,
  ActionChip,
  CountBadge,
  StreamingDot,
} from "@/components/canvas/rail/primitives";
import {
  TrailNode,
  TrailEdge,
  TrailBadge,
  type TrailNodePhase,
  type TrailNodeIcon,
} from "@/components/canvas/probe-trail/primitives";
import { StoryboardFrame } from "./storyboard-frame";
import { STORYBOARD_FRAMES } from "./storyboard-data";
import { RoomsStripSection } from "./rooms-strip";

export default function PreflightPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
        fontFamily:
          '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        color: "#0a1020",
      }}
    >
      <PreflightHeader />
      <main
        style={{
          maxWidth: 1480,
          margin: "0 auto",
          padding: "32px 48px 96px",
          display: "grid",
          gridTemplateColumns: "minmax(560px, 1fr) 380px",
          gap: 48,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
          <TokensSection />
          <PrimitivesSection />
          <ProbeTrailSection />
        </div>
        <RailComposedColumn />
      </main>

      {/* Stage Rooms — current production rendering vs upgraded design-
          system version. Same data, two materials. Sits above the
          connected-vision storyboard so the user sees the substrate
          before it gets composed into a full flow. */}
      <RoomsStripSection />

      {/* Connected vision spans the full page width — its own section
          below the primitive QA grid. Walks a Mind-Body-Cognition prompt
          through 5 frames showing canvas + rail + rooms evolving together. */}
      <ConnectedVisionSection />
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────

function PreflightHeader() {
  return (
    <header
      style={{
        padding: "24px 48px",
        borderBottom: "1px solid rgba(15,23,42,0.04)",
        display: "flex",
        alignItems: "baseline",
        gap: 16,
      }}
    >
      <h1
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: 0,
        }}
      >
        Rail + Probe Trail · Design Pre-flight
      </h1>
      <span style={{ fontSize: 11, color: "#556479", letterSpacing: "0.02em" }}>
        primitives in isolation · composed examples · token QA
      </span>
    </header>
  );
}

// ── Tokens ─────────────────────────────────────────────────────────

function TokensSection() {
  return (
    <section>
      <SectionTitle>Tokens</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 24,
        }}
      >
        <ColorSwatches />
        <TypographySamples />
      </div>
    </section>
  );
}

function ColorSwatches() {
  const swatches: Array<{ name: string; value: string; hint?: string }> = [
    { name: "FG", value: "#0a1020", hint: "Primary text" },
    { name: "FG subdued", value: "#556479", hint: "Hints, timestamps" },
    { name: "Hairline", value: "rgba(15,23,42,0.04)", hint: "All dividers" },
    { name: "Border", value: "rgba(15,23,42,0.08)", hint: "Glass borders" },
    { name: "State title", value: "rgba(85,100,121,0.85)", hint: "Caps tracking" },
    { name: "Live count", value: "#ef4444", hint: "Badges only" },
    { name: "Streaming", value: "#22c55e", hint: "Auto-indicator" },
    { name: "Brand accent", value: "#086ce8", hint: "One per zone" },
    { name: "Trail edge", value: "rgba(85,100,121,0.4)", hint: "Edge stroke" },
    { name: "Result ring", value: "rgba(255,184,0,0.5)", hint: "Trail terminal" },
  ];
  return (
    <div>
      <SubLabel>Color</SubLabel>
      <div style={{ display: "grid", gap: 6 }}>
        {swatches.map((s) => (
          <div
            key={s.name}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                background: s.value,
                border: "1px solid rgba(15,23,42,0.04)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                width: 90,
                color: "#0a1020",
              }}
            >
              {s.name}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily:
                  '"SF Mono", ui-monospace, monospace',
                color: "#556479",
                width: 180,
              }}
            >
              {s.value}
            </span>
            {s.hint && (
              <span style={{ fontSize: 10, color: "#556479" }}>{s.hint}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TypographySamples() {
  const samples = [
    { sample: "STATE", style: railTitleStyle, label: "9 / 700 / 0.14em caps" },
    { sample: "Strategic Framework", style: titleStyle, label: "12.5 / 700" },
    { sample: "Aggressive growth · 85%", style: subtitleStyle, label: "11 / 500 / tabular" },
    { sample: "Open detail", style: actionStyle, label: "10.5 / 600" },
    { sample: "·2m  Bridge accepted", style: timestampStyle, label: "10 / 400 mono" },
  ];
  return (
    <div>
      <SubLabel>Typography</SubLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {samples.map((s, i) => (
          <div key={i}>
            <div style={s.style}>{s.sample}</div>
            <div style={{ fontSize: 9, color: "#556479", marginTop: 2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const railTitleStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "rgba(85,100,121,0.85)",
};
const titleStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: "#0a1020",
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "#556479",
  fontVariantNumeric: "tabular-nums",
};
const actionStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#086ce8",
};
const timestampStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 400,
  color: "#556479",
  fontFamily: '"SF Mono", ui-monospace, monospace',
};

// ── Primitives ─────────────────────────────────────────────────────

function PrimitivesSection() {
  return (
    <section>
      <SectionTitle>Primitives</SectionTitle>
      <div style={{ display: "grid", gap: 32 }}>
        <PrimitiveBlock title="StreamingDot · 3 statuses">
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <StreamingDot status="running" label="streaming" />
            <StreamingDot status="paused" label="paused" />
            <StreamingDot status="error" label="error" />
          </div>
        </PrimitiveBlock>

        <PrimitiveBlock title="CountBadge · idle / 1 / 12 / 99+">
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <CountBadge count={0} />
            <span style={{ fontSize: 9, color: "#556479" }}>(0 = hidden)</span>
            <CountBadge count={1} />
            <CountBadge count={12} />
            <CountBadge count={150} />
          </div>
        </PrimitiveBlock>

        <PrimitiveBlock title="ActionChip · 4 variants × icon/no-icon">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, max-content)",
              gap: 8,
              alignItems: "center",
            }}
          >
            <ActionChip variant="primary">Pin</ActionChip>
            <ActionChip variant="secondary">Dismiss</ActionChip>
            <ActionChip variant="danger">Reject</ActionChip>
            <ActionChip variant="ghost">Skip</ActionChip>
            <ActionChip variant="primary" icon={Pin}>
              Pin
            </ActionChip>
            <ActionChip variant="secondary" icon={X}>
              Dismiss
            </ActionChip>
            <ActionChip variant="danger" icon={AlertTriangle}>
              Reject
            </ActionChip>
            <ActionChip variant="ghost" icon={Settings}>
              Settings
            </ActionChip>
          </div>
        </PrimitiveBlock>

        <PrimitiveBlock title="StateCard · plain / accent / interactive / with eyebrow">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
            }}
          >
            <StateCard
              title="59 entities · 40 edges"
              subtitle="last grew 2m ago"
            />
            <StateCard
              eyebrow="Active"
              title="Strategic Framework Integration"
              subtitle="Aggressive growth · 85%"
              accent="#086ce8"
              trailing={
                <ArrowUpRight
                  style={{ width: 13, height: 13, color: "#556479" }}
                />
              }
            />
            <StateCard
              title="Master bottleneck"
              subtitle="Sleep quality measurement gap"
              interactive
            />
            <StateCard
              eyebrow="Pinned"
              title="Sleep cards have no metric"
              subtitle="resolved? · 12m ago"
              accent="#a16207"
            />
          </div>
        </PrimitiveBlock>

        <PrimitiveBlock title="LiveCard · with eyebrow + actions">
          <div style={{ display: "grid", gap: 6 }}>
            <LiveCard
              eyebrow="Pairwise"
              eyebrowAccent="#086ce8"
              title="C ↔ D · novelty 0.92"
              subtitle="Sleep ↔ Energy levels"
              isFresh={false}
              actions={
                <>
                  <ActionChip variant="primary" icon={Pin} compact>
                    Pin
                  </ActionChip>
                  <ActionChip variant="secondary" icon={Search} compact>
                    Audit
                  </ActionChip>
                  <ActionChip variant="ghost" icon={X} compact>
                    Dismiss
                  </ActionChip>
                </>
              }
            />
            <LiveCard
              eyebrow="Probe"
              eyebrowAccent="#a16207"
              title="Sleep cards have no measurement metric"
              subtitle="quantify? · just now"
              isFresh={false}
              actions={
                <>
                  <ActionChip variant="primary" compact>
                    Open rabbit hole
                  </ActionChip>
                  <ActionChip variant="secondary" compact>
                    Pin
                  </ActionChip>
                </>
              }
            />
            <LiveCard
              eyebrow="Stale"
              eyebrowAccent="#556479"
              title="8 connection checks need revisit"
              subtitle="topology shifted · 6m ago"
              isFresh={false}
              arrivedAt={Date.now() - 50_000}
              actions={
                <ActionChip variant="primary" compact>
                  Run prospect
                </ActionChip>
              }
            />
          </div>
        </PrimitiveBlock>

        <PrimitiveBlock title="RailSection · state / live with count">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
            }}
          >
            <RailSection title="Locked insights">
              <StateCard title="Master bottleneck: <X>" />
              <StateCard title="Top leverage: A→B unlocks Y" />
              <StateCard title="Critical risk: <C>" />
            </RailSection>
            <RailSection
              title="Fresh"
              count={3}
              zone="live"
              trailing={
                <ActionChip variant="ghost" icon={Pause} compact>
                  Pause
                </ActionChip>
              }
            >
              <LiveCard
                eyebrow="Pairwise"
                title="C ↔ D · novelty 0.92"
                subtitle="just now"
                isFresh={false}
              />
              <LiveCard
                eyebrow="Probe"
                eyebrowAccent="#a16207"
                title="Sleep cards have no metric"
                isFresh={false}
              />
            </RailSection>
          </div>
        </PrimitiveBlock>

        <PrimitiveBlock title="RailDivider · with / without label">
          <div style={{ display: "grid", gap: 4 }}>
            <RailDivider />
            <RailDivider label="live" />
            <RailDivider label="paused" />
          </div>
        </PrimitiveBlock>
      </div>
    </section>
  );
}

// ── Probe trail ────────────────────────────────────────────────────

function ProbeTrailSection() {
  return (
    <section>
      <SectionTitle>Probe trail</SectionTitle>

      <PrimitiveBlock title="TrailNode · 5 phases">
        <div
          style={{
            display: "flex",
            gap: 32,
            padding: "16px 0 24px",
            alignItems: "flex-start",
          }}
        >
          <TrailNodePhaseDemo phase="idle" icon="probe-origin" label="idle" />
          <TrailNodePhaseDemo phase="working" icon="reasoning-step" label="thinking" />
          <TrailNodePhaseDemo phase="complete" icon="search-step" label="searched" />
          <TrailNodePhaseDemo phase="result" icon="result-terminal" label="2 entities" />
          <TrailNodePhaseDemo phase="error" icon="probe-origin" label="failed" />
        </div>
      </PrimitiveBlock>

      <PrimitiveBlock title="TrailBadge · collapsed states">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <TrailBadge label="Probe · 14m ago" />
          <TrailBadge label="Probe · 2 results" resultCount={2} />
          <TrailBadge label="Probe · 5 results" resultCount={5} hasPending />
        </div>
      </PrimitiveBlock>

      <PrimitiveBlock title="Trail composition · live unfurl">
        <TrailComposed />
      </PrimitiveBlock>
    </section>
  );
}

function TrailNodePhaseDemo({
  phase,
  icon,
  label,
}: {
  phase: TrailNodePhase;
  icon: TrailNodeIcon;
  label: string;
}) {
  return <TrailNode phase={phase} icon={icon} label={label} />;
}

function TrailComposed() {
  // Static trail showing 6 nodes with different phases — represents
  // a probe rabbit-hole partway through. In production this is
  // generated dynamically by the orchestrator.
  const W = 720;
  const H = 220;

  // Node positions (px in the SVG/HTML overlay coord space)
  type N = { id: string; x: number; y: number; phase: TrailNodePhase; icon: TrailNodeIcon; label: string };
  const nodes: N[] = [
    { id: "src",  x:  20, y:  90, phase: "complete", icon: "probe-origin",     label: "probe" },
    { id: "dec",  x: 160, y:  90, phase: "complete", icon: "decompose-step",   label: "decompose" },
    { id: "q1",   x: 320, y:  20, phase: "complete", icon: "search-step",      label: "Walker '17" },
    { id: "q2",   x: 320, y:  90, phase: "working",  icon: "search-step",      label: "searching" },
    { id: "q3",   x: 320, y: 160, phase: "idle",     icon: "reasoning-step",   label: "queued" },
    { id: "res",  x: 540, y:  90, phase: "result",   icon: "result-terminal",  label: "2 entities" },
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const NW = 56, NH = 40; // node geometry
  function center(id: string) {
    const n = byId.get(id)!;
    return { x: n.x + NW / 2, y: n.y + NH / 2 };
  }
  type EdgePhase = "working" | "complete";
  const edges: Array<{ from: string; to: string; phase: EdgePhase }> = [
    { from: "src", to: "dec", phase: "complete" },
    { from: "dec", to: "q1",  phase: "complete" },
    { from: "dec", to: "q2",  phase: "working" },
    { from: "dec", to: "q3",  phase: "working" },
    { from: "q1",  to: "res", phase: "complete" },
    { from: "q2",  to: "res", phase: "working" },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: W,
        height: H,
        background:
          "linear-gradient(180deg, rgba(8,108,232,0.015) 0%, transparent 100%)",
        borderRadius: 12,
        border: "1px dashed rgba(15,23,42,0.06)",
      }}
    >
      <svg
        width={W}
        height={H}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {edges.map((e, i) => (
          <TrailEdge
            key={i}
            from={center(e.from)}
            to={center(e.to)}
            phase={e.phase}
          />
        ))}
      </svg>
      {nodes.map((n) => (
        <TrailNode
          key={n.id}
          phase={n.phase}
          icon={n.icon}
          label={n.label}
          x={n.x}
          y={n.y}
        />
      ))}
    </div>
  );
}

// ── Connected vision · Mind-Body-Cognition storyboard ─────────────

function ConnectedVisionSection() {
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
            Connected vision
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
            Mind-Body-Cognition · 4 frames
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
          One run, four frozen moments. Same primitives. Canvas left, right rail right.
          Every entity, edge, count, and synthesis line below is grounded in real schemas
          (entities/edges tables, synthesis_data JSONB, the Mind-Body-Cognition seed at{" "}
          <code style={{ fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 11 }}>
            src/lib/templates/mind-body-cognition/seed.ts
          </code>
          ) — so what you read here is what the rail and canvas will display in the
          actual pipeline output, not made-up labels.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {STORYBOARD_FRAMES.map((frame, i) => (
          <StoryboardFrame key={i} frame={frame} index={i} />
        ))}
      </div>
    </section>
  );
}

// ── Right-rail composition ─────────────────────────────────────────

function RailComposedColumn() {
  const [paused, setPaused] = useState(false);
  return (
    <aside
      style={{
        position: "sticky",
        top: 24,
        alignSelf: "start",
        width: 340,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "20px 18px",
        borderRadius: 18,
        background: "white",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow: "0 18px 48px -12px rgba(8,30,80,0.10)",
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <SectionTitle compact>Right rail · Ambient mode</SectionTitle>
      </div>

      {/* STATE zone */}
      <RailSection title="KG snapshot">
        <StateCard
          title="59 entities · 40 edges · 12 cycles"
          subtitle="grew 3 in last 5 min"
        />
      </RailSection>

      <RailSection title="Active strategy">
        <StateCard
          eyebrow="#1 · Active"
          title="Strategic Framework Integration"
          subtitle="Aggressive growth · 85%"
          accent="#086ce8"
          interactive
          trailing={
            <ArrowUpRight
              style={{ width: 13, height: 13, color: "#556479" }}
            />
          }
        />
      </RailSection>

      <RailSection title="Locked insights">
        <StateCard
          eyebrow="Bottleneck"
          title="Sleep quality measurement gap"
        />
        <StateCard
          eyebrow="Leverage"
          title="A→B unlocks Y · 0.55"
        />
        <StateCard eyebrow="Risk" title="C cycles to D · 0.30" />
      </RailSection>

      {/* divider — the cognitive boundary */}
      <RailDivider label={paused ? "paused" : "live"} />

      {/* LIVE zone */}
      <div
        style={{
          background: "var(--rail-live-bg)",
          borderRadius: 14,
          padding: "10px 8px",
          marginTop: -8,
          marginLeft: -8,
          marginRight: -8,
        }}
      >
        <RailSection
          title="Auto-indicator"
          zone="live"
          count={3}
          trailing={
            <ActionChip
              variant="ghost"
              icon={paused ? Sparkles : Pause}
              compact
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume" : "Pause"}
            </ActionChip>
          }
        >
          <LiveCard
            eyebrow="Pairwise"
            title="C ↔ D · novelty 0.92"
            subtitle="just now"
            isFresh
            actions={
              <>
                <ActionChip variant="primary" icon={Pin} compact>
                  Pin
                </ActionChip>
                <ActionChip variant="secondary" icon={Search} compact>
                  Audit
                </ActionChip>
                <ActionChip variant="ghost" icon={X} compact>
                  Dismiss
                </ActionChip>
              </>
            }
          />
          <LiveCard
            eyebrow="Probe"
            eyebrowAccent="#a16207"
            title="Sleep cards have no measurement metric"
            subtitle="quantify? · 12s ago"
            isFresh={false}
            arrivedAt={Date.now() - 12_000}
            actions={
              <>
                <ActionChip variant="primary" compact>
                  Rabbit hole
                </ActionChip>
                <ActionChip variant="secondary" compact>
                  Pin
                </ActionChip>
              </>
            }
          />
          <LiveCard
            eyebrow="Stale"
            eyebrowAccent="#556479"
            title="8 connection checks need revisit"
            subtitle="topology shifted · 6m ago"
            isFresh={false}
            arrivedAt={Date.now() - 6 * 60_000}
            actions={
              <ActionChip variant="primary" compact>
                Run prospect
              </ActionChip>
            }
          />
        </RailSection>

        <RailSection title="Activity">
          <ActivityRow time="·2m" text="Bridge accepted: A↔B" icon={Plug} />
          <ActivityRow time="·5m" text="+3 cards under Sleep" icon={Sparkles} />
          <ActivityRow time="·8m" text="Research started: <X>" icon={Brain} />
          <ActivityRow time="·12m" text="Decompose: 4 sub-concepts" icon={FileText} />
        </RailSection>
      </div>
    </aside>
  );
}

function ActivityRow({
  time,
  text,
  icon: Icon,
}: {
  time: string;
  text: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 4px",
        fontSize: 10.5,
      }}
    >
      <span
        style={{
          fontFamily: '"SF Mono", ui-monospace, monospace',
          color: "#556479",
          width: 30,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {time}
      </span>
      <Icon
        style={{
          width: 11,
          height: 11,
          strokeWidth: 1.5,
          color: "#556479",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "#0a1020" }}>{text}</span>
    </div>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────

function SectionTitle({
  children,
  compact,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <h2
      style={{
        fontSize: compact ? 9 : 10,
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "rgba(85,100,121,0.85)",
        margin: 0,
        marginBottom: compact ? 6 : 14,
      }}
    >
      {children}
    </h2>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "#556479",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function PrimitiveBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#0a1020",
          marginBottom: 10,
          letterSpacing: "0.005em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          padding: "16px 18px",
          background: "white",
          borderRadius: 14,
          border: "1px solid rgba(15,23,42,0.04)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
