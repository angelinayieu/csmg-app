"use client";

// ── ObjectiveImageCardShapeUtil ──
//
// A pasted image, auto-analyzed by the vision pass, rendered as a card on
// the objective board: the real image + a green "analyzed" light, expandable
// to the AI description + extracted-entity chips. Lands connected below the
// objective card (the file-card shape elsewhere only renders icons/text, so
// this is a dedicated image card).

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
import { ChevronDown, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const CARD_W = 240;
const COLLAPSED_H = 172;
const EXPANDED_H = 320;
const GREEN = appleVibe.stage.outcomes;

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
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ObjectiveImageCardShape,
    info: TLResizeInfo<ObjectiveImageCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): ObjectiveImageCardShape["props"] {
    return {
      w: CARD_W,
      h: COLLAPSED_H,
      expanded: false,
      imageFileId: "",
      imageName: "",
      imageUrl: "",
      description: "",
      entityCount: 0,
      entitiesJson: "[]",
      color: "#2563EB",
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
  const { expanded, imageName, imageUrl, description, entityCount } = shape.props;
  const entities = parseEntities(shape.props.entitiesJson);
  const hasMeta = !!description || entities.length > 0;

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !expanded;
    editor.updateShape<ObjectiveImageCardShape>({
      id: shape.id,
      type: "objective-image-card",
      props: { expanded: next, h: next ? EXPANDED_H : COLLAPSED_H },
    });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          background: appleVibe.surface.card,
          border: `1px solid ${GREEN}45`,
          boxShadow: `0 0 0 1px ${GREEN}1f, 0 12px 28px -12px ${GREEN}73, 0 6px 16px -10px rgba(11,18,40,0.18)`,
          display: "flex",
          flexDirection: "column",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Image */}
        <div style={{ position: "relative", width: "100%", height: 110, background: "rgba(15,23,42,0.05)" }}>
          {imageUrl && (
            // External Storage URL — next/image can't optimize it; plain img is correct.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={imageName}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}
          {/* Green "analyzed" light */}
          <span
            aria-label="Analyzed"
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              width: 10,
              height: 10,
              borderRadius: 999,
              background: GREEN,
              boxShadow: `0 0 0 2px rgba(255,255,255,0.92), 0 0 10px ${GREEN}`,
            }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="truncate"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: appleVibe.text.primary,
              }}
            >
              {imageName || "Image"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
              <Sparkles style={{ width: 11, height: 11, color: GREEN }} strokeWidth={2.4} />
              <span style={{ fontSize: 10, fontWeight: 600, color: GREEN }}>
                Analyzed{entityCount > 0 ? ` · ${entityCount}` : ""}
              </span>
            </div>
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
              padding: "0 10px 10px",
              overflowY: "auto",
              borderTop: `1px solid ${appleVibe.stroke.hairline}`,
              paddingTop: 9,
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
