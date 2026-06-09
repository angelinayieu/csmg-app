"use client";

// ── UiPlanCardShape ──
//
// A single UI-plan variant produced by the "Build prototype" fork. Each card
// holds one TechSpecUiPlan + the source text the plans were forked from.
// The card has its own "Build prototype" button that fires BUILD_PROTOTYPE_EVENT
// with a synthesized stub TechSpec wrapping this plan — compose-prototype only
// reads spec.title / spec.overview / spec.target_users / spec.ui_plan / spec.features,
// so a thin stub is enough.

import { useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  useEditor,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Loader2, AppWindow, AlertCircle, Layout } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  BUILD_PROTOTYPE_EVENT,
  type OpenTechSpecDetail,
} from "./tech-spec-card-shape";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

/** Fired by the rail's "Build prototype" button: the board listens and forks
 *  N UI-plan cards below the source shape, then POSTs /api/canvas/ui-plan and
 *  fills each card with a distinct variant as the model returns. */
export const BUILD_UI_PLANS_EVENT = "objective-board:build-ui-plans";
export interface BuildUiPlansDetail {
  /** Source shape (any kind) the variants fork from. */
  sourceShapeId: string;
  sourceText: string;
  /** Human label for the source — shown in the rail header. */
  sourceLabel?: string;
  count: number;
  temperature?: number;
}

export type UiPlanCardShape = TLBaseShape<
  "ui-plan-card",
  {
    w: number;
    h: number;
    title: string;
    variantLabel: string;
    overview: string;
    sourceText: string;
    /** Stringified TechSpecUiPlan — the planning artifact this card represents. */
    uiPlanJson: string;
    status: "generating" | "ready" | "error";
    /** Backing library_objects row id (object_type='ui_idea'). Empty
     *  until the /ui-plan/promote route returns. Once set, the card
     *  click opens the object-detail rail and the drag-connector can
     *  wire images / other oc-cards onto this plan. */
    objectId: string;
  }
>;

