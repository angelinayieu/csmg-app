"use client";

// ── Source card shape (Phase 2D) ──
//
// Dropped onto the canvas when the user drags a source from the
// Sources library folder. Renders a compact citation-like card
// with favicon + title + snippet + a link out to the source URL.
// Visually distinct from entity/claim shapes — restrained, almost
// like a browser bookmark chip.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { ExternalLink, Link2 } from "lucide-react";
import type { SourceCardShape } from "./types";

const SOURCE_TYPE_LABEL: Record<SourceCardShape["props"]["sourceType"], string> =
  {
    evidence: "Evidence",
    external_entity: "External",
    file: "File",
    url: "URL",
    integration_placeholder: "Integration",
  };

export class SourceCardShapeUtil extends BaseBoxShapeUtil<SourceCardShape> {
  static override type = "source-card" as const;
  static override props: RecordProps<SourceCardShape> = {
    w: T.number,
    h: T.number,
    sourceId: T.string,
    spaceId: T.string,
    title: T.string,
    snippet: T.string,
    url: T.string.nullable(),
    domain: T.string.nullable(),
    sourceType: T.literalEnum(
      "evidence",
      "external_entity",
      "file",
      "url",
      "integration_placeholder",
    ),
    provider: T.string.nullable(),
    reliability: T.number.nullable(),
    accent: T.string,
  };

  override getDefaultProps(): SourceCardShape["props"] {
    return {
      w: 280,
      h: 120,
      sourceId: "",
      spaceId: "",
      title: "Source",
      snippet: "",
      url: null,
      domain: null,
      sourceType: "url",
      provider: null,
      reliability: null,
      accent: "#64748B",
    };
  }

  override canResize = () => true;
  override onResize = (
    shape: SourceCardShape,
    info: TLResizeInfo<SourceCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: SourceCardShape) {
    const {
      title,
      snippet,
      url,
      domain,
      sourceType,
      accent,
      reliability,
    } = shape.props;
    const typeLabel = SOURCE_TYPE_LABEL[sourceType];

    const handleOpen = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "rgba(255, 255, 255, 0.94)",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            borderRadius: 14,
            boxShadow:
              "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 20px -12px rgba(15, 23, 42, 0.12), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          {/* Top accent rail */}
          <div
            style={{
              height: 3,
              background: accent,
              opacity: 0.85,
            }}
          />

          {/* Header row: favicon + domain + type chip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px 6px",
            }}
          >
            {domain ? (
              <img
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                alt=""
                width={16}
                height={16}
                style={{ borderRadius: 3, flexShrink: 0 }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Link2 size={10} strokeWidth={2} color={accent} />
              </div>
            )}
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: "rgba(15,23,42,0.55)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
            >
              {domain ?? "local"}
            </span>
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "2px 6px",
                borderRadius: 3,
                background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                color: accent,
                flexShrink: 0,
              }}
            >
              {typeLabel}
            </span>
          </div>

          {/* Title */}
          <div
            style={{
              padding: "0 12px 4px",
              fontSize: 13,
              fontWeight: 600,
              color: "#0f172a",
              lineHeight: 1.3,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
            title={title}
          >
            {title}
          </div>

          {/* Snippet */}
          {snippet && (
            <div
              style={{
                flex: 1,
                padding: "2px 12px 10px",
                fontSize: 11,
                fontWeight: 400,
                color: "rgba(15,23,42,0.62)",
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
              title={snippet}
            >
              {snippet}
            </div>
          )}

          {/* Footer: reliability + open link */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "6px 12px 10px",
              borderTop: "1px solid rgba(15,23,42,0.05)",
            }}
          >
            {reliability != null ? (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  color: "rgba(15,23,42,0.55)",
                  fontVariantNumeric: "tabular-nums",
                }}
                title={`Reliability prior: ${reliability.toFixed(2)}`}
              >
                ⌘ {Math.round(reliability * 100)}%
              </span>
            ) : (
              <span />
            )}
            {url && (
              <button
                onClick={handleOpen}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  color: accent,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Open
                <ExternalLink size={9} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: SourceCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}
