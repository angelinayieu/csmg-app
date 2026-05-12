"use client";

// Stage Rooms · before & after.
//
// Source of truth: src/lib/whiteboard/room-layout.ts (STAGE_ROOMS)
// Same titles, descriptions, accents, glyphs as production. Layout:
//
//   1) Per-room evolution — each of the 6 rooms shown side-by-side
//      (Before / After) with explicit notes on what changed.
//   2) State contract — KG room across pending / working / complete
//      so the visual state grammar is unambiguous.
//   3) Scale contract — KG room with sparse / typical / rich content
//      so the artifact peek's adaptation is documented.
//
// Both Before and After read from STAGE_ROOMS, so any upstream metadata
// change flows through both columns. The Before mirrors today's
// room-shape.tsx; the After applies design tokens + a lab-instrument
// vocabulary (telemetry header, richer artifact peek, layered glass
// depth) without changing the substrate.

import { Loader2, Check } from "lucide-react";
import { STAGE_ROOMS, type RoomCounts } from "@/lib/whiteboard/room-layout";
import type { PipelineStage } from "@/types/pipeline-events";
import {
  IntakeRoomIcon,
  LandscapeRoomIcon,
  KgRoomIcon,
  ProposalRoomIcon,
  LabRoomIcon,
  ResultsRoomIcon,
  TwinRoomIcon,
  ReflexiveRoomIcon,
  NorthStarIcon,
  CycleIcon,
  BridgeIcon,
} from "@/components/canvas/icons";

const STAGE_ICON: Record<
  PipelineStage,
  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
> = {
  intake: IntakeRoomIcon,
  landscape: LandscapeRoomIcon,
  kg: KgRoomIcon,
  proposal: ProposalRoomIcon,
  twin: TwinRoomIcon,
  lab: LabRoomIcon,
  reflexive: ReflexiveRoomIcon,
  results: ResultsRoomIcon,
};

type RoomState = "active" | "complete" | "pending";

const STAGE_ORDER: PipelineStage[] = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "twin",
  "lab",
  "reflexive",
  "results",
];

// ── Per-room canonical "in-flight" state for the Before/After pair ─

const STAGE_DEMO_STATE: Record<PipelineStage, RoomState> = {
  intake: "complete",
  landscape: "complete",
  kg: "complete",
  proposal: "active",
  twin: "pending",
  lab: "pending",
  reflexive: "pending",
  results: "pending",
};

const STAGE_DEMO_COUNTS: Record<PipelineStage, Partial<RoomCounts>> = {
  intake: { assets: 2 },
  landscape: { axes: 4, axesScored: 4 },
  kg: { entities: 34, edges: 87, cycles: 3, bridges: 1 },
  proposal: { proposals: 3 },
  twin: { proposals: 0 },
  lab: { variants: 0 },
  reflexive: {},
  results: { predictions: 0 },
};

