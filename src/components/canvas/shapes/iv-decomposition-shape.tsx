"use client";

// ── IV Decomposition shape (Sprint A — wrap-what-exists pass) ──────
//
// Tldraw wrapper around the IVDecomposition widget (see
// src/components/apps/widgets/iv-decomposition-widget.tsx). Hero card
// of the experiment band — renders a ring-per-independent-variable
// breakdown of the active variant against the inferred taxonomy.
//
// Two JSON payloads:
//   • variantJson → VariantWithSlots (the active variant + per-slot
//     scores / previews / sparks)
//   • taxonomyJson → ExperimentTaxonomy (slot schema the rings
//     render against)
//
// Version counter lets the painter upsert without React treating a
// no-op prop mutation as unchanged. Read-only — real dispatcher
// interactions live on the App detail page.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useMemo, type ComponentType } from "react";
import type { IVDecompositionShape } from "./types";
import { IVDecomposition } from "@/components/apps/widgets/iv-decomposition-widget";
import { buildStandaloneWidgetSetup } from "@/lib/apps/standalone-widget-context";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { canvasNavigate, canvasDispatch } from "@/lib/canvas/canvas-bus";
import type {
  ExperimentTaxonomy,
  VariantWithSlots,
} from "@/types/experiment-taxonomy";

const DEFAULT_W = 560;
const DEFAULT_H = 280;

const WidgetComponent = IVDecomposition as unknown as ComponentType<WidgetComponentProps>;

export class IVDecompositionShapeUtil extends BaseBoxShapeUtil<IVDecompositionShape> {
  static override type = "iv-decomposition" as const;
  static override props: RecordProps<IVDecompositionShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    appId: T.string.nullable(),
    title: T.string.nullable(),
    dense: T.boolean,
    /** JSON-encoded VariantWithSlots. "null" when no active variant. */
    variantJson: T.string,
    /** JSON-encoded ExperimentTaxonomy. */
    taxonomyJson: T.string,
    accent: T.string,
    version: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: IVDecompositionShape,
    info: TLResizeInfo<IVDecompositionShape>,
  ) => resizeBox(shape, info);

  // Sprint B.5 — double-click the rings card to drill into the
  // App detail page where the full dispatcher-backed widget lives.
  // Space-level IV decompositions (no appId) are silently inert.
  override onDoubleClick = (shape: IVDecompositionShape) => {
    const { spaceId, appId } = shape.props;
    if (spaceId && appId) {
      canvasNavigate(`/app/space/${spaceId}/app/${appId}`);
    }
  };

  getDefaultProps(): IVDecompositionShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      spaceId: "",
      appId: null,
      title: null,
      dense: false,
      variantJson: "null",
      taxonomyJson: "{}",
      accent: "#1a7aff",
      version: 0,
    };
  }

  component(shape: IVDecompositionShape) {
    return <IVDecompositionShapeView shape={shape} />;
  }

  indicator(shape: IVDecompositionShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
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

function IVDecompositionShapeView({ shape }: { shape: IVDecompositionShape }) {
  const {
    w,
    h,
    spaceId,
    appId,
    title,
    dense,
    variantJson,
    taxonomyJson,
  } = shape.props;

  const setup = useMemo(() => {
    const variant = safeParse<VariantWithSlots | null>(variantJson, null);
    const taxonomy = safeParse<ExperimentTaxonomy | null>(taxonomyJson, null);
    return buildStandaloneWidgetSetup({
      widgetType: "iv-decomposition",
      widgetId: `ivdec-${shape.id}`,
      config: { title: title ?? undefined, dense },
      data: { variant, taxonomy },
      spaceId,
      appId,
      // Sprint B.5 — widget interactions (e.g. clicking a ring to
      // expand its slot panel) ride the canvas bus. Most rings
      // dispatches are internal UI state, but any manifest-backed
      // ones fall through to the registered dispatcher.
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
  }, [variantJson, taxonomyJson, shape.id, title, dense, spaceId, appId]);

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
