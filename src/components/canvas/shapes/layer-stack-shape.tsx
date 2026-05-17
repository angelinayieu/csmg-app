"use client";

// ── Layer Stack shape ──────────────────────────────────────────────
//
// Vertical visualization of a space's domain-layer ontology — e.g. for
// Cognitive Performance: Exogenous → Behaviors → Biomarkers → Pathways
// → Symptoms → Cognitive → Composite. The ontology is first-class in
// the DB (migration 20260615) and already drives entity-card color
// badges via `useLayerOntology(spaceId)` — but the FULL stack hierarchy
// was invisible. This shape closes that gap.
//
// Anchored at the left edge of the KG room by canvas-operational-seed-
// spawner. One shape per space. Soft-fails to "no shape" when the
// ontology endpoint returns [] (legacy spaces / use-case templates
// without a declared ontology).
//
// Per-row anatomy:
//   ▌① EXOGENOUS              ← color bar (4px, layer.color) + ordinal
//     demographic                circle + label uppercase
//     environmental             ← typical_node_kinds (capped at 3,
//     stressor                    middle-dot separator)
//   ─ ─ ─ ─ ─ ─ ─ ─             ← row separator
//
// Layers stash as JSON because tldraw shape props are flat (no array-
// of-object support). Same pattern as probability-space-shell's
// entitiesJson. View parses on render.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useMemo } from "react";
import { Layers } from "lucide-react";
import type { LayerStackShape } from "./types";
import type { LayerDependencyKind } from "@/types/layer-ontology";

export const LAYER_STACK_DEFAULT_W = 180;
export const LAYER_STACK_DEFAULT_H = 560;
// D-track β — when cascade arrows render, they live in a fixed-width
// gutter on the right edge of the card. Internal-only constant; the
// shape's `w` is set by the seed-spawner based on hasDeps so the
// visible width matches the cascade presence.
export const LAYER_STACK_ARROW_GUTTER = 60;

interface ParsedLayer {
  id: string;
  ordinal: number;
  slug: string;
  label: string;
  color: string;
  typical_node_kinds: string[];
}

interface ParsedDependency {
  from_layer_id: string;
  to_layer_id: string;
  kind: LayerDependencyKind;
  strength: number;
  lag_label: string | null;
  mechanism: string;
}

const ORDINAL_GLYPHS: Record<number, string> = {
  1: "①",
  2: "②",
  3: "③",
  4: "④",
  5: "⑤",
  6: "⑥",
  7: "⑦",
  8: "⑧",
  9: "⑨",
  10: "⑩",
};

function ordinalGlyph(ordinal: number): string {
  return ORDINAL_GLYPHS[ordinal] ?? `${ordinal}.`;
}

function safeParseLayers(raw: string): ParsedLayer[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (l): l is ParsedLayer =>
          l != null &&
          typeof l === "object" &&
          typeof l.label === "string" &&
          typeof l.color === "string" &&
          typeof l.ordinal === "number",
      )
      .map((l) => ({
        ...l,
        typical_node_kinds: Array.isArray(l.typical_node_kinds)
          ? (l.typical_node_kinds as string[]).filter(
              (k) => typeof k === "string",
            )
          : [],
      }))
      .sort((a, b) => a.ordinal - b.ordinal);
  } catch {
    return [];
  }
}

const VALID_KINDS: ReadonlySet<LayerDependencyKind> = new Set([
  "causal",
  "modulatory",
  "inhibitory",
  "compensatory",
  "reinforcing",
]);

function safeParseDependencies(raw: string): ParsedDependency[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d): d is ParsedDependency =>
          d != null &&
          typeof d === "object" &&
          typeof d.from_layer_id === "string" &&
          typeof d.to_layer_id === "string" &&
          VALID_KINDS.has(d.kind) &&
          typeof d.strength === "number",
      )
      .map((d) => ({
        from_layer_id: d.from_layer_id,
        to_layer_id: d.to_layer_id,
        kind: d.kind as LayerDependencyKind,
        strength: Math.max(0, Math.min(1, d.strength)),
        lag_label: typeof d.lag_label === "string" ? d.lag_label : null,
        mechanism: typeof d.mechanism === "string" ? d.mechanism : "",
      }));
  } catch {
    return [];
  }
}

export class LayerStackShapeUtil extends BaseBoxShapeUtil<LayerStackShape> {
  static override type = "layer-stack" as const;
  static override props: RecordProps<LayerStackShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    layersJson: T.string,
    dependenciesJson: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => true;