// What changed between Before and After per room — surfaces in the
// annotation block. Concrete, never vague.
const STAGE_NOTES: Record<PipelineStage, string[]> = {
  intake: [
    "Stage label moves from a roman-numeral glyph to a custom funnel icon + tracked caps eyebrow.",
    "Description hierarchy tightens — title 12.5 / 700, subtitle 10.5 / 500 tabular-nums, description 10 / muted slate.",
    "Artifact peek surfaces what landed (origin prompt + asset chips) instead of just describing the stage.",
  ],
  landscape: [
    "Roman numeral replaced by a fan-of-three glyph that visually reads 'probability spaces.'",
    "Axis lenses render as a peek strip with telemetry-style score readouts (0.82, 0.71, ...).",
    "Active-state ring breathes at the kg-drill-halo cadence; same rhythm as the auto-indicator.",
  ],
  kg: [
    "Counts stop floating in prose — they become discrete chips (entities · edges · cycles · bridges).",
    "Internal artifact peek hints at the actual graph topology with mini node-edge dots.",
    "Stage accent is rail-only at top — no heavy gradient wash competing with KG content.",
  ],
  proposal: [
    "Top-ranked solution gets a NorthStar mark; #2-#3 step down in weight without losing legibility.",
    "Confidence rendered tabular-nums monospace, right-aligned — instrument-panel feel.",
    "Active 'Working' state has the breathing ring around the icon, not a rotating spinner — quieter, less anxious.",
  ],
  lab: [
    "Lab-room icon is now an isometric chamber outline — reads as 'experiment vessel,' not flask cliché.",
    "Pending-state pill matches the rail's PENDING chip vocabulary so the visual grammar is one alphabet.",
    "Idle rooms render dimmer (0.78 opacity) so the eye flows past them to the active room.",
  ],
  twin: [
    "Twin room renders the committed Workflow / Strategy / Twin once a proposal is approved.",
    "Reads the proposed_spec snapshot to diff promised-vs-materialized counts.",
    "Anchors the persona → strategy → app cascade on the operational whiteboard.",
  ],
  reflexive: [
    "Always-on background pulse — prospector + radar + calibration tick between user visits.",
    "Renders coverage / depth / calibration as compact telemetry in the rail.",
    "Kept as a strip rather than a heavyweight room because it has no per-run lifecycle.",
  ],
  results: [
    "Final tier uses a clean check-in-circle mark, no checkmark cliché.",
    "Empty state copy stops apologizing ('Pending final synthesis…') — neutral, instrument-style.",
    "Slate accent is the most muted by design — results are read, not actively driven.",
  ],
};

// ── Top-level section ──────────────────────────────────────────────

export function RoomsStripSection() {
  return (
    <section
      style={{
        maxWidth: 1480,
        margin: "0 auto",
        padding: "0 48px 64px",
      }}
    >
      <header
        style={{
          marginBottom: 32,
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
            Stage rooms · before &amp; after
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
            same data · two materials
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "#556479",
            lineHeight: 1.55,
            maxWidth: 920,
          }}
        >
          Both columns render from{" "}
          <code style={{ fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 11 }}>
            STAGE_ROOMS
          </code>{" "}
          in{" "}
          <code style={{ fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 11 }}>
            src/lib/whiteboard/room-layout.ts
          </code>
          . Before mirrors{" "}
          <code style={{ fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 11 }}>
            room-shape.tsx
          </code>{" "}
          as it ships today; After applies the design-token grammar plus a lab-instrument
          vocabulary (telemetry-style header strip, richer artifact peek, multi-layer
          glass depth). Substrate untouched — the painter still spawns rooms identically;
          only the visual treatment evolves.
        </p>
      </header>

      {/* SUB-SECTION 1 — per-room evolution pairs */}
      <SubsectionTitle>Room-by-room evolution</SubsectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {STAGE_ORDER.map((stage) => (
          <RoomPair key={stage} stage={stage} />
        ))}
      </div>

      {/* SUB-SECTION 2 — state contract on KG */}
      <SubsectionTitle style={{ marginTop: 48 }}>
        State contract · KG room across pending → working → complete
      </SubsectionTitle>
      <p
        style={{
          margin: "-8px 0 16px",
          fontSize: 11,
          color: "#556479",
          lineHeight: 1.5,
          maxWidth: 760,
        }}
      >
        The same upgraded room rendered in three states. State changes only the chip
        + ring + dim level — the room's identity, geometry, and artifact peek
        remain stable so the user's spatial memory is preserved across the run.
      </p>
      <KGStateMatrix />

      {/* SUB-SECTION 3 — scale contract on KG */}
      <SubsectionTitle style={{ marginTop: 48 }}>
        Scale contract · KG room from sparse → typical → rich
      </SubsectionTitle>
      <p
        style={{
          margin: "-8px 0 16px",
          fontSize: 11,
          color: "#556479",
          lineHeight: 1.5,
          maxWidth: 760,
        }}
      >
        Artifact peek adapts to content density without resizing the room itself.
        Sparse runs get fewer chips; rich runs gain a bridge marker and a cycle marker
        so the user can see structural artifacts at a glance.
      </p>
      <KGScaleMatrix />
    </section>
  );
}

