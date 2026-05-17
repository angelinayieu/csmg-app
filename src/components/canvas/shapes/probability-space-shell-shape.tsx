"use client";

// ── Probability Space Shell shape ──
//
// One card per axis the frame extractor opens (ACTORS, TIMELINE,
// CULTURAL, ASSUMPTIONS, RISK, …). Previously rendered as a chrome
// overlay (`ProbabilitySpaceRail`) — great looking, but it was
// viewport-pinned, couldn't be a tldraw arrow endpoint, and its
// `pointer-events-auto` shells ate drags that should have reached
// tldraw for panning.
//
// As a real tldraw shape each shell:
//   • pans/zooms with the canvas so the user reads it as part of the
//     graph, not a floating HUD
//   • is a valid arrow terminal so the painter can tether it UP to
//     the origin-prompt, giving the canvas a legible "thought →
//     lenses" spine
//   • no longer blocks pan — once outside the shell bounds, drags
//     hit tldraw directly
//
// Entities + edges + score ride as JSON strings because tldraw
// props schemas are flat. View parses them back out on render.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProbabilitySpaceShellShape } from "./types";
import { computeForceLayout } from "@/lib/graph/force-layout";
import { useAxisActive, useCanvasFilter } from "../hooks/use-canvas-filter";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";
import { useSituationFrame } from "../situation-frame-context";
import { useTrailOrAudit } from "../canvas-audit-mode-context";

// Lens display labels — keep aligned with src/lib/prompts/framing-lenses.ts
// `LensId`. Defined here (not imported from prompts) because shape utils
// must render synchronously on the canvas thread and we don't want a
// server-only prompt module pulled into the canvas bundle.
const LENS_DISPLAY: Record<string, string> = {
  systems_analyst: "Systems",
  skeptic: "Skeptic",
  operator: "Operator",
  engineer: "Engineer",
  historian: "Historian",
};
function lensLabel(id: string): string {
  return LENS_DISPLAY[id] ?? id.replace(/_/g, " ");
}

export const SPACE_SHELL_DEFAULT_W = 280;
export const SPACE_SHELL_DEFAULT_H = 200;

interface ShellEntity {
  entityId: string;
  name: string;
  weight: number;
  /** Phase 0 — how the entity was generated. `llm_axis_brainstorm`
   *  (the default for catalog axes) is rendered visually distinct
   *  from research-grounded entities so users don't trust mechanism-
   *  shaped LLM speculation as researched fact. Optional for legacy
   *  shells persisted before the field existed. */
  confidenceBasis?:
    | "llm_axis_brainstorm"
    | "paper_extracted"
    | "research_grounded"
    | "user_authored";
}
interface ShellEdge {
  sourceEntityId: string;
  targetEntityId: string;
  mechanism: string;
  polarity: "positive" | "negative" | "conditional" | "neutral";
  dynamics: string;
  confidence: number;
}
interface ShellScore {
  weighted: number;
  breakdown: {
    specificity: number;
    mechanism_depth: number;
    distinctness: number;
    coverage: number;
    insight_density: number;
  } | null;
  notes: string;
}