export class UiPlanCardShapeUtil extends BaseBoxShapeUtil<UiPlanCardShape> {
  static override type = "ui-plan-card" as const;
  static override props: RecordProps<UiPlanCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    variantLabel: T.string,
    overview: T.string,
    sourceText: T.string,
    uiPlanJson: T.string,
    status: T.literalEnum("generating", "ready", "error"),
    objectId: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: UiPlanCardShape, info: TLResizeInfo<UiPlanCardShape>) => {
    return resizeBox(shape, info);
  };

  // Click-to-expand: open the object-detail rail. Modifier keys fall
  // through to multi-select; do nothing if not yet promoted.
  override onClick = (shape: UiPlanCardShape) => {
    const i = this.editor.inputs;
    if (i.shiftKey || i.ctrlKey || i.altKey) return;
    const objectId = shape.props.objectId;
    if (objectId) {
      window.dispatchEvent(
        new CustomEvent("objective-board:open-card-detail", {
          detail: { objectId },
        }),
      );
    }
  };

  getDefaultProps(): UiPlanCardShape["props"] {
    return {
      w: 280,
      h: 340,
      title: "UI plan",
      variantLabel: "",
      overview: "",
      sourceText: "",
      uiPlanJson: "",
      status: "generating",
      objectId: "",
    };
  }

  component(shape: UiPlanCardShape) {
    return <UiPlanCardRenderer shape={shape} />;
  }

  indicator(shape: UiPlanCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function UiPlanCardRenderer({ shape }: { shape: UiPlanCardShape }) {
  const { title, variantLabel, overview, uiPlanJson, sourceText, status, objectId } =
    shape.props;
  const accent = appleVibe.accent.primary;
  const editor = useEditor();
  const [building, setBuilding] = useState(false);
  const promotingRef = useRef(false);

  const plan = (() => {
    if (!uiPlanJson) return null;
    try {
      return JSON.parse(uiPlanJson) as TechSpec["ui_plan"];
    } catch {
      return null;
    }
  })();
  const screens = plan?.screens ?? [];
  const components = plan?.component_inventory ?? [];
  const dl = plan?.design_language;

  // Self-promote when ready without a backing library_object. Handles plan
  // cards that landed before the whiteboard's promote-after-ready logic
  // (or whose promote failed transiently) — once this fires, the click→
  // detail-rail + drag-connector both work.
  useEffect(() => {
    if (status !== "ready" || objectId || promotingRef.current) return;
    if (!uiPlanJson) return;
    const match =
      typeof window !== "undefined"
        ? window.location.pathname.match(/\/objective\/([^/?#]+)/)
        : null;
    const spaceId = match?.[1];
    if (!spaceId) return;
    promotingRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/objective/${spaceId}/ui-plan/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shapeId: shape.id,
            title,
            variantLabel,
            overview,
            sourceText,
            uiPlanJson,
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { objectId?: string };
        const id = json?.objectId;
        if (!id) return;
        if (!editor.getShape(shape.id)) return;
        editor.updateShape<UiPlanCardShape>({
          id: shape.id,
          type: "ui-plan-card",
          props: { objectId: id },
        });
      } catch {
        promotingRef.current = false;
      }
    })();
  }, [
    status,
    objectId,
    uiPlanJson,
    shape.id,
    title,
    variantLabel,
    overview,
    sourceText,
    editor,
  ]);

  // React-level onClick survives the body's stopEventPropagation (which
  // only blocks tldraw-shape-level gestures). Putting it on the outer
  // wrapper means clicking ANY visible area (header / body / footer
  // whitespace) opens the detail rail when the card has been promoted.
  function openDetail(e: React.MouseEvent) {
    if (!objectId) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    // Don't intercept a click that's heading to the Build-prototype button.
    const target = e.target as HTMLElement | null;
    if (target && target.closest("button")) return;
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("objective-board:open-card-detail", {
        detail: { objectId },
      }),
    );
  }

  function buildPrototype(e: React.MouseEvent) {
    e.stopPropagation();
    if (!plan || status !== "ready" || building) return;
    setBuilding(true);
    const stubSpec: TechSpec = {
      title: title || "UI plan",
      overview: overview || sourceText.slice(0, 280),
      problem: "",
      target_users: [],
      goals: [],
      success_metrics: [],
      non_goals: [],
      architecture: { summary: "", components: [], layers: [] },
      data_model: [],
      integrations: [],
      features: [],
      build_phases: [],
      risks: [],
      open_questions: [],
      ui_plan: plan,
    };
    window.dispatchEvent(
      new CustomEvent<OpenTechSpecDetail>(BUILD_PROTOTYPE_EVENT, {
        detail: {
          specJson: JSON.stringify(stubSpec),
          markdown: "",
          title: variantLabel ? `${title} · ${variantLabel}` : title,
          shapeId: shape.id,
        },
      }),
    );
    // Release the button after the handoff. BUILD_PROTOTYPE_EVENT is
    // fire-and-forget — the spawned prototype card owns the real loading UI
    // (its own progress bar + ready/error states). Without this reset the
    // button stuck on "Sending to prototype…" FOREVER, even after the build
    // finished or failed. ~2.5s is enough for the prototype card to mount.
    window.setTimeout(() => setBuilding(false), 2500);
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        onClick={openDetail}
        title={objectId ? "Open plan details" : "Plan still drafting…"}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          border: `1px solid ${accent}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 42px -20px ${accent}55, 0 8px 22px -10px rgba(11,18,40,0.14)`,
          fontFamily: appleVibe.font.stack,
          cursor: objectId ? "pointer" : "default",
        }}
      >
        {/* Header — drag handle. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 12px",
            borderBottom: `1px solid ${appleVibe.stroke.soft}`,
            background: "rgba(248,250,252,0.92)",
            flexShrink: 0,
          }}
        >
          <Layout style={{ width: 13, height: 13, color: accent }} strokeWidth={2.3} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: appleVibe.text.primary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              flex: 1,
            }}
          >
            {title}
          </span>
          {variantLabel && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: accent,
                padding: "2px 6px",
                borderRadius: 999,
                background: `${accent}14`,
                whiteSpace: "nowrap",
              }}
            >
              {variantLabel}
            </span>
          )}
        </div>

        {/* Body — plan summary, skeleton, or error. */}
        <div
          onPointerDown={stopEventPropagation}
          onWheelCapture={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {status === "generating" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: accent,
                padding: "32px 0",
              }}
            >
              <Loader2 className="animate-spin" style={{ width: 22, height: 22 }} strokeWidth={2.2} />
              <span style={{ fontSize: 12, fontWeight: 600, color: appleVibe.text.secondary }}>
                Sketching this UI plan…
              </span>
            </div>
          ) : status === "error" || !plan ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "24px 8px",
                textAlign: "center",
                color: appleVibe.text.tertiary,
              }}
            >
              <AlertCircle style={{ width: 20, height: 20 }} strokeWidth={2} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Couldn&apos;t draft this plan.
              </span>
            </div>
          ) : (
            <>
              {dl && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {[dl.glass_tier, dl.density, dl.hero_pattern, dl.accent_intent].map(
                    (t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: appleVibe.text.secondary,
                          background: appleVibe.surface.chip,
                          padding: "2px 7px",
                          borderRadius: 999,
                        }}
                      >
                        {t}
                      </span>
                    ),
                  )}
                </div>
              )}

              {screens.length > 0 && (
                <div>
                  <div style={sectionLabel}>Screens</div>
                  <ul style={list}>
                    {screens.slice(0, 4).map((s, i) => (
                      <li key={i} style={listItem}>
                        <span style={listBold}>{s.name}</span>
                        {s.purpose ? ` — ${s.purpose}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {components.length > 0 && (
                <div>
                  <div style={sectionLabel}>Components</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {components.slice(0, 8).map((c, i) => (
                      <span key={i} style={miniChip}>
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — Build prototype CTA. */}
        <div
          onPointerDown={stopEventPropagation}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            borderTop: `1px solid ${appleVibe.stroke.soft}`,
            background: "rgba(248,250,252,0.92)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={buildPrototype}
            disabled={status !== "ready" || building}
            title={
              status !== "ready"
                ? "Plan still drafting…"
                : "Build a clickable HTML prototype from this UI plan"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              width: "100%",
              padding: "8px 11px",
              borderRadius: 999,
              border: "none",
              background: status === "ready" ? accent : appleVibe.surface.chip,
              color: status === "ready" ? "white" : appleVibe.text.tertiary,
              fontSize: 12,
              fontWeight: 650,
              fontFamily: appleVibe.font.stack,
              cursor: status === "ready" && !building ? "pointer" : "default",
              opacity: building ? 0.7 : 1,
            }}
          >
            {building ? (
              <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} strokeWidth={2.2} />
            ) : (
              <AppWindow style={{ width: 13, height: 13 }} strokeWidth={2.3} />
            )}
            {building ? "Sending to prototype…" : "Build prototype"}
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

const sectionLabel = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
  marginBottom: 4,
} as const;
const list = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 3,
} as const;
const listItem = {
  fontSize: 11.5,
  lineHeight: 1.4,
  color: appleVibe.text.secondary,
} as const;
const listBold = {
  fontWeight: 650,
  color: appleVibe.text.primary,
} as const;
const miniChip = {
  fontSize: 10,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  background: appleVibe.surface.chip,
  padding: "2px 6px",
  borderRadius: 6,
} as const;