function SubsectionTitle({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <h3
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "rgba(85,100,121,0.85)",
        margin: "0 0 16px",
        ...style,
      }}
    >
      {children}
    </h3>
  );
}

// ── Room pair — Before / After side by side, with annotations ─────

function RoomPair({ stage }: { stage: PipelineStage }) {
  const meta = STAGE_ROOMS[stage];
  const state = STAGE_DEMO_STATE[stage];
  const counts = STAGE_DEMO_COUNTS[stage];
  const notes = STAGE_NOTES[stage];

  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 18,
        background: "white",
        border: "1px solid rgba(15,23,42,0.04)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02), 0 8px 24px rgba(0,0,0,0.03)",
      }}
    >
      {/* Pair header — stage name + meta */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px dashed rgba(15,23,42,0.06)",
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
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Stage {STAGE_ORDER.indexOf(stage) + 1}
        </span>
        <h4
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            color: "#0a1020",
            letterSpacing: "-0.01em",
          }}
        >
          {meta.title}
        </h4>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10,
            color: "#556479",
            fontFamily: '"SF Mono", ui-monospace, monospace',
            letterSpacing: "0.04em",
          }}
        >
          stage = "{stage}"
        </span>
      </div>

      {/* The two cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
          alignItems: "start",
        }}
      >
        <ColumnLabel label="Before" sublabel="as ships today">
          <CurrentRoom stage={stage} state={state} counts={counts} />
        </ColumnLabel>
        <ColumnLabel
          label="After"
          sublabel="design tokens + lab vocabulary"
          accent="#086ce8"
        >
          <UpgradedRoom stage={stage} state={state} counts={counts} />
        </ColumnLabel>
      </div>

      {/* What changed */}
      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px dashed rgba(15,23,42,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(85,100,121,0.85)",
            marginBottom: 2,
          }}
        >
          What changed
        </div>
        {notes.map((n, i) => (
          <div
            key={i}
            style={{
              fontSize: 11,
              color: "#0a1020",
              lineHeight: 1.5,
              display: "flex",
              gap: 8,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                color: "#086ce8",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                width: 16,
                fontFamily: '"SF Mono", ui-monospace, monospace',
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnLabel({
  label,
  sublabel,
  accent,
  children,
}: {
  label: string;
  sublabel: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 10,
          paddingLeft: 4,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: accent ?? "rgba(85,100,121,0.85)",
            padding: "2px 8px",
            borderRadius: 999,
            background: accent
              ? `${accent}10`
              : "rgba(85,100,121,0.06)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#556479",
            letterSpacing: "0.005em",
          }}
        >
          {sublabel}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Before — replica of today's room-shape.tsx render ────────────

function CurrentRoom({
  stage,
  state,
  counts,
}: {
  stage: PipelineStage;
  state: RoomState;
  counts: Partial<RoomCounts>;
}) {
  const meta = STAGE_ROOMS[stage];
  const subtitle = buildSampleSubtitle(stage, counts);

  return (
    <div
      style={{
        width: "100%",
        minHeight: 152,
        padding: "18px 22px",
        borderRadius: 18,
        background: `linear-gradient(180deg, ${meta.accent}11 0%, transparent 70%)`,
        border: `1px solid ${meta.accent}33`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: meta.accent,
            fontFamily: "'Helvetica Neue', system-ui, sans-serif",
            lineHeight: 1,
          }}
        >
          {meta.glyph}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              color: "#0a1020",
              letterSpacing: "-0.01em",
            }}
          >
            {meta.title}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#556479",
              marginTop: 2,
              lineHeight: 1.35,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {subtitle}
          </div>
        </div>
        <CurrentStateChip state={state} accent={meta.accent} />
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#86868B",
          lineHeight: 1.45,
          marginTop: 4,
        }}
      >
        {meta.description}
      </div>
    </div>
  );
}

function CurrentStateChip({
  state,
  accent,
}: {
  state: RoomState;
  accent: string;
}) {
  if (state === "active") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 10px 3px 8px",
          borderRadius: 999,
          background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: accent,
        }}
      >
        <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
        Working
      </span>
    );
  }
  if (state === "complete") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 10px 3px 8px",
          borderRadius: 999,
          background: "rgba(34,197,94,0.12)",
          border: "1px solid rgba(34,197,94,0.28)",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "#15803d",
        }}
      >
        <Check style={{ width: 11, height: 11 }} />
        Done
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: "rgba(85,100,121,0.7)",
        padding: "3px 10px",
        borderRadius: 999,
        background: "rgba(85,100,121,0.06)",
      }}
    >
      Pending
    </span>
  );
}