function safeParse<T>(json: string, fallback: T): T {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export class ProbabilitySpaceShellShapeUtil extends BaseBoxShapeUtil<ProbabilitySpaceShellShape> {
  static override type = "probability-space-shell" as const;
  static override props: RecordProps<ProbabilitySpaceShellShape> = {
    w: T.number,
    h: T.number,
    spaceKey: T.string,
    axis: T.string,
    label: T.string,
    tagline: T.string,
    accent: T.string,
    rationale: T.string,
    orderIndex: T.number,
    entitiesJson: T.string,
    edgesJson: T.string,
    merging: T.boolean,
    scoreJson: T.string,
    failureJson: T.string,
    pulse: T.number,
    /** B3 — set true for ad-hoc framing-panel axes; drives the
     *  "custom" chip + dashed border in the view. */
    isCustom: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ProbabilitySpaceShellShape,
    info: TLResizeInfo<ProbabilitySpaceShellShape>,
  ) => resizeBox(shape, info);

  // Double-click to drill into the full probability-space view for
  // this axis. The shell shape doesn't carry the parent space's UUID
  // (only its axis identifier), so we extract it from the URL — the
  // canvas is always mounted under /app/space/<id>/whiteboard.
  override onDoubleClick = (shape: ProbabilitySpaceShellShape) => {
    if (typeof window === "undefined") return;
    const m = window.location.pathname.match(/\/app\/space\/([^/]+)/);
    const spaceId = m?.[1];
    if (!spaceId || !shape.props.axis) return;
    canvasNavigate(
      `/app/space/${spaceId}/probability-space/${encodeURIComponent(shape.props.axis)}`,
    );
  };

  getDefaultProps(): ProbabilitySpaceShellShape["props"] {
    return {
      w: SPACE_SHELL_DEFAULT_W,
      h: SPACE_SHELL_DEFAULT_H,
      spaceKey: "",
      axis: "",
      label: "",
      tagline: "",
      accent: "#2563eb",
      rationale: "",
      orderIndex: 0,
      entitiesJson: "[]",
      edgesJson: "[]",
      merging: false,
      scoreJson: "",
      failureJson: "",
      pulse: 0,
      isCustom: false,
    };
  }

  component(shape: ProbabilitySpaceShellShape) {
    return <ShellView shape={shape} />;
  }

  indicator(shape: ProbabilitySpaceShellShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />
    );
  }
}

interface ShellFailure {
  reason: "thin_output" | "hard_fail" | "timeout";
  errorMessage: string | null;
}

