"use client";

// ── Variant Carousel shape (Sprint A — wrap-what-exists pass) ──────
//
// Tldraw wrapper around the VariantCarousel widget (see
// src/components/apps/widgets/variant-carousel-widget.tsx). Coverflow
// of experiment variants — active front-and-center, siblings drifting
// back in 3D. The wrapper feeds plain JSON payloads (variants +
// taxonomy) through the standalone widget context so the underlying
// interactive component renders inside tldraw's HTMLContainer.
//
// Variant activation / focus dispatches are no-ops in this surface —
// clicking a card still shifts the cursor locally (that's internal
// widget state), but `dispatch("activate", …)` silently fails because
// the canvas shape isn't bound to the real App dispatcher. Real
// activation goes through the App detail page; this shape is a
// cinematic preview.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useMemo, type ComponentType } from "react";
import type { VariantCarouselShape } from "./types";
import { VariantCarousel } from "@/components/apps/widgets/variant-carousel-widget";
import { buildStandaloneWidgetSetup } from "@/lib/apps/standalone-widget-context";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { canvasNavigate, canvasDispatch } from "@/lib/canvas/canvas-bus";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
} from "@/types/experiment-taxonomy";

const DEFAULT_W = 680;
const DEFAULT_H = 340;

const WidgetComponent = VariantCarousel as unknown as ComponentType<WidgetComponentProps>;

export class VariantCarouselShapeUtil extends BaseBoxShapeUtil<VariantCarouselShape> {
  static override type = "variant-carousel" as const;
  static override props: RecordProps<VariantCarouselShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    appId: T.string.nullable(),
    title: T.string.nullable(),
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
    shape: VariantCarouselShape,
    info: TLResizeInfo<VariantCarouselShape>,
  ) => resizeBox(shape, info);

  // Sprint B.5 — double-click the carousel to open the App detail page
  // where the real dispatcher-backed widget lives. Single-click inside
  // the carousel still routes through the widget's own onClick handlers
  // (activate/focus) — see the onDispatch wired in the View below.
  override onDoubleClick = (shape: VariantCarouselShape) => {
    const { spaceId, appId } = shape.props;
    if (spaceId && appId) {
      canvasNavigate(`/app/space/${spaceId}/app/${appId}`);
    }
  };

  getDefaultProps(): VariantCarouselShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      spaceId: "",
      appId: null,
      title: null,
      variantsJson: "[]",
      taxonomyJson: "{}",
      accent: "#8a56cc",
      version: 0,
    };
  }

  component(shape: VariantCarouselShape) {
    return <VariantCarouselShapeView shape={shape} />;
  }

  indicator(shape: VariantCarouselShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
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

function VariantCarouselShapeView({ shape }: { shape: VariantCarouselShape }) {
  const {
    w,
    h,
    spaceId,
    appId,
    title,
    variantsJson,
    taxonomyJson,
  } = shape.props;

  const setup = useMemo(() => {
    const variants = safeParse<ExperimentVariant[]>(variantsJson, []);
    const taxonomy = safeParse<ExperimentTaxonomy | null>(taxonomyJson, null);
    return buildStandaloneWidgetSetup({
      widgetType: "variant-carousel",
      widgetId: `varcar-${shape.id}`,
      config: title ? { title } : {},
      data: { variants, taxonomy },
      spaceId,
      appId,
      // Sprint B.5 — the carousel's "activate" and "focus" dispatches
      // used to silently fail on the canvas. Now both go through the
      // canvas bus: the registered dispatcher (see interaxis-canvas
      // mount) knows how to POST activate → /api/experiment-variants/
      // [id]/activate, and routes focus → navigate to the app page.
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
  }, [variantsJson, taxonomyJson, shape.id, title, spaceId, appId]);

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
          borderRadius: 16,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,247,253,0.96) 100%)",
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