// ── After — design-system tokens + lab-instrument vocabulary ──────

function UpgradedRoom({
  stage,
  state,
  counts,
}: {
  stage: PipelineStage;
  state: RoomState;
  counts: Partial<RoomCounts>;
}) {
  const meta = STAGE_ROOMS[stage];
  const subtitle = buildSampleSubtitle(stage, counts);
  const Icon = STAGE_ICON[stage];
  const dim = state === "pending";

  return (
    <div
      style={{
        width: "100%",
        minHeight: 152,
        padding: "0",
        borderRadius: 16,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.94) 100%)",
        border: `1px solid rgba(15,23,42,0.06)`,
        backdropFilter: "blur(14px) saturate(1.5)",
        boxShadow: `
          inset 0 1px 0 rgba(255,255,255,0.7),
          0 1px 2px rgba(8,30,80,0.04),
          0 18px 40px -16px ${meta.accent}33
        `,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        opacity: dim ? 0.78 : 1,
        transition: "opacity 240ms var(--ease-out-quart)",
      }}
    >
      {/* Top accent rail — gradient hair-line that gives the room its
          color identity without a heavy fill. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 16,
          right: 16,
          height: 2,
          borderRadius: 2,
          background: `linear-gradient(90deg, transparent 0%, ${meta.accent}90 50%, transparent 100%)`,
        }}
      />

      {/* Telemetry strip — thin top row with stage-id + clock. Reads as
          'instrument readout,' not chrome. Monospace, tabular-nums. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px 4px",
          fontSize: 8.5,
          fontFamily: '"SF Mono", ui-monospace, monospace',
          letterSpacing: "0.06em",
          color: "rgba(85,100,121,0.75)",
        }}
      >
        <span>{stage.toUpperCase()}_R{(STAGE_ORDER.indexOf(stage) + 1).toString().padStart(2, "0")}</span>
        <span style={{ color: "rgba(85,100,121,0.4)" }}>·</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {state === "complete" ? "00:42" : state === "active" ? "01:08" : "—:—"}
        </span>
        <span style={{ flex: 1 }} />
        <UpgradedStateChip state={state} accent={meta.accent} />
      </div>

      {/* Header — icon block + title + subtitle */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "4px 14px 10px",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${meta.accent}1a 0%, ${meta.accent}08 100%)`,
            border: `1px solid ${meta.accent}30`,
            color: meta.accent,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.5)`,
            position: "relative",
          }}
        >
          <Icon size={18} />
          {state === "active" && (
            <span
              aria-hidden
              className="rail-streaming-breath"
              style={{
                position: "absolute",
                inset: -3,
                borderRadius: 13,
                border: `1.5px solid ${meta.accent}`,
                opacity: 0.55,
                pointerEvents: "none",
              }}
            />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#0a1020",
              letterSpacing: "-0.01em",
              lineHeight: 1.25,
            }}
          >
            {meta.title}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#556479",
              marginTop: 3,
              lineHeight: 1.4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      {/* Artifact peek — the lab instrument panel */}
      <div
        style={{
          padding: "0 14px 14px",
          marginTop: "auto",
        }}
      >
        <ArtifactPeekPanel stage={stage} state={state} counts={counts} />
      </div>
    </div>
  );
}

