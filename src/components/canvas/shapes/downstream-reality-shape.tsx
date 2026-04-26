"use client";

// ── Downstream Reality shape (Sprint A — wrap-what-exists pass) ────
//
// Tldraw wrapper around the DownstreamReality widget (see
// src/components/apps/widgets/downstream-reality-widget.tsx). Renders
// the variant-landscape heatmap (rows = variants × columns = latent
// outcome dimensions) as a first-class shape on the canvas so the
// painter can drop it during the downstream band of the unfurl.
//
// Storage model — all three joined payloads (reality, variants,
// taxonomy) are serialized to JSON strings on the shape. Keeps
// tldraw's flat prop validation happy; hydration happens once in
// the component via JSON.parse behind a memo. Version counter so
// upserts re-render when the painter patches the same shape.
//
// Read-only by design — the real dispatcher-backed view lives on the
// App detail page. Canvas shape is a snapshot.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useMemo, type ComponentType } from "react";
import type { DownstreamRealityShape } from "./types";
import { DownstreamReality } from "@/components/apps/widgets/downstream-reality-widget";
import { buildStandaloneWidgetSetup } from "@/lib/apps/standalone-widget-context";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { canvasNavigate, canvasDispatch } from "@/lib/canvas/canvas-bus";

// Widget components are Config-generic; the tldraw shape feeds a
// standalone context whose config type doesn't narrow. Cast once at
// the seam so the shape-side stays simple.
const WidgetComponent = DownstreamReality as unknown as ComponentType<WidgetComponentProps>;
import type {
  DownstreamReality as DownstreamRealityData,
} from "@/types/variant-outcomes";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
} from "@/types/experiment-taxonomy";

const DEFAULT_W = 560;
const DEFAULT_H = 360;

export class DownstreamRealityShapeUtil extends BaseBoxShapeUtil<DownstreamRealityShape> {
  static override type = "downstream-reality" as const;
  static override props: RecordProps<DownstreamRealityShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    appId: T.string.nullable(),
    title: T.string.nullable(),
    /** JSON-encoded DownstreamReality. */
    realityJson: T.string,
    /** JSON-encoded ExperimentVariant[]. */
    variantsJson: T.string,
    /** JSON-encoded ExperimentTaxonomy. */
    taxonomyJson: T.string,
    accent: T.string,
    version: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: DownstreamRealityShape,
    info: TLResizeInfo<DownstreamRealityShape>,
  ) => resizeBox(shape, info);

  // Sprint B.5 — double-click the heatmap card to open the app detail
  // page (the "full fidelity" version of this widget). Gated on appId
  // because space-level downstream-reality cards don't belong to any
  // single app. Falls back silently when no route is available.
  override onDoubleClick = (shape: DownstreamRealityShape) => {
    const { spaceId, appId } = shape.props;
    if (spaceId && appId) {
      canvasNavigate(`/app/space/${spaceId}/app/${appId}`);
    }
  };

  getDefaultProps(): DownstreamRealityShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      spaceId: "",
      appId: null,
      title: null,
      realityJson: "{}",
      variantsJson: "[]",
      taxonomyJson: "{}",
      accent: "#1a7aff",
      version: 0,
    };
  }

  component(shape: DownstreamRealityShape) {
    return <DownstreamRealityShapeView shape={shape} />;
  }

  indicator(shape: DownstreamRealityShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />
    );
  }
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

function DownstreamRealityShapeView({ shape }: { shape: DownstreamRealityShape }) {
  const {
    w,
    h,
    spaceId,
    appId,
    title,
    realityJson,
    variantsJson,
    taxonomyJson,
  } = shape.props;

  const setup = useMemo(() => {
    const reality = safeParse<DownstreamRealityData | null>(realityJson, null);
    const variants = safeParse<ExperimentVariant[]>(variantsJson, []);
    const taxonomy = safeParse<ExperimentTaxonomy | null>(taxonomyJson, null);
    return buildStandaloneWidgetSetup({
      widgetType: "downstream-reality",
      widgetId: `downstream-${shape.id}`,
      config: title ? { title } : {},
      data: { reality, variants, taxonomy },
      spaceId,
      appId,
      // Sprint B.5 — route in-widget dispatch/navigate through the
      // canvas bus. This card is mostly a visualization, but the
      // heatmap's row click emits a focus_variant dispatch we can
      // surface by opening the App detail page. Unknown actions
      // return ok:false so the widget can branch on failure.
      onDispatch: async (widgetId, actionKey, payload) => {
        const result = await canvasDispatch({
          widgetId,
          actionKey,
          payload,
          spaceId,
          appId,
        });
        return result;
      },
      onNavigate: canvasNavigate,
    });
  }, [realityJson, variantsJson, taxonomyJson, shape.id, title, spaceId, appId]);

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
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "auto",
          background: "rgba(255,255,255,0.98)",
          border: "1px solid rgba(15, 40, 90, 0.08)",
          boxShadow:
            "0 14px 40px -16px rgba(15, 40, 90, 0.22), 0 3px 12px rgba(15, 40, 90, 0.05)",
        }}
      >
        <WidgetComponent
          instance={setup.instance}
          context={setup.context}
        />
      </div>
    </HTMLContainer>
  );
}
