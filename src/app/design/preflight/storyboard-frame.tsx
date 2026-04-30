"use client";

// StoryboardFrame — one moment-in-time view of canvas + rail evolving
// together. Composed from existing primitives (RailSection, StateCard,
// LiveCard, ActionChip, StreamingDot, CanvasMiniature) so anything that
// looks "off" here will look "off" in production — single source of
// truth.

import {
  Sparkles,
  FileText,
  GitBranch,
  Search,
  Plug,
  Pin,
  X,
  ArrowUpRight,
  Pause,
  Brain,
} from "lucide-react";
import {
  RailSection,
  RailDivider,
  StateCard,
  LiveCard,
  ActionChip,
  StreamingDot,
} from "@/components/canvas/rail/primitives";
import { CanvasMiniature } from "./canvas-miniature";
import type { StoryboardFrame as Frame, FrameRail } from "./storyboard-data";

const ACTIVITY_ICON: Record<
  NonNullable<NonNullable<FrameRail["live"]>["activity"]>[number]["iconKind"],
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  added: Sparkles,
  edge: Plug,
  cycle: GitBranch,
  bridge: Plug,
  research: Brain,
  strategy: Sparkles,
};

const FRESH_EYEBROW_ACCENT: Record<
  NonNullable<NonNullable<FrameRail["live"]>["fresh"]>[number]["kind"],
  string
> = {
  pairwise: "#086ce8",
  probe: "#a16207",
  stale: "#556479",
  proposal: "#7c3aed",
};

const INSIGHT_EYEBROW: Record<
  "bottleneck" | "leverage" | "risk",
  { label: string; color: string }
> = {
  bottleneck: { label: "Bottleneck", color: "#b42318" },
  leverage: { label: "Leverage", color: "#15803d" },
  risk: { label: "Risk", color: "#a16207" },
};

export function StoryboardFrame({
  frame,
  index,
}: {
  frame: Frame;
  index: number;
}) {
  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(620px, 1fr) 320px",
        gap: 24,
        padding: "20px 22px",
        borderRadius: 18,
        background: "white",
        border: "1px solid rgba(15,23,42,0.04)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02), 0 8px 24px rgba(0,0,0,0.03)",
      }}
    >
      <div>
        <FrameHeader frame={frame} index={index} />
        <CanvasMiniature
          width={680}
          height={420}
          showPromptInput={frame.canvas.showPromptInput}
          promptText={frame.canvas.promptText}
          promptMode={frame.canvas.promptMode}
          showStageBanner={frame.canvas.showStageBanner}
          originPrompt={frame.canvas.originPrompt}
          nodes={frame.canvas.nodes}
          edges={frame.canvas.edges}
          cyclePolygons={frame.canvas.cyclePolygons}
          strategyHero={frame.canvas.strategyHero}
          probeTrail={frame.canvas.probeTrail}
          solveLandscape={frame.canvas.solveLandscape}
          solveProposal={frame.canvas.solveProposal}
          backgroundOpacity={frame.canvas.backgroundOpacity}
        />
        <p
          style={{
            margin: "12px 4px 0",
            fontSize: 11.5,
            color: "#556479",
            lineHeight: 1.55,
            maxWidth: 680,
            letterSpacing: "0.005em",
          }}
        >
          {frame.caption}
        </p>
      </div>

      <RailMock rail={frame.rail} />
    </article>
  );
}

function FrameHeader({ frame, index }: { frame: Frame; index: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "rgba(85,100,121,0.85)",
          padding: "3px 8px",
          borderRadius: 999,
          background: "rgba(8,30,80,0.04)",
        }}
      >
        Frame {index + 1}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#086ce8",
          fontFamily: '"SF Mono", ui-monospace, monospace',
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
        }}
      >
        {frame.t}
      </span>
      <h3
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 700,
          color: "#0a1020",
          letterSpacing: "-0.01em",
        }}
      >
        {frame.title}
      </h3>
    </div>
  );
}

// ── Rail mock for one frame ────────────────────────────────────────