  override onResize = (
    shape: LayerStackShape,
    info: TLResizeInfo<LayerStackShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): LayerStackShape["props"] {
    return {
      w: LAYER_STACK_DEFAULT_W,
      h: LAYER_STACK_DEFAULT_H,
      spaceId: "",
      layersJson: "[]",
      dependenciesJson: "[]",
    };
  }

  component(shape: LayerStackShape) {
    return <LayerStackView shape={shape} />;
  }

  indicator(shape: LayerStackShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />
    );
  }
}

function LayerStackView({ shape }: { shape: LayerStackShape }) {
  const { w, h, layersJson, dependenciesJson } = shape.props;
  const layers = useMemo(() => safeParseLayers(layersJson), [layersJson]);
  const dependencies = useMemo(
    () => safeParseDependencies(dependenciesJson),
    [dependenciesJson],
  );

  // D-track β — only render the arrow gutter when we have real cascade
  // data. Legacy spaces / pre-D-track snapshots skip the gutter entirely
  // so the card visually compacts back to its original 180px width.
  const hasCascades = layers.length >= 2 && dependencies.length > 0;
  const arrowGutter = hasCascades ? LAYER_STACK_ARROW_GUTTER : 0;

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        background: "white",
        border: "1px solid rgba(11,13,18,0.08)",
        borderRadius: 10,
        boxShadow: "0 1px 2px rgba(11,13,18,0.04)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid rgba(11,13,18,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Layers size={11} style={{ color: "rgba(11,13,18,0.40)" }} />
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(11,13,18,0.50)",
            flex: 1,
          }}
        >
          Domain Layers
        </span>
        {/* Cascade-count pill — only shown when dependencies are loaded.
            Tells the user "this stack has N inter-layer cascades" so the
            gutter on the right reads as data not decoration. */}
        {hasCascades && (
          <span
            title={`${dependencies.length} cross-layer cascade${dependencies.length === 1 ? "" : "s"}`}
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "rgba(11,13,18,0.55)",
              padding: "2px 6px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.78) 0%, rgba(11,13,18,0.04) 100%)",
              backdropFilter: "blur(8px) saturate(140%)",
              WebkitBackdropFilter: "blur(8px) saturate(140%)",
              border: "1px solid rgba(11,13,18,0.10)",
              boxShadow: "0 1px 0 rgba(255,255,255,0.6) inset",
              lineHeight: 1,
            }}
          >
            {dependencies.length} {dependencies.length === 1 ? "ripple" : "ripples"}
          </span>
        )}
      </div>

      {/* Empty state — shape SHOULDN'T spawn when this is empty (the
          spawner skips), but a defensive empty render here avoids a
          confusing white card if ever the JSON is corrupted. */}
      {layers.length === 0 && (
        <div
          style={{
            padding: 14,
            fontSize: 11,
            color: "rgba(11,13,18,0.40)",
            textAlign: "center",
          }}
        >
          No layer ontology declared for this space.
        </div>
      )}

      {/* Stack body + cascade arrow overlay. The body is flex-rows;
          the overlay is an absolutely-positioned SVG that paints curved
          arrows between row centers on the right edge of the stack. */}
      {layers.length > 0 && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "row",
            minHeight: 0,
            position: "relative",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            {layers.map((layer, i) => (
              <LayerRow
                key={layer.id ?? `${layer.slug}-${layer.ordinal}`}
                layer={layer}
                isLast={i === layers.length - 1}
              />
            ))}
          </div>

          {/* Cascade-arrow gutter — fixed width, transparent background,
              SVG fills it. Lives inside the body flex row so the row
              container's borderBottoms still paint behind the arrows. */}
          {hasCascades && (
            <CascadeArrowOverlay
              layers={layers}
              dependencies={dependencies}
              width={arrowGutter}
            />
          )}
        </div>
      )}
    </HTMLContainer>
  );
}