function UpgradedStateChip({
  state,
  accent,
}: {
  state: RoomState;
  accent: string;
}) {
  if (state === "active") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1.5px 7px",
          borderRadius: 999,
          background: `${accent}14`,
          border: `0.5px solid ${accent}38`,
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: accent,
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
      >
        <span
          aria-hidden
          className="rail-streaming-breath"
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: accent,
          }}
        />
        WORKING
      </span>
    );
  }
  if (state === "complete") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "1.5px 7px",
          borderRadius: 999,
          background: "rgba(34,197,94,0.10)",
          border: "0.5px solid rgba(34,197,94,0.32)",
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "#15803d",
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
      >
        DONE
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: "0.12em",
        color: "rgba(85,100,121,0.75)",
        padding: "1.5px 7px",
        borderRadius: 999,
        background: "rgba(85,100,121,0.06)",
        fontFamily: '"SF Mono", ui-monospace, monospace',
      }}
    >
      PENDING
    </span>
  );
}

// ── Artifact peek panel — the lab readout ─────────────────────────

function ArtifactPeekPanel({
  stage,
  state,
  counts,
}: {
  stage: PipelineStage;
  state: RoomState;
  counts: Partial<RoomCounts>;
}) {
  const meta = STAGE_ROOMS[stage];
  if (state === "pending") {
    return (
      <div
        style={{
          height: 56,
          borderRadius: 10,
          background: "rgba(15,23,42,0.025)",
          border: "1px dashed rgba(15,23,42,0.06)",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          color: "rgba(85,100,121,0.6)",
          letterSpacing: "0.08em",
          fontWeight: 600,
          textTransform: "uppercase",
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
      >
        Awaiting upstream
      </div>
    );
  }

  // Per-stage readouts
  if (stage === "intake") {
    return (
      <PeekFrame accent={meta.accent}>
        <PeekChip text="prompt" accent={meta.accent} solid />
        <PeekChip text={`${counts.assets ?? 0} asset${(counts.assets ?? 0) === 1 ? "" : "s"}`} accent={meta.accent} />
        <PeekChip text="taxonomy" accent={meta.accent} faint />
      </PeekFrame>
    );
  }

  if (stage === "landscape") {
    const sample = [
      { label: "Mech",   score: 0.82 },
      { label: "Cost",   score: 0.71 },
      { label: "Risk",   score: 0.58 },
      { label: "Alt",    score: 0.45 },
    ];
    return (
      <PeekFrame accent={meta.accent}>
        {sample.map((axis) => (
          <PeekAxisBar
            key={axis.label}
            label={axis.label}
            score={axis.score}
            accent={meta.accent}
          />
        ))}
      </PeekFrame>
    );
  }

  if (stage === "kg") {
    return (
      <PeekFrame accent={meta.accent}>
        <PeekChip text={`${counts.entities} entities`} accent={meta.accent} solid />
        <PeekChip text={`${counts.edges} edges`} accent={meta.accent} />
        {(counts.cycles ?? 0) > 0 && (
          <PeekChipWithIcon
            text={`${counts.cycles} cycle${counts.cycles === 1 ? "" : "s"}`}
            accent={meta.accent}
            Icon={CycleIcon}
          />
        )}
        {(counts.bridges ?? 0) > 0 && (
          <PeekChipWithIcon
            text={`${counts.bridges} bridge${counts.bridges === 1 ? "" : "s"}`}
            accent={meta.accent}
            Icon={BridgeIcon}
          />
        )}
        <span style={{ flex: 1 }} />
        <KGTopologyPeek accent={meta.accent} />
      </PeekFrame>
    );
  }

  if (stage === "proposal") {
    const samples = [
      { rank: 1, label: "External Stores", confidence: 84 },
      { rank: 2, label: "Distraction block", confidence: 71 },
      { rank: 3, label: "Chunk inputs",     confidence: 54 },
    ];
    return (
      <PeekFrame accent={meta.accent} stack>
        {samples.map((s) => (
          <div
            key={s.rank}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 4px",
              fontSize: 10.5,
            }}
          >
            {s.rank === 1 ? (
              <span style={{ color: meta.accent, flexShrink: 0 }}>
                <NorthStarIcon size={10} />
              </span>
            ) : (
              <span
                style={{
                  width: 10,
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  fontSize: 9,
                  color: "rgba(85,100,121,0.6)",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {s.rank}
              </span>
            )}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 10.5,
                fontWeight: s.rank === 1 ? 700 : 500,
                color: "#0a1020",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                letterSpacing: "-0.005em",
              }}
            >
              {s.label}
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: meta.accent,
                fontVariantNumeric: "tabular-nums",
                fontFamily: '"SF Mono", ui-monospace, monospace',
              }}
            >
              {s.confidence}%
            </span>
          </div>
        ))}
      </PeekFrame>
    );
  }

  if (stage === "lab") {
    return (
      <PeekFrame accent={meta.accent}>
        <PeekChip text={`${counts.variants ?? 0} variants`} accent={meta.accent} faint />
        <PeekChip text="monte carlo" accent={meta.accent} faint />
        <PeekChip text="counterfactuals" accent={meta.accent} faint />
      </PeekFrame>
    );
  }

  // results
  return (
    <PeekFrame accent={meta.accent}>
      <PeekChip text="final synthesis" accent={meta.accent} faint />
      <PeekChip text="approved actions" accent={meta.accent} faint />
    </PeekFrame>
  );
}

