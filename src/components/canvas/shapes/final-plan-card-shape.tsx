"use client";

// ── Final-plan card shape util ────────────────────────────────────────
//
// Phase 2 of the canvas roadmap. This is the artifact users land on
// after approving a strategy — a PRD-style document on the whiteboard
// that they can iterate on, fork into a flowchart, export to a
// shareable URL, or (eventually) generate a prototype from.
//
// The card carries the execution-brief data baked into shape props
// (briefJson) so it survives reload without re-fetching. A (+) menu
// in the header switches between view modes:
//   - PRD       : default; long-form sectioned body
//   - Flowchart : ←→ to /api/spaces/[id]/final-plan-flowchart which
//                 paints arrow shapes near the card
//   - Prototype : placeholder; future generator
//   - Summary   : collapsed view (just headline + confidence chip)
//
// Header actions:
//   ↻ Regenerate     — re-fetch the brief and update body in place
//   📤 Open as PRD   — exports a /reports row + opens new tab
//   ⋯ More           — placeholder for future actions

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
  stopEventPropagation,
} from "tldraw";
import {
  Sparkles,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  FileText,
  GitBranch,
  Layout,
  Minimize2,
} from "lucide-react";
import type { FinalPlanCardShape } from "./types";
import type { ExecutionBrief } from "@/types/execution-brief";

const MIN_W = 360;
const MIN_H = 240;

const VIEW_MODES = ["prd", "flowchart", "prototype", "summary"] as const;

export class FinalPlanCardShapeUtil extends BaseBoxShapeUtil<FinalPlanCardShape> {
  static override type = "final-plan-card" as const;
  static override props: RecordProps<FinalPlanCardShape> = {
    w: T.number,
    h: T.number,
    planId: T.string,
    spaceId: T.string,
    recommendationId: T.string,
    title: T.string,
    viewMode: T.literalEnum(...VIEW_MODES),
    briefJson: T.string,
    evidenceCount: T.number,
    confidence: T.or(
      T.literalEnum("high", "moderate", "low"),
      T.literal(null as unknown as "high"),
    ),
    status: T.literalEnum("fresh", "regenerating", "stale", "error"),
    errorMessage: T.string.nullable(),
    generatedAt: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: FinalPlanCardShape,
    info: TLResizeInfo<FinalPlanCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): FinalPlanCardShape["props"] {
    return {
      w: 460,
      h: 460,
      planId: "",
      spaceId: "",
      recommendationId: "",
      title: "Final plan",
      viewMode: "prd",
      briefJson: "",
      evidenceCount: 0,
      confidence: null,
      status: "fresh",
      errorMessage: null,
      generatedAt: new Date().toISOString(),
    };
  }

  component(shape: FinalPlanCardShape) {
    return <FinalPlanCardBody shape={shape} />;
  }