// ── Cascade arrow overlay ──────────────────────────────────────────
//
// SVG layer that paints one curved arrow per (from_layer, to_layer)
// cascade. The arrows live in a 60-px gutter on the right edge of the
// stack body. Each arrow's:
//   • origin Y = vertical center of the from-layer row
//   • destination Y = vertical center of the to-layer row
//   • curvature = signed quadratic Bezier control point offset to the
//     right; larger Δ-ordinal gets a wider arc so multi-layer jumps
//     don't kink into adjacent rows.
//   • color = the from-layer's hex (signals "this cascade originates here")
//   • stroke pattern + arrowhead = kind:
//       causal       → solid stroke, filled arrowhead
//       modulatory   → dashed 3-2 stroke, open arrowhead
//       inhibitory   → solid stroke, T-bar terminator (suppression)
//       compensatory → dashed 4-3 stroke, hollow square terminator
//       reinforcing  → solid stroke, double arrowhead (positive feedback)
//   • stroke-width = scaled by strength (1.2..2.2 px)
//   • opacity = 0.55..0.95 by strength
//
// The arrows render in a single SVG so the row container's borderBottoms
// can paint behind them via stacking order. Pointer-events: none so the
// arrows don't intercept tldraw selection.
function CascadeArrowOverlay({
  layers,
  dependencies,
  width,
}: {
  layers: ParsedLayer[];
  dependencies: ParsedDependency[];
  width: number;
}) {
  // Build a layer-id → ordinal-index map so each cascade knows which
  // row (top-down) to anchor against. The actual Y coord is computed
  // from CSS via flex equal-distribution — we use percentage
  // coordinates (vector-effect: non-scaling-stroke) so the SVG scales
  // cleanly with the parent height regardless of row count.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    layers.forEach((l, i) => m.set(l.id, i));
    return m;
  }, [layers]);

  // Filter to cascades where both endpoints exist in the layer set.
  // The cascade-prediction step already validates this against the
  // ontology, but a stale snapshot could carry a now-removed layer id.
  const renderable = useMemo(
    () =>
      dependencies.filter(
        (d) =>
          indexById.has(d.from_layer_id) &&
          indexById.has(d.to_layer_id) &&
          d.from_layer_id !== d.to_layer_id,
      ),
    [dependencies, indexById],
  );

  if (renderable.length === 0) return null;

  const n = layers.length;
  // Each row claims 1/n of the SVG height; the center of row i sits at
  // (i + 0.5) / n. Express as a percentage so the SVG scales freely.
  const centerY = (i: number) => ((i + 0.5) / n) * 100;

  // X anchors: rows live to the LEFT of the gutter, so origins start at
  // x=0 (right edge of the row) and curve outward. We want the arc to
  // bulge into the gutter so different ordinal-deltas read visually
  // distinct. Map ordinal-delta to a control-X 18..52 (out of width 60).
  const controlX = (delta: number) => {
    const absDelta = Math.max(1, Math.abs(delta));
    return Math.min(52, 18 + absDelta * 10);
  };

  return (
    <svg
      width={width}
      height="100%"
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      style={{
        position: "relative",
        pointerEvents: "none",
        flexShrink: 0,
      }}
      aria-hidden
    >
      <defs>
        {/* One marker per kind+color combo is impractical; instead,
            we render arrowheads inline as SVG primitives at the arrow's
            tip, sized + rotated to match the curve's terminal tangent.
            Defs here are kept minimal — only the universal soft glow
            filter that ALL arrows pull from. */}
        <filter id="cascadeGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>
      {renderable.map((dep, i) => {
        const fromIdx = indexById.get(dep.from_layer_id)!;
        const toIdx = indexById.get(dep.to_layer_id)!;
        const y1 = centerY(fromIdx);
        const y2 = centerY(toIdx);
        const fromLayer = layers[fromIdx];
        const color = fromLayer.color;
        const delta = toIdx - fromIdx;
        const cx = controlX(delta);
        // Curve to the RIGHT of the stack — origin x = 0, control x =
        // cx, destination x = 0. Quadratic Bezier so the arc has a
        // single peak; reads cleanly even with overlapping cascades.
        const path = `M 0 ${y1} Q ${cx} ${(y1 + y2) / 2} 0 ${y2}`;

        const strokeWidth = 1.2 + dep.strength * 1.0;
        const opacity = 0.55 + dep.strength * 0.4;

        const dash =
          dep.kind === "modulatory"
            ? "3 2"
            : dep.kind === "compensatory"
              ? "4 3"
              : undefined;

        // Approximate the terminal tangent direction: the path comes
        // INTO the destination point from the control point. The angle
        // the curve makes with horizontal at the endpoint is roughly
        // the line from (cx, midY) → (0, y2). Compute it in viewBox
        // units; the SVG's preserveAspectRatio="none" handles the
        // anamorphic scaling so the marker still renders at a sane
        // visual angle.
        const dx = 0 - cx;
        const dy = y2 - (y1 + y2) / 2;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

        const title = `${dep.kind} cascade · ${fromLayer.label} → ${layers[toIdx].label}${
          dep.lag_label ? ` · ${dep.lag_label}` : ""
        }${dep.mechanism ? ` — ${dep.mechanism}` : ""}`;

        return (
          <g key={`${dep.from_layer_id}-${dep.to_layer_id}-${i}`}>
            <title>{title}</title>
            {/* Soft glow underlay — same path, wider stroke, low opacity.
                Gives arrows a subtle visionOS lift without overpowering
                the row text. */}
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 2.5}
              opacity={opacity * 0.18}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              filter="url(#cascadeGlow)"
            />
            {/* Main arrow stroke */}
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeLinecap="round"
              strokeDasharray={dash}
              vectorEffect="non-scaling-stroke"
            />
            {/* Terminal marker — geometry varies by kind to encode
                propagation semantics. Translated to the destination
                point + rotated to the curve's terminal tangent. */}
            <g transform={`translate(0 ${y2}) rotate(${angleDeg})`}>
              <ArrowTerminator
                kind={dep.kind}
                color={color}
                opacity={opacity}
                strength={dep.strength}
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// Inline terminator markers — varied by cascade kind so the user can
// read the propagation type at a glance without color coding alone.
function ArrowTerminator({
  kind,
  color,
  opacity,
  strength,
}: {
  kind: LayerDependencyKind;
  color: string;
  opacity: number;
  strength: number;
}) {
  const size = 2.2 + strength * 1.4;

  switch (kind) {
    case "causal":
      // Filled triangle — classic mechanistic arrowhead
      return (
        <polygon
          points={`0,0 ${-size * 1.8},${-size * 0.9} ${-size * 1.8},${size * 0.9}`}
          fill={color}
          opacity={opacity}
        />
      );
    case "modulatory":
      // Open chevron — scales-not-drives
      return (
        <polyline
          points={`${-size * 2},${-size} 0,0 ${-size * 2},${size}`}
          fill="none"
          stroke={color}
          strokeWidth={1.3}
          opacity={opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      );
    case "inhibitory":
      // T-bar — standard suppression notation
      return (
        <line
          x1={0}
          y1={-size * 1.4}
          x2={0}
          y2={size * 1.4}
          stroke={color}
          strokeWidth={1.6}
          opacity={opacity}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      );
    case "compensatory":
      // Hollow rounded square — buffering / damping
      return (
        <rect
          x={-size * 1.4}
          y={-size * 0.9}
          width={size * 1.8}
          height={size * 1.8}
          rx={size * 0.45}
          fill="none"
          stroke={color}
          strokeWidth={1.3}
          opacity={opacity}
          vectorEffect="non-scaling-stroke"
        />
      );
    case "reinforcing":
      // Double filled triangle — positive feedback
      return (
        <g>
          <polygon
            points={`0,0 ${-size * 1.6},${-size * 0.8} ${-size * 1.6},${size * 0.8}`}
            fill={color}
            opacity={opacity}
          />
          <polygon
            points={`${-size * 1.8},0 ${-size * 3.4},${-size * 0.8} ${-size * 3.4},${size * 0.8}`}
            fill={color}
            opacity={opacity * 0.7}
          />
        </g>
      );
  }
}

function LayerRow({
  layer,
  isLast,
}: {
  layer: ParsedLayer;
  isLast: boolean;
}) {
  // Cap typical_node_kinds at 3 so the row doesn't blow out vertically
  // for layers with verbose kind taxonomies. The middle-dot separator
  // matches the existing canvas convention (see room subtitles).
  const kinds = layer.typical_node_kinds.slice(0, 3);
  const overflow = Math.max(0, layer.typical_node_kinds.length - kinds.length);
  const kindsText = overflow > 0
    ? `${kinds.join(" · ")} · +${overflow}`
    : kinds.join(" · ");

  return (
    <div
      style={{
        position: "relative",
        padding: "9px 12px 9px 18px",
        borderBottom: isLast ? "none" : "1px solid rgba(11,13,18,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Color bar — 4px wide, layer.color, runs full row height. The
          visual signal that ties this row to its layer's entity badges
          on kg-node shapes (which use the same color). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: layer.color,
        }}
      />

      {/* Header line: ordinal glyph + label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: layer.color,
            lineHeight: 1,
          }}
        >
          {ordinalGlyph(layer.ordinal)}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "rgba(11,13,18,0.78)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={layer.label}
        >
          {layer.label}
        </span>
      </div>

      {/* Typical node kinds — secondary line, smaller + muted. Hidden
          when the layer has no kinds declared. */}
      {kindsText && (
        <div
          style={{
            fontSize: 9,
            color: "rgba(11,13,18,0.45)",
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={layer.typical_node_kinds.join(", ")}
        >
          {kindsText}
        </div>
      )}
    </div>
  );
}