function RailMock({ rail }: { rail: FrameRail }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "16px 14px",
        borderRadius: 14,
        background: "white",
        border: "1px solid rgba(15,23,42,0.05)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        height: "fit-content",
        position: "sticky",
        top: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(85,100,121,0.85)",
          }}
        >
          Right rail
        </span>
        <span style={{ flex: 1 }} />
        <StreamingDot
          status={rail.streaming === "off" ? "paused" : rail.streaming}
          label={rail.stage ?? "idle"}
        />
      </div>

      {/* STATE zone */}
      {rail.state && (
        <>
          <RailSection title="KG snapshot">
            <StateCard
              title={
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {rail.state.kgSnapshot.entities} entities ·{" "}
                  {rail.state.kgSnapshot.edges} edges ·{" "}
                  {rail.state.kgSnapshot.cycles}{" "}
                  {rail.state.kgSnapshot.cycles === 1 ? "cycle" : "cycles"}
                </span>
              }
              subtitle={
                rail.streaming === "running"
                  ? `streaming · ${rail.stage}`
                  : "idle"
              }
            />
          </RailSection>

          {rail.state.activeStrategy && (
            <RailSection title="Active strategy">
              <StateCard
                eyebrow={`#${rail.state.activeStrategy.rank} · Active`}
                title={rail.state.activeStrategy.title}
                subtitle={`${rail.state.activeStrategy.posture} · ${rail.state.activeStrategy.confidence}%`}
                accent="#086ce8"
                interactive
                trailing={
                  <ArrowUpRight
                    style={{ width: 13, height: 13, color: "#556479" }}
                  />
                }
              />
            </RailSection>
          )}

          {rail.state.lockedInsights && rail.state.lockedInsights.length > 0 && (
            <RailSection title="Locked insights">
              {rail.state.lockedInsights.map((ins, i) => {
                const m = INSIGHT_EYEBROW[ins.kind];
                return (
                  <StateCard
                    key={i}
                    eyebrow={m.label}
                    title={ins.title}
                    subtitle={ins.subtitle}
                    accent={m.color}
                  />
                );
              })}
            </RailSection>
          )}
        </>
      )}

      {/* Divider — only shown when state has settled AND live has items */}
      {rail.state && rail.live && (
        <RailDivider label={rail.streaming === "paused" ? "paused" : "live"} />
      )}

      {/* LIVE zone */}
      {rail.live && (
        <div
          style={{
            background: "var(--rail-live-bg)",
            borderRadius: 12,
            padding: "8px 6px",
            margin: "-6px -6px 0",
          }}
        >
          {rail.live.fresh && rail.live.fresh.length > 0 && (
            <RailSection
              title="Fresh"
              zone="live"
              count={rail.live.freshCount ?? rail.live.fresh.length}
              trailing={
                <ActionChip
                  variant="ghost"
                  icon={Pause}
                  compact
                  aria-label="Pause auto-indicator"
                >
                  Pause
                </ActionChip>
              }
            >
              {rail.live.fresh.map((f, i) => (
                <LiveCard
                  key={i}
                  eyebrow={f.eyebrow}
                  eyebrowAccent={FRESH_EYEBROW_ACCENT[f.kind]}
                  title={f.title}
                  subtitle={f.subtitle}
                  isFresh={i === 0}
                  arrivedAt={f.arrivedAt}
                  actions={
                    f.kind === "pairwise" ? (
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
                    ) : f.kind === "probe" ? (
                      <>
                        <ActionChip variant="primary" compact>
                          Open rabbit hole
                        </ActionChip>
                        <ActionChip variant="secondary" compact>
                          Pin
                        </ActionChip>
                      </>
                    ) : f.kind === "stale" ? (
                      <ActionChip variant="primary" compact>
                        Run prospect
                      </ActionChip>
                    ) : (
                      <ActionChip variant="secondary" compact>
                        Review
                      </ActionChip>
                    )
                  }
                />
              ))}
            </RailSection>
          )}

          {rail.live.activity && rail.live.activity.length > 0 && (
            <RailSection title="Activity">
              {rail.live.activity.map((a, i) => {
                const Icon = ACTIVITY_ICON[a.iconKind];
                return (
                  <ActivityRow key={i} time={a.time} text={a.text} icon={Icon} />
                );
              })}
            </RailSection>
          )}
        </div>
      )}

      {/* Empty state for the t=0 frame — rail is at rest */}
      {!rail.state && !rail.live && (
        <div
          style={{
            padding: "24px 8px",
            textAlign: "center",
            fontSize: 10.5,
            color: "rgba(85,100,121,0.7)",
            lineHeight: 1.5,
          }}
        >
          <FileText
            style={{
              width: 18,
              height: 18,
              strokeWidth: 1.5,
              color: "rgba(85,100,121,0.45)",
              marginBottom: 6,
            }}
          />
          <div>Type a prompt to begin.</div>
          <div style={{ marginTop: 2, opacity: 0.7 }}>
            The rail comes alive once intake fires.
          </div>
        </div>
      )}
    </div>
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
        padding: "4px 4px",
        fontSize: 10.5,
      }}
    >
      <span
        style={{
          fontFamily: '"SF Mono", ui-monospace, monospace',
          color: "#556479",
          width: 30,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
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
      <span
        style={{
          color: "#0a1020",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}