  indicator(shape: FinalPlanCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}

// ── Body ──────────────────────────────────────────────────────────────

function FinalPlanCardBody({ shape }: { shape: FinalPlanCardShape }) {
  const { props } = shape;
  const accent = "#0891B2"; // cyan — distinct from violet (summary), amber (proposal)
  const isRegenerating = props.status === "regenerating";

  // Window-event firing helper. Handler component (mounted at canvas
  // overlay level) owns the actual mutation.
  const fire = (
    action:
      | "regenerate"
      | "open-as-prd"
      | "set-mode"
      | "open-strategy-drawer",
    payload?: Record<string, unknown>,
  ) => {
    window.dispatchEvent(
      new CustomEvent("final-plan-card:action", {
        detail: {
          planId: props.planId,
          shapeId: shape.id,
          action,
          payload,
        },
      }),
    );
  };

  let parsedBrief: ExecutionBrief | null = null;
  if (props.briefJson) {
    try {
      parsedBrief = JSON.parse(props.briefJson) as ExecutionBrief;
    } catch {
      parsedBrief = null;
    }
  }

  return (
    <HTMLContainer
      style={{ width: props.w, height: props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 16,
          background: "#ffffff",
          border: `1px solid ${accent}26`,
          boxShadow: `0 1px 3px rgba(0,0,0,0.04), 0 16px 40px -12px ${accent}33`,
          padding: "0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: accent,
          }}
        />

        {/* Header */}
        <div
          style={{
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(11,13,18,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
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
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                borderRadius: 6,
                background: `${accent}10`,
                color: accent,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              <Sparkles size={11} strokeWidth={2.4} />
              Final plan
              {props.confidence && (
                <span
                  style={{
                    marginLeft: 4,
                    padding: "1px 5px",
                    borderRadius: 4,
                    background:
                      props.confidence === "high"
                        ? "#dcfce7"
                        : props.confidence === "moderate"
                          ? "#fef9c3"
                          : "#fee2e2",
                    color:
                      props.confidence === "high"
                        ? "#166534"
                        : props.confidence === "moderate"
                          ? "#854d0e"
                          : "#991b1b",
                    fontSize: 9,
                    fontWeight: 800,
                  }}
                >
                  {props.confidence}
                </span>
              )}
            </div>

            {/* Action chips */}
            <div
              style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
              onPointerDown={stopEventPropagation}
            >
              <ActionButton
                title="Regenerate the brief"
                onClick={() => fire("regenerate")}
                disabled={isRegenerating}
              >
                <RefreshCw
                  size={11}
                  strokeWidth={2.4}
                  style={{
                    animation: isRegenerating ? "spin 1s linear infinite" : undefined,
                  }}
                />
              </ActionButton>
              <ActionButton
                title="Open as PRD (shareable URL)"
                onClick={() => fire("open-as-prd")}
                disabled={isRegenerating}
              >
                <ExternalLink size={11} strokeWidth={2.4} />
              </ActionButton>
            </div>
          </div>

          {/* Title */}
          <h2
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#0a1020",
              letterSpacing: "-0.015em",
              lineHeight: 1.25,
              margin: 0,
            }}
          >
            {props.title || "Final plan"}
          </h2>

          {/* View mode tabs */}
          <div
            onPointerDown={stopEventPropagation}
            style={{
              display: "flex",
              gap: 2,
              padding: 2,
              background: "#f1f5f9",
              borderRadius: 8,
              alignSelf: "flex-start",
            }}
          >
            <ViewModeTab
              active={props.viewMode === "prd"}
              onClick={() => fire("set-mode", { mode: "prd" })}
              icon={<FileText size={11} strokeWidth={2.4} />}
              label="PRD"
            />
            <ViewModeTab
              active={props.viewMode === "flowchart"}
              onClick={() => fire("set-mode", { mode: "flowchart" })}
              icon={<GitBranch size={11} strokeWidth={2.4} />}
              label="Flowchart"
            />
            <ViewModeTab
              active={props.viewMode === "prototype"}
              onClick={() => fire("set-mode", { mode: "prototype" })}
              icon={<Layout size={11} strokeWidth={2.4} />}
              label="Prototype"
            />
            <ViewModeTab
              active={props.viewMode === "summary"}
              onClick={() => fire("set-mode", { mode: "summary" })}
              icon={<Minimize2 size={11} strokeWidth={2.4} />}
              label="Summary"
            />
          </div>
        </div>

        {/* Body — branches on viewMode */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 14px",
            // Stop the canvas from stealing wheel events when the user
            // scrolls inside the card body.
            overscrollBehavior: "contain",
          }}
          onPointerDown={stopEventPropagation}
          onWheelCapture={(e) => e.stopPropagation()}
        >
          {props.viewMode === "summary" ? (
            <SummaryBody brief={parsedBrief} props={props} />
          ) : props.viewMode === "flowchart" ? (
            <FlowchartBody fire={fire} />
          ) : props.viewMode === "prototype" ? (
            <PrototypeBody />
          ) : (
            <PrdBody brief={parsedBrief} props={props} />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "8px 14px",
            borderTop: "1px solid rgba(11,13,18,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 9.5,
            color: "rgba(11,13,18,0.5)",
            fontWeight: 600,
          }}
        >
          <span>
            {props.evidenceCount} evidence ·{" "}
            {new Date(props.generatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <button
            type="button"
            onClick={() => fire("open-strategy-drawer")}
            onPointerDown={stopEventPropagation}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background: "transparent",
              border: "none",
              color: accent,
              cursor: "pointer",
              fontSize: 9.5,
              fontWeight: 700,
              padding: 0,
            }}
          >
            View in drawer
            <ChevronRight size={10} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

// ── View-mode bodies ──────────────────────────────────────────────────

function PrdBody({
  brief,
  props,
}: {
  brief: ExecutionBrief | null;
  props: FinalPlanCardShape["props"];
}) {
  if (!brief) {
    if (props.status === "regenerating") {
      return <PlaceholderText text="Generating PRD…" />;
    }
    if (props.status === "error" && props.errorMessage) {
      return (
        <PlaceholderText
          text={`Failed: ${props.errorMessage}`}
          color="#b91c1c"
        />
      );
    }
    return <PlaceholderText text="(No brief yet — click ↻ to generate)" />;
  }

  const causalChain = brief.research_backing?.causal_chain;
  const steps = brief.execution_steps ?? [];
  const alternatives = brief.alternative_approaches ?? [];

  return (
    <>
      <Section title="Causal chain">
        <p style={pStyle}>{causalChain || "—"}</p>
      </Section>

      {steps.length > 0 && (
        <Section title={`Execution plan · ${steps.length} steps`}>
          <ol style={olStyle}>
            {steps.slice(0, 8).map((step, i) => (
              <li key={i} style={liStyle}>
                <span style={{ fontWeight: 600, color: "#0a1020" }}>
                  {step.action || `Step ${i + 1}`}
                </span>
                {step.detail && (
                  <span style={{ color: "rgba(11,13,18,0.7)" }}>
                    {" — "}
                    {step.detail}
                  </span>
                )}
              </li>
            ))}
            {steps.length > 8 && (
              <li
                style={{ ...liStyle, color: "rgba(11,13,18,0.45)", listStyle: "none" }}
              >
                + {steps.length - 8} more steps in the drawer
              </li>
            )}
          </ol>
        </Section>
      )}

      {alternatives.length > 0 && (
        <Section title={`Alternatives considered · ${alternatives.length}`}>
          <ul style={ulStyle}>
            {alternatives.slice(0, 3).map((alt, i) => (
              <li key={i} style={liStyle}>
                <span style={{ fontWeight: 600 }}>
                  {alt.title || `Option ${i + 1}`}
                </span>
                {alt.description && (
                  <span style={{ color: "rgba(11,13,18,0.6)" }}>
                    {" — "}
                    {alt.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function SummaryBody({
  brief,
  props,
}: {
  brief: ExecutionBrief | null;
  props: FinalPlanCardShape["props"];
}) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.55, color: "rgba(11,13,18,0.74)" }}>
      <p style={{ margin: "0 0 8px" }}>
        <strong style={{ color: "#0a1020" }}>{props.title}</strong> —{" "}
        {props.evidenceCount} evidence sources, confidence {props.confidence ?? "—"}.
      </p>
      {brief?.research_backing?.causal_chain && (
        <p style={{ margin: 0 }}>{brief.research_backing.causal_chain}</p>
      )}
    </div>
  );
}

function FlowchartBody({
  fire,
}: {
  fire: (action: "regenerate" | "open-as-prd" | "set-mode" | "open-strategy-drawer") => void;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 10,
        padding: 16,
        color: "rgba(11,13,18,0.6)",
        fontSize: 12,
      }}
    >
      <GitBranch size={24} strokeWidth={1.6} />
      <p style={{ margin: 0, fontWeight: 600, color: "#0a1020" }}>
        Flowchart will paint next to this card
      </p>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55 }}>
        Click the button to generate flowchart shapes from the
        plan&apos;s execution steps. Each step becomes a node, and arrows
        connect adjacent steps.
      </p>
      <button
        type="button"
        onClick={() => {
          // The set-mode handler triggers the generator. Re-clicking
          // the flowchart tab is what actually fires the run.
          fire("set-mode");
        }}
        onPointerDown={stopEventPropagation}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          background: "#0891B2",
          color: "white",
          border: "none",
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
          marginTop: 4,
        }}
      >
        Generate flowchart
      </button>
    </div>
  );
}

function PrototypeBody() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 10,
        padding: 16,
        color: "rgba(11,13,18,0.6)",
        fontSize: 12,
      }}
    >
      <Layout size={24} strokeWidth={1.6} />
      <p style={{ margin: 0, fontWeight: 600, color: "#0a1020" }}>
        Prototype generator coming soon
      </p>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55 }}>
        Will produce a runnable UI sketch (or template) from this plan&apos;s
        execution steps. Until then, use the PRD or Flowchart view.
      </p>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────

function ActionButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      onPointerDown={stopEventPropagation}
      style={{
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        background: "transparent",
        border: "1px solid rgba(11,13,18,0.08)",
        color: "#586379",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

function ViewModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={stopEventPropagation}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        borderRadius: 6,
        background: active ? "#ffffff" : "transparent",
        border: "none",
        color: active ? "#0891b2" : "#64748b",
        fontSize: 10.5,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          color: "rgba(11,13,18,0.45)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 5,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function PlaceholderText({ text, color }: { text: string; color?: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 16,
        color: color ?? "rgba(11,13,18,0.5)",
        fontSize: 12,
        fontStyle: "italic",
      }}
    >
      {text}
    </div>
  );
}

const pStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "rgba(11,13,18,0.75)",
  margin: 0,
};

const olStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "rgba(11,13,18,0.75)",
  paddingLeft: 18,
  margin: 0,
};

const ulStyle: React.CSSProperties = { ...olStyle };

const liStyle: React.CSSProperties = {
  marginBottom: 4,
};

// Constants exported for the auto-trigger hook so it places cards
// consistent with the renderer's intrinsic dimensions.
export const FINAL_PLAN_CARD_DEFAULT_W = 460;
export const FINAL_PLAN_CARD_DEFAULT_H = 460;
export const FINAL_PLAN_CARD_MIN_W = MIN_W;
export const FINAL_PLAN_CARD_MIN_H = MIN_H;