function ShellView({ shape }: { shape: ProbabilitySpaceShellShape }) {
  const {
    w,
    h,
    axis,
    label,
    tagline,
    accent,
    rationale,
    merging,
    entitiesJson,
    edgesJson,
    scoreJson,
    failureJson,
    isCustom,
  } = shape.props;
  // Phase 3 — sidebar filter. When the user has selected a subset of
  // axes from the legend, dim shells outside that subset so the
  // soloed lens reads as "the focus." Empty selection = no dimming.
  const axisActive = useAxisActive(axis);
  // Phase 7 — shell layout mode. In "stack" mode the soloed axis
  // (axisActive=true) renders normally; non-soloed shells recede
  // visually (scale + opacity) so the canvas reads as one focused
  // landscape with peer lenses receding into the background. The
  // user's "3D layered landscape" mental model.
  const layoutMode = useCanvasFilter((s) => s.shellLayoutMode);
  const stackedRecede = layoutMode === "stack" && !axisActive;
  const entities = safeParse<ShellEntity[]>(entitiesJson, []);
  const edges = safeParse<ShellEdge[]>(edgesJson, []);
  const score = scoreJson ? safeParse<ShellScore | null>(scoreJson, null) : null;
  const failure = failureJson
    ? safeParse<ShellFailure | null>(failureJson, null)
    : null;
  const isEmpty = entities.length === 0;

  const [expanded, setExpanded] = useState(false);
  // Hover-expand: when the user hovers the shell body and audit-mode is
  // trail-or-audit, auto-expand the "Why this lens" panel after a brief
  // delay so a passing cursor doesn't trigger it. Cursor-leave collapses
  // unless the user has clicked the expand button (which sets
  // `expandLocked`) — that way an explicit click sticks even if the
  // user moves their cursor off the card.
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [expandLocked, setExpandLocked] = useState(false);
  const auditOrTrail = useTrailOrAudit();
  const hoverTimerRef = useRef<number | null>(null);
  const onShellEnter = useCallback(() => {
    if (!auditOrTrail) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverExpanded(true);
    }, 220);
  }, [auditOrTrail]);
  const onShellLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverExpanded(false);
  }, []);
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);
  // Effective expansion = user clicked (sticky) OR cursor is hovering.
  const effectiveExpanded = expandLocked || expanded || hoverExpanded;

  // Lens attribution from the situation frame — joins axis → target_cells
  // → supporting_lenses so the shell can show "which lenses argued for
  // this axis." Returns null on legacy spaces / mid-pipeline mounts; the
  // chips row hides entirely when null or when the lens set is empty.
  const { getLensSupportForAxis, frame } = useSituationFrame();
  const lensSupport = useMemo(
    () => (axis ? getLensSupportForAxis(axis) : null),
    [axis, getLensSupportForAxis],
  );
  // Total lens count from the frame so the chips row can render
  // "X of N" without hardcoding the panel's 5-lens default (users can
  // disable lenses via reasoning_settings.lenses).
  const lensesUsedCount = frame?.lenses_used?.length ?? 0;

  // Phase 1 — replace the chip list with a real mini-graph. Layout
  // is memoized on the JSON-string contents so it only recomputes
  // when the painter mutates the shell (entity / edge added). Cap
  // at 12 nodes for readability inside the small viewport — overflow
  // is reported as a "+N" badge below the graph.
  const graphMaxNodes = 12;
  const graphEntities = entities.slice(0, graphMaxNodes);
  const graphOverflow = Math.max(0, entities.length - graphEntities.length);
  // Graph viewport: shell body area minus padding for header/footer.
  // Header ≈ 60, footer (lens-expand button + score) ≈ 50, gap 8 each
  // side. The shell can be resized so we recompute from props each
  // render — cheap, since the layout itself is memoized.
  const graphViewportW = Math.max(120, w - 32);
  const graphViewportH = Math.max(80, h - 168);
  const layout = useMemo(
    () => {
      const allowedIds = new Set(graphEntities.map((e) => e.entityId));
      const filteredEdges = edges
        .filter(
          (e) =>
            allowedIds.has(e.sourceEntityId) &&
            allowedIds.has(e.targetEntityId),
        )
        .map((e) => ({ source: e.sourceEntityId, target: e.targetEntityId }));
      return computeForceLayout(
        graphEntities.map((e) => ({ id: e.entityId, weight: e.weight })),
        filteredEdges,
        {
          width: graphViewportW,
          height: graphViewportH,
          padding: 10,
        },
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [entitiesJson, edgesJson, graphViewportW, graphViewportH],
  );

  // Quick lookup: entityId → name for label rendering.
  const idToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.entityId, e.name);
    return m;
  }, [entities]);

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
        overflow: "hidden",
      }}
    >
      <div
        onMouseEnter={onShellEnter}
        onMouseLeave={onShellLeave}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(16px)",
          // B3 — dashed accent-tinted border for ad-hoc / custom axes;
          // canonical axes keep the subtle solid hairline. The dashed
          // pattern reads as "this lens was hand-minted for your
          // situation, not pulled from the standard catalog."
          border: isCustom
            ? `1.5px dashed color-mix(in srgb, ${accent} 55%, transparent)`
            : "1px solid rgba(15,23,42,0.06)",
          boxShadow:
            "0 1px 2px rgba(16,24,40,0.04), 0 12px 32px -14px rgba(16,24,40,0.14)",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          opacity: stackedRecede
            ? 0.42
            : !axisActive
              ? 0.28
              : merging
                ? 0.6
                : 1,
          // Phase 7 — when stack-receded, scale down + push slightly
          // up + drop a softer shadow so the shell visually steps
          // back. transformOrigin keeps the recede pivoting around
          // top-center so the soloed shell (rendered at full size)
          // reads as the front of the stack.
          transform: stackedRecede
            ? "scale(0.78) translateY(-12px)"
            : undefined,
          transformOrigin: "top center",
          transition:
            "opacity 320ms ease, transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          overflow: "hidden",
        }}
      >
        {/* Soft density field */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            background: `radial-gradient(ellipse 85% 55% at 50% 15%, color-mix(in srgb, ${accent} 14%, transparent) 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
        {/* Header — adaptive label (LLM-generated, domain-adapted) on
            the left; canonical axis slug on the right as a small chip
            so power users can see "ah, this adapted name maps to the
            financial axis vocab" without the slug being the headline.
            The catalog tagline stays as a secondary subtitle showing
            the canonical frame's broad purpose. */}
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: accent,
                  minWidth: 0,
                }}
                title={label}
              >
                {label}
              </div>
              {axis && (
                isCustom ? (
                  // B3 — custom-axis chip. Dashed accent border +
                  // tinted fill so it visually pops from the gray
                  // canonical chip; tooltip explains what "custom"
                  // means + names the underlying axis_id slug.
                  <span
                    title={`Custom axis minted by the framing panel · slug: ${axis}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: accent,
                      background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                      border: `1px dashed ${accent}`,
                      borderRadius: 4,
                      padding: "1px 5px",
                      flexShrink: 0,
                    }}
                  >
                    custom
                  </span>
                ) : (
                  <span
                    title={`Canonical axis: ${axis}`}
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "lowercase",
                      color: "rgba(100, 116, 139, 0.85)",
                      background: "rgba(100, 116, 139, 0.10)",
                      border: "1px solid rgba(100, 116, 139, 0.20)",
                      borderRadius: 4,
                      padding: "1px 5px",
                      flexShrink: 0,
                    }}
                  >
                    {axis}
                  </span>
                )
              )}
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                fontWeight: 500,
                color: "#64748b",
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {tagline}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            {failure ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#b91c1c",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
                title={failure.errorMessage ?? undefined}
              >
                {failure.reason === "thin_output" ? "thin" : "failed"}
              </span>
            ) : isEmpty ? (
              <span style={{ fontSize: 10, fontStyle: "italic", color: "#94a3b8" }}>opening…</span>
            ) : (
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  color: accent,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {entities.length}
              </span>
            )}
          </div>
        </div>

        {/* Core indicator — names what this lens centers on. Sits in
            its own row between the header and the mini-graph so it
            cannot collide with the title or count chip. (Was previously
            absolutely-positioned inside the svg container which caused
            the badge to visually overlap the header text.) */}
        {entities.length > 0 && layout.coreId && (() => {
          const coreName = idToName.get(layout.coreId);
          if (!coreName) return null;
          const coreNode = layout.nodes.find((n) => n.id === layout.coreId);
          const coreDegree = coreNode?.degree ?? 0;
          return (
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 4,
                marginTop: -2,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: accent,
                  maxWidth: "100%",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={`${coreName} · ${coreDegree} connection${coreDegree === 1 ? "" : "s"}`}
              >
                ⌖ {coreName}
              </span>
            </div>
          );
        })()}

        {/* Mini-graph (Phase 1 — replaces flat chip list) */}
        {entities.length > 0 && (
          <ShellMiniGraph
            viewportW={graphViewportW}
            viewportH={graphViewportH}
            accent={accent}
            nodes={layout.nodes}
            edges={edges}
            coreId={layout.coreId}
            idToName={idToName}
            graphEntities={graphEntities}
            graphOverflow={graphOverflow}
          />
        )}

        {/* Failure explanation */}
        {failure && (
          <div
            style={{
              position: "relative",
              alignSelf: "stretch",
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(185,28,28,0.06)",
              border: "1px solid rgba(185,28,28,0.15)",
              color: "#991b1b",
              fontSize: 10.5,
              fontWeight: 500,
              lineHeight: 1.4,
            }}
            role="alert"
          >
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2 }}>
              {failure.reason === "thin_output"
                ? "Axis produced thin output"
                : failure.reason === "timeout"
                  ? "Axis generator timed out"
                  : "Axis generator failed"}
            </div>
            {failure.errorMessage && (
              <div style={{ fontWeight: 400, opacity: 0.85 }}>
                {failure.errorMessage}
              </div>
            )}
          </div>
        )}

        {/* Score pill (when available) */}
        {score && typeof score.weighted === "number" && (
          <div
            style={{
              position: "relative",
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 999,
              fontSize: 9.5,
              fontWeight: 600,
              background:
                score.weighted >= 0.7
                  ? "rgba(22,163,74,0.1)"
                  : score.weighted >= 0.4
                    ? "rgba(217,119,6,0.1)"
                    : "rgba(220,38,38,0.08)",
              color:
                score.weighted >= 0.7
                  ? "#16a34a"
                  : score.weighted >= 0.4
                    ? "#b45309"
                    : "#b91c1c",
            }}
            title={score.notes || "Semantic rigor score"}
          >
            rigor {Math.round(score.weighted * 100)}
          </div>
        )}

        {/* Lens provenance footer — always-visible attribution row.
            Renders ONLY when the situation frame has been fetched AND the
            joined cell→lens lookup found a non-empty set. Legacy spaces
            (pre-frame-panel) and mid-pipeline mounts before the panel
            commits a frame both fall to null and hide the row, so we
            never show a misleading "0 lenses" badge.

            Reads as: ←  Skeptic · Engineer  · 3 of 5
                      └ lens chips        └ axis_support / total

            Lens chip count is capped at 3 inline (with +N for overflow)
            so the row stays single-line at the shell's 280px width even
            when all 5 lenses backed an axis. */}
        {auditOrTrail && lensSupport && lensSupport.lenses.length > 0 && (
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "nowrap",
              overflow: "hidden",
              marginTop: 2,
            }}
            title={
              `Backed by lens${lensSupport.lenses.length === 1 ? "" : "es"}: ` +
              lensSupport.lenses.map(lensLabel).join(", ") +
              ` · ${lensSupport.axisSupportCount} of ${lensesUsedCount || lensSupport.lenses.length} lenses independently proposed this axis`
            }
          >
            <span
              aria-hidden
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.08em",
                color: "#94a3b8",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              ←
            </span>
            {lensSupport.lenses.slice(0, 3).map((id) => (
              <span
                key={id}
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  color: "#475569",
                  background: "rgba(100, 116, 139, 0.08)",
                  border: "1px solid rgba(100, 116, 139, 0.16)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {lensLabel(id)}
              </span>
            ))}
            {lensSupport.lenses.length > 3 && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 500,
                  color: "#94a3b8",
                  flexShrink: 0,
                }}
              >
                +{lensSupport.lenses.length - 3}
              </span>
            )}
            {lensesUsedCount > 0 && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: "#94a3b8",
                  marginLeft: 2,
                  flexShrink: 0,
                }}
                aria-label={`Axis support: ${lensSupport.axisSupportCount} of ${lensesUsedCount}`}
              >
                · {lensSupport.axisSupportCount}/{lensesUsedCount}
              </span>
            )}
          </div>
        )}

        {/* Why this lens — expand/collapse */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            // Explicit click toggles + locks: once clicked, the panel
            // stays open (or closed) regardless of hover, so a user
            // who scrolls reading the breakdown doesn't lose it.
            setExpanded((v) => !v);
            setExpandLocked(true);
          }}
          style={{
            position: "relative",
            marginTop: "auto",
            border: "none",
            borderTop: "1px solid rgba(15,23,42,0.06)",
            background: "transparent",
            padding: "8px 0 0",
            textAlign: "left",
            fontSize: 10.5,
            fontWeight: 500,
            color: "#64748b",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{effectiveExpanded ? "Hide context" : "Why this lens"}</span>
          <span style={{ fontSize: 9, color: "#94a3b8" }}>
            {effectiveExpanded ? "▲" : "▼"}
          </span>
        </button>
        {effectiveExpanded && (
          <div
            style={{
              position: "relative",
              fontSize: 11,
              lineHeight: 1.45,
              color: "#475569",
              maxHeight: 120,
              overflowY: "auto",
            }}
          >
            {rationale || "No rationale recorded."}
            {edges.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: "#64748b" }}>
                {edges.length} mechanism{edges.length === 1 ? "" : "s"} traced
              </div>
            )}
            {/* Expanded lens breakdown — shown when the frame is loaded
                so the user can see exactly which lenses backed this axis
                + how confident the per-cell consensus was. Mean cell
                confidence renders as a small badge; the lens list is the
                full set (not truncated like the footer row). Hidden when
                no lens data is available rather than showing an empty
                "Backed by:" section. */}
            {lensSupport && lensSupport.lenses.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 6,
                  borderTop: "1px dashed rgba(15,23,42,0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    Backed by
                  </span>
                  {lensSupport.meanCellConfidence > 0 && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: "#64748b",
                        background: "rgba(100, 116, 139, 0.10)",
                        borderRadius: 3,
                        padding: "1px 4px",
                      }}
                      title="Mean confidence across the cells this axis targets"
                    >
                      cell conf {Math.round(lensSupport.meanCellConfidence * 100)}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                  }}
                >
                  {lensSupport.lenses.map((id) => (
                    <span
                      key={id}
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: "#334155",
                        background: "rgba(100, 116, 139, 0.10)",
                        border: "1px solid rgba(100, 116, 139, 0.18)",
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      {lensLabel(id)}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: "#94a3b8",
                  }}
                >
                  {lensSupport.axisSupportCount} of{" "}
                  {lensesUsedCount || lensSupport.lenses.length} lenses
                  independently proposed this axis
                  {lensSupport.source === "ad_hoc" && " · panel-minted"}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

// ── Mini-graph view (Phase 1) ──
//
// Renders the shell's entities + edges as a real force-directed
// graph instead of the prior chip list. Color/size encode:
//   - Fill: axis accent (varying saturation by node weight)
//   - Stroke: white halo for "core" (highest-degree) node; thin
//     accent stroke for everyone else
//   - Size: scaled by max(weight, degree) so hubs stand out
//   - Edge color: polarity-coded (green positive, red negative,
//     amber conditional, gray neutral)
//
// Phase 2 will add per-entity kind colors + canonical-signature
// rings + click-to-detail drawer. Phase 1 keeps the kind/depth
// hydration off the critical path because shell events don't carry
// those fields yet.
//
// Click handler dispatches a window CustomEvent so the canvas can
// route it (Phase 2 wires the detail drawer; until then the click
// is a no-op listener slot).

const POLARITY_STROKE: Record<ShellEdge["polarity"], string> = {
  positive: "rgba(22, 163, 74, 0.55)",
  negative: "rgba(220, 38, 38, 0.55)",
  conditional: "rgba(217, 119, 6, 0.55)",
  neutral: "rgba(100, 116, 139, 0.4)",
};

interface ShellMiniGraphProps {
  viewportW: number;
  viewportH: number;
  accent: string;
  nodes: Array<{ id: string; x: number; y: number; degree: number }>;
  edges: ShellEdge[];
  coreId: string | null;
  idToName: Map<string, string>;
  graphEntities: ShellEntity[];
  graphOverflow: number;
}

function ShellMiniGraph({
  viewportW,
  viewportH,
  accent,
  nodes,
  edges,
  coreId,
  idToName,
  graphEntities,
  graphOverflow,
}: ShellMiniGraphProps) {
  const positionById = useMemo(() => {
    const m = new Map<string, { x: number; y: number; degree: number }>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Weight lookup for node radius. Max weight in the shell becomes
  // the size reference so the largest node hits ~9px and others scale
  // down proportionally.
  const weightById = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of graphEntities) m.set(e.entityId, e.weight);
    return m;
  }, [graphEntities]);
  // Phase 0 — speculative-vs-grounded lookup. Catalog/ad-hoc axis
  // entities all currently land as `llm_axis_brainstorm` (one LLM call,
  // no sources). Used below to render them with a dashed stroke so
  // users don't read mechanism-shaped LLM speculation as researched fact.
  const isSpeculativeById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const e of graphEntities) {
      m.set(e.entityId, e.confidenceBasis === "llm_axis_brainstorm");
    }
    return m;
  }, [graphEntities]);
  const maxWeight = Math.max(
    0.001,
    ...graphEntities.map((e) => e.weight),
  );
  const maxDegree = Math.max(
    1,
    ...nodes.map((n) => n.degree),
  );

  // Edges that connect two laid-out nodes (others are dropped — usually
  // because the target wasn't in the top-N visible slice).
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (e) =>
          positionById.has(e.sourceEntityId) &&
          positionById.has(e.targetEntityId),
      ),
    [edges, positionById],
  );

  const handleNodeClick = (entityId: string) => {
    try {
      window.dispatchEvent(
        new CustomEvent("shell-graph:focus", { detail: { entityId } }),
      );
    } catch {
      /* no-op — feature flag-gated by Phase 2's listener */
    }
  };

  // Find the core's name + degree for the corner badge so the user
  // immediately knows what this lens centers on.
  const coreName = coreId ? idToName.get(coreId) : null;
  const coreDegree = coreId ? positionById.get(coreId)?.degree ?? 0 : 0;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: viewportH,
      }}
    >
      <svg
        width={viewportW}
        height={viewportH}
        viewBox={`0 0 ${viewportW} ${viewportH}`}
        style={{
          display: "block",
          overflow: "visible",
        }}
      >
        {/* Edges */}
        {visibleEdges.map((edge, i) => {
          const a = positionById.get(edge.sourceEntityId)!;
          const b = positionById.get(edge.targetEntityId)!;
          const stroke = POLARITY_STROKE[edge.polarity] ?? POLARITY_STROKE.neutral;
          const dashed = edge.polarity === "conditional";
          // Confidence drives stroke opacity: low-confidence edges
          // appear ghosted so the user reads the "soft" relationships
          // as such.
          const opacity = 0.45 + Math.max(0, Math.min(1, edge.confidence ?? 0.5)) * 0.55;
          return (
            <line
              key={`e-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeWidth={1}
              strokeDasharray={dashed ? "3 2" : undefined}
              opacity={opacity}
            />
          );
        })}
        {/* Nodes */}
        {nodes.map((n) => {
          const isCore = n.id === coreId;
          const weight = weightById.get(n.id) ?? 0.5;
          // Size: scales 4..9 based on max(weight, degreeRatio) so
          // hubs by either measure are visually larger.
          const sizeBasis = Math.max(weight / maxWeight, n.degree / maxDegree);
          const r = 3.5 + sizeBasis * 5;
          // Fill saturation: weight modulates how bold the accent is.
          const saturationPct = Math.round(20 + weight * 60);
          const fill = `color-mix(in srgb, ${accent} ${saturationPct}%, white)`;
          return (
            <g
              key={`n-${n.id}`}
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleNodeClick(n.id);
              }}
            >
              {isCore && (
                // Soft halo behind the core node so it reads as the
                // "center of gravity" without us having to label
                // every node — labels would clutter at this scale.
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r + 4}
                  fill={`color-mix(in srgb, ${accent} 18%, transparent)`}
                  opacity={0.9}
                />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={r}
                fill={fill}
                stroke={isCore ? accent : `color-mix(in srgb, ${accent} 50%, white)`}
                strokeWidth={isCore ? 1.6 : 1}
                // Speculative entities (LLM brainstorm, no source) get a
                // dashed outline so they're visibly distinct from
                // research-grounded nodes. Phase 0.
                strokeDasharray={isSpeculativeById.get(n.id) ? "2 2" : undefined}
              />
              <title>
                {(idToName.get(n.id) ?? n.id) +
                  (isSpeculativeById.get(n.id)
                    ? "  ·  speculative (LLM brainstorm, no source)"
                    : "")}
              </title>
            </g>
          );
        })}
      </svg>
      {/* Core badge moved out — was absolutely-positioned at top:0 right:0
          of this svg container which collided visually with the parent's
          header (count chip + tagline). Parent now renders a dedicated
          "core indicator" row between the header and the mini-graph so
          there's no overlap regardless of card height.
          coreName + coreDegree intentionally still computed above for
          the title attribute on hover. */}
      <span style={{ display: "none" }} aria-hidden>
        {coreName ? `core:${coreName}/${coreDegree}` : null}
      </span>
      {/* Overflow note */}
      {graphOverflow > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            fontSize: 9,
            color: "rgba(15,23,42,0.45)",
            fontStyle: "italic",
          }}
          title={`${graphOverflow} more entit${graphOverflow === 1 ? "y" : "ies"} not shown — open detail to see all`}
        >
          +{graphOverflow} more
        </div>
      )}
    </div>
  );
}