function PeekFrame({
  accent,
  stack,
  children,
}: {
  accent: string;
  stack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: stack ? "column" : "row",
        alignItems: stack ? "stretch" : "center",
        gap: stack ? 1 : 5,
        flexWrap: "wrap",
        padding: "8px 10px",
        borderRadius: 10,
        background: `linear-gradient(180deg, ${accent}06 0%, transparent 100%)`,
        border: `1px solid ${accent}1a`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4)`,
        minHeight: 56,
      }}
    >
      {children}
    </div>
  );
}

function PeekChip({
  text,
  accent,
  faint,
  solid,
}: {
  text: string;
  accent: string;
  faint?: boolean;
  solid?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.02em",
        color: solid ? "white" : faint ? "#556479" : accent,
        padding: "2.5px 7px",
        borderRadius: 5,
        background: solid
          ? accent
          : faint
            ? "rgba(85,100,121,0.06)"
            : `${accent}14`,
        border: solid ? "none" : `0.5px solid ${faint ? "rgba(85,100,121,0.12)" : `${accent}22`}`,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </span>
  );
}

function PeekChipWithIcon({
  text,
  accent,
  Icon,
}: {
  text: string;
  accent: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.02em",
        color: accent,
        padding: "2.5px 7px",
        borderRadius: 5,
        background: `${accent}14`,
        border: `0.5px solid ${accent}22`,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon size={10} />
      {text}
    </span>
  );
}

function PeekAxisBar({
  label,
  score,
  accent,
}: {
  label: string;
  score: number;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        flex: 1,
        minWidth: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontFamily: '"SF Mono", ui-monospace, monospace',
            fontVariantNumeric: "tabular-nums",
            fontSize: 9.5,
          }}
        >
          {score.toFixed(2)}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: `${accent}14`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${Math.max(8, score * 100)}%`,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${accent}55 0%, ${accent} 100%)`,
            boxShadow: `0 0 6px ${accent}40`,
          }}
        />
      </div>
    </div>
  );
}

/** Tiny KG dot-pattern that hints at graph topology — five dots and
 *  three connectors, schematic representation of "there's a graph
 *  inside this room." */
function KGTopologyPeek({ accent }: { accent: string }) {
  return (
    <svg
      width={42}
      height={36}
      viewBox="0 0 42 36"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <path
        d="M 8 18 L 21 6"
        stroke={`${accent}80`}
        strokeWidth={0.8}
        strokeLinecap="round"
      />
      <path
        d="M 21 6 L 34 18"
        stroke={`${accent}80`}
        strokeWidth={0.8}
        strokeLinecap="round"
      />
      <path
        d="M 8 18 L 21 30"
        stroke={`${accent}80`}
        strokeWidth={0.8}
        strokeLinecap="round"
      />
      <path
        d="M 21 30 L 34 18"
        stroke={`${accent}80`}
        strokeWidth={0.8}
        strokeLinecap="round"
      />
      <path
        d="M 21 6 L 21 30"
        stroke={`${accent}80`}
        strokeWidth={0.8}
        strokeLinecap="round"
        strokeDasharray="1.5 1.5"
      />
      <circle cx={8}  cy={18} r={2.4} fill={accent} />
      <circle cx={21} cy={6}  r={2.4} fill={accent} />
      <circle cx={21} cy={30} r={2.4} fill={accent} />
      <circle cx={34} cy={18} r={2.4} fill={accent} />
    </svg>
  );
}

// ── State matrix · KG room across pending / working / complete ────

function KGStateMatrix() {
  const states: Array<{ state: RoomState; counts: Partial<RoomCounts>; label: string }> = [
    { state: "pending",  counts: {}, label: "PENDING" },
    { state: "active",   counts: { entities: 14, edges: 26, cycles: 0 }, label: "WORKING · 01:08" },
    { state: "complete", counts: { entities: 34, edges: 87, cycles: 3, bridges: 1 }, label: "DONE · 02:42" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 16,
      }}
    >
      {states.map((s) => (
        <div
          key={s.state}
          style={{
            padding: "16px 18px",
            borderRadius: 14,
            background: "white",
            border: "1px solid rgba(15,23,42,0.04)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "rgba(85,100,121,0.85)",
              fontFamily: '"SF Mono", ui-monospace, monospace',
              marginBottom: 12,
            }}
          >
            {s.label}
          </div>
          <UpgradedRoom stage="kg" state={s.state} counts={s.counts} />
        </div>
      ))}
    </div>
  );
}

// ── Scale matrix · KG room from sparse → typical → rich ──────────

function KGScaleMatrix() {
  const scales: Array<{ counts: Partial<RoomCounts>; label: string }> = [
    {
      counts: { entities: 5, edges: 4, cycles: 0 },
      label: "SPARSE · seed-only",
    },
    {
      counts: { entities: 34, edges: 87, cycles: 3 },
      label: "TYPICAL · post-decompose",
    },
    {
      counts: { entities: 128, edges: 312, cycles: 9, bridges: 4 },
      label: "RICH · multi-pass research",
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 16,
      }}
    >
      {scales.map((s, i) => (
        <div
          key={i}
          style={{
            padding: "16px 18px",
            borderRadius: 14,
            background: "white",
            border: "1px solid rgba(15,23,42,0.04)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "rgba(85,100,121,0.85)",
              fontFamily: '"SF Mono", ui-monospace, monospace',
              marginBottom: 12,
            }}
          >
            {s.label}
          </div>
          <UpgradedRoom stage="kg" state="complete" counts={s.counts} />
        </div>
      ))}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function buildSampleSubtitle(
  stage: PipelineStage,
  c: Partial<RoomCounts>,
): string {
  switch (stage) {
    case "intake":
      return `${c.assets ?? 0} ${(c.assets ?? 0) === 1 ? "asset" : "assets"}`;
    case "landscape": {
      const a = c.axes ?? 0;
      return a > 0 ? `${a} ${a === 1 ? "lens" : "lenses"} ready` : "Opening lenses…";
    }
    case "kg": {
      const parts: string[] = [];
      if (c.entities) parts.push(`${c.entities} entities`);
      if (c.edges) parts.push(`${c.edges} edges`);
      if (c.cycles) parts.push(`${c.cycles} cycles`);
      if (c.bridges) parts.push(`${c.bridges} bridge`);
      return parts.join(" · ") || "Decomposing…";
    }
    case "proposal": {
      const p = c.proposals ?? 0;
      return p > 0 ? `${p} ranked` : "Synthesizing…";
    }
    case "twin": {
      const p = c.proposals ?? 0;
      return p > 0 ? `Twin pinned · ${p} approved` : "Composing twin…";
    }
    case "lab": {
      const v = c.variants ?? 0;
      return v > 0 ? `${v} variants` : "Awaiting upstream";
    }
    case "reflexive":
      return "Background prospector · radar · calibration";
    case "results":
      return c.predictions ? `${c.predictions} recorded` : "Awaiting upstream";
  }
}
