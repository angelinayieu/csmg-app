"use client";

// ── ObjectiveImageCardShapeUtil ──
//
// A pasted image, auto-analyzed by the vision pass, rendered as a card on
// the objective board: the FULL image (never cropped) + a small green
// glowing "analyzed" dot, expandable to the AI description + extracted-entity
// chips. The card is translucent glass and hugs the image's aspect ratio so
// it carries as little visual weight as possible. Lands connected below the
// objective card (the file-card shape elsewhere only renders icons/text, so
// this is a dedicated image card).

import { useEffect, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { ChevronDown } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const CARD_W = 240;
const FOOTER_H = 44;
const PANEL_H = 150; // expanded description + chips panel
const MIN_IMG_H = 116;
const MAX_IMG_H = 320;
const DEFAULT_H = MIN_IMG_H + FOOTER_H;
const GREEN = appleVibe.stage.outcomes;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface ImgEntity {
  name?: string;
  type?: string;
}

export type ObjectiveImageCardShape = TLBaseShape<
  "objective-image-card",
  {
    w: number;
    h: number;
    expanded: boolean;
    /** ingested_files id of the source image. */
    imageFileId: string;
    imageName: string;
    /** public Storage URL of the image binary. */
    imageUrl: string;
    /** AI vision description. */
    description: string;
    entityCount: number;
    /** extracted entities, JSON-encoded ([{name,type}]). */
    entitiesJson: string;
    color: string;
    /** Backing library_objects row id (object_type='image_source'). Empty
     *  until materialize-image-context has run + lazy-backfill resolved.
     *  Once set, drag-connector links from this card + onClick opens the
     *  object-detail rail. */
    objectId: string;
  }
>;

export class ObjectiveImageCardShapeUtil extends BaseBoxShapeUtil<ObjectiveImageCardShape> {
  static override type = "objective-image-card" as const;
  static override props: RecordProps<ObjectiveImageCardShape> = {
    w: T.number,
    h: T.number,
    expanded: T.boolean,
    imageFileId: T.string,
    imageName: T.string,
    imageUrl: T.string,
    description: T.string,
    entityCount: T.number,
    entitiesJson: T.string,
    color: T.string,
    objectId: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ObjectiveImageCardShape,
    info: TLResizeInfo<ObjectiveImageCardShape>,
  ) => resizeBox(shape, info);

  // Click-to-expand the object-detail rail. Modifier clicks fall
  // through to multi-select.
  override onClick = (shape: ObjectiveImageCardShape) => {
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

  getDefaultProps(): ObjectiveImageCardShape["props"] {
    return {
      w: CARD_W,
      h: DEFAULT_H,
      expanded: false,
      imageFileId: "",
      imageName: "",
      imageUrl: "",
      description: "",
      entityCount: 0,
      entitiesJson: "[]",
      color: "#2563EB",
      objectId: "",
    };
  }

  component(shape: ObjectiveImageCardShape) {
    return <ImageCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: ObjectiveImageCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function parseEntities(json: string): ImgEntity[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as ImgEntity[]) : [];
  } catch {
    return [];
  }
}

function ImageCardRenderer({
  shape,
  util,
}: {
  shape: ObjectiveImageCardShape;
  util: ObjectiveImageCardShapeUtil;
}) {
  const editor = util.editor;
  const { expanded, imageName, imageUrl, description, w, objectId } = shape.props;
  const entities = parseEntities(shape.props.entitiesJson);
  const hasMeta = !!description || entities.length > 0;

  // React-level onClick survives the chevron's stopEventPropagation (which
  // only blocks tldraw-shape-level gestures). Putting it on the outer
  // wrapper lets clicks anywhere on the image / footer open the detail
  // rail once the image has been promoted to an image_source row.
  function openDetail(e: React.MouseEvent) {
    if (!objectId) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    // Don't fight the chevron / button — they own their click handler.
    if (target && target.closest("button")) return;
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("objective-board:open-card-detail", {
        detail: { objectId },
      }),
    );
  }

  // Natural aspect ratio (height / width) of the loaded image. Until it
  // loads, fall back to whatever height the shape was persisted at.
  const [ratio, setRatio] = useState<number | null>(null);

  const imageH = ratio
    ? clamp(Math.round(w * ratio), MIN_IMG_H, MAX_IMG_H)
    : clamp(shape.props.h - FOOTER_H - (expanded ? PANEL_H : 0), MIN_IMG_H, MAX_IMG_H);

  // Keep the card height locked to the image's aspect ratio (+ chrome) so the
  // whole image always fits and the card never carries dead space. Runs on
  // load, on width resize, and on expand/collapse.
  useEffect(() => {
    if (ratio == null) return;
    const target = clamp(Math.round(w * ratio), MIN_IMG_H, MAX_IMG_H) + FOOTER_H + (expanded ? PANEL_H : 0);
    if (Math.abs(target - shape.props.h) > 1) {
      editor.updateShape<ObjectiveImageCardShape>({
        id: shape.id,
        type: "objective-image-card",
        props: { h: target },
      });
    }
  }, [ratio, w, expanded, shape.props.h, shape.id, editor]);

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth > 0) setRatio(img.naturalHeight / img.naturalWidth);
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    editor.updateShape<ObjectiveImageCardShape>({
      id: shape.id,
      type: "objective-image-card",
      props: { expanded: !expanded },
    });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <style>{`@keyframes objImgPulse{0%,100%{box-shadow:0 0 0 3px ${GREEN}22,0 0 8px 1px ${GREEN}aa}50%{box-shadow:0 0 0 4px ${GREEN}14,0 0 13px 2px ${GREEN}}}`}</style>
      <div
        onClick={openDetail}
        title={objectId ? "Open image details" : ""}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          // Translucent glass — sits light on the canvas, low visual weight.
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border: "1px solid rgba(255,255,255,0.6)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.6) inset, 0 10px 30px -18px rgba(11,18,40,0.28)",
          display: "flex",
          flexDirection: "column",
          fontFamily: appleVibe.font.stack,
          cursor: objectId ? "pointer" : "default",
        }}
      >
        {/* Image — full, never cropped (contain), area hugs its aspect ratio */}
        <div
          style={{
            width: "100%",
            height: imageH,
            flexShrink: 0,
            background: "rgba(15,23,42,0.03)",
          }}
        >
          {imageUrl && (
            // External Storage URL — next/image can't optimize it; plain img is correct.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={imageName}
              draggable={false}
              onLoad={onImgLoad}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          )}
        </div>

        {/* Footer — green glowing dot (analyzed), title, expand chevron */}
        <div
          style={{
            height: FOOTER_H,
            flexShrink: 0,
            padding: "0 11px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            aria-label="Analyzed"
            style={{
              width: 8,
              height: 8,
              flexShrink: 0,
              borderRadius: 999,
              background: GREEN,
              animation: "objImgPulse 2.4s ease-in-out infinite",
            }}
          />
          <div
            className="truncate"
            style={{
              minWidth: 0,
              flex: 1,
              fontSize: 12,
              fontWeight: 600,
              color: appleVibe.text.primary,
            }}
          >
            {imageName || "Image"}
          </div>
          {hasMeta && (
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={toggle}
              aria-label={expanded ? "Collapse" : "Show analysis"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: 4,
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: "rgba(15,23,42,0.05)",
                color: appleVibe.text.tertiary,
              }}
            >
              <ChevronDown
                style={{
                  width: 14,
                  height: 14,
                  transform: expanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.18s ease",
                }}
                strokeWidth={2.4}
              />
            </button>
          )}
        </div>

        {/* Expanded: AI description + entity chips */}
        {expanded && hasMeta && (
          <div
            style={{
              height: PANEL_H,
              flexShrink: 0,
              padding: "9px 11px 11px",
              overflowY: "auto",
              borderTop: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            {description && (
              <p
                style={{
                  fontSize: 11.5,
                  fontWeight: 400,
                  lineHeight: 1.42,
                  color: appleVibe.text.secondary,
                  margin: 0,
                }}
              >
                {description}
              </p>
            )}
            {entities.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {entities.slice(0, 10).map((e, i) => (
                  <span
                    key={i}
                    style={{
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 500,
                      background: appleVibe.surface.chip,
                      color: appleVibe.text.secondary,
                    }}
                  >
                    {e.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
