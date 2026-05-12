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

export const LAYER_STACK_DEFAULT_W = 180;
export const LAYER_STACK_DEFAULT_H = 560;

interface ParsedLayer {
  id: string;
  ordinal: number;
  slug: string;
  label: string;
  color: string;
  typical_node_kinds: string[];
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

export class LayerStackShapeUtil extends BaseBoxShapeUtil<LayerStackShape> {
  static override type = "layer-stack" as const;
  static override props: RecordProps<LayerStackShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    layersJson: T.string,
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
  const { w, h, layersJson } = shape.props;
  const layers = useMemo(() => safeParseLayers(layersJson), [layersJson]);

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
          }}
        >
          Domain Layers
        </span>
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

      {/* Stack body */}
      {layers.length > 0 && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
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
      )}
    </HTMLContainer>
  );
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
