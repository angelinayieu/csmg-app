"use client";

// ── Asset card ──
//
// Compact chip representing an ingested file (PDF / DOCX / dataset /
// image / pasted text / URL article). Painted at intake time in a
// horizontal row to the right of the origin-prompt card so the user
// can read the canvas as: "the prompt + these are the assets we have
// to work with."
//
// Spawned by pipeline-event-painter on `asset_added` events emitted
// by intake/bootstrap once per pre-uploaded file. Run-scoped — same
// lifecycle as the rest of the painter's emission overlay.
//
// Click-through: opens the source preview in a sidecar (future
// addition; today the click is a no-op).

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  FileText,
  Database,
  Image as ImageIcon,
  Globe,
  ClipboardList,
  Wrench,
  ScrollText,
  Pencil,
  Paperclip,
} from "lucide-react";
import type { AssetCardShape } from "./types";
import {
  ASSET_CLASS_LABEL,
  ASSET_CLASS_ACCENT,
  type AssetClass,
} from "@/types/asset";

export const ASSET_CARD_DEFAULT_W = 200;
export const ASSET_CARD_DEFAULT_H = 88;

// Icon per class — picked for legibility at 14px.
const ICON_FOR_CLASS = {
  research_pdf: ScrollText,
  internal_doc: FileText,
  dataset: Database,
  image_diagram: ImageIcon,
  prior_analysis: ClipboardList,
  spec_sheet: Wrench,
  web_article: Globe,
  pasted_text: Pencil,
} as const;

export class AssetCardShapeUtil extends BaseBoxShapeUtil<AssetCardShape> {
  static override type = "asset-card" as const;
  static override props: RecordProps<AssetCardShape> = {
    w: T.number,
    h: T.number,
    assetId: T.string,
    spaceId: T.string,
    sourceName: T.string,
    assetClass: T.literalEnum(
      "research_pdf",
      "internal_doc",
      "dataset",
      "image_diagram",
      "prior_analysis",
      "spec_sheet",
      "web_article",
      "pasted_text",
    ),
    charCount: T.number,
    accent: T.string,
    uploadedAt: T.string,
  };

  override getDefaultProps(): AssetCardShape["props"] {
    return {
      w: ASSET_CARD_DEFAULT_W,
      h: ASSET_CARD_DEFAULT_H,
      assetId: "",
      spaceId: "",
      sourceName: "untitled",
      assetClass: "internal_doc",
      charCount: 0,
      accent: ASSET_CLASS_ACCENT.internal_doc,
      uploadedAt: new Date().toISOString(),
    };
  }

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: AssetCardShape,
    info: TLResizeInfo<AssetCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: AssetCardShape) {
    const { w, h, sourceName, assetClass, charCount, accent } = shape.props;
    const Icon =
      ICON_FOR_CLASS[assetClass as AssetClass] ?? Paperclip;
    const label = ASSET_CLASS_LABEL[assetClass as AssetClass] ?? "Asset";

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
        }}
      >
        <div
          className="asset-card-enter"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 10,
            overflow: "hidden",
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(10px) saturate(1.3)",
            WebkitBackdropFilter: "blur(10px) saturate(1.3)",
            border: `1px solid color-mix(in srgb, ${accent} 22%, rgba(15,23,42,0.06))`,
            boxShadow: `0 1px 2px rgba(15,23,42,0.04), 0 6px 14px -8px color-mix(in srgb, ${accent} 35%, transparent)`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "8px 10px",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: "#0f172a",
          }}
        >
          {/* Row 1: icon + class label */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon size={11} color={accent} strokeWidth={2.2} />
            </div>
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: "0.12em",
                color: accent,
                textTransform: "uppercase",
              }}
            >
              {label}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 9,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontVariantNumeric: "tabular-nums",
                color: "rgba(15,23,42,0.5)",
              }}
              title={`${charCount} characters absorbed`}
            >
              {formatCount(charCount)} ch
            </span>
          </div>
          {/* Row 2: file name */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#0f172a",
              lineHeight: 1.2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              wordBreak: "break-word",
            }}
            title={sourceName}
          >
            {sourceName}
          </div>
        </div>
        <style jsx>{`
          .asset-card-enter {
            animation: asset-card-fade-in 460ms cubic-bezier(0.25, 0.8, 0.25, 1)
              both;
          }
          @keyframes asset-card-fade-in {
            from {
              opacity: 0;
              transform: translateY(-4px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>
      </HTMLContainer>
    );
  }

  override indicator(shape: AssetCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />
    );
  }
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}
