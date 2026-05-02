"use client";

// ── File card shape (Phase 2D) ──
//
// Dropped onto canvas when the user drags an ingested file from
// the Files folder. Shows file type icon, source name, character
// count, extraction method, preview of normalized text, + an
// "analyzed" badge when the file has already been submitted
// through /api/analyze.
//
// Click an unanalyzed file → (future) triggers /api/analyze on its
// text. Click an analyzed file → (future) navigates to the entities
// created from it. For now the card is a visible anchor showing
// "this file exists" on the canvas.

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
  Link2,
  Type as TypeIcon,
  Image as ImageIcon,
  FileSpreadsheet,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import type { FileCardShape } from "./types";

/**
 * Pick an icon based on mime type + source type. Images / spreadsheets
 * get distinct icons; everything else falls back to FileText or Link2.
 */
function iconForFile(
  sourceType: FileCardShape["props"]["sourceType"],
  mimeType: string | null,
) {
  if (sourceType === "url") return Link2;
  if (sourceType === "text") return TypeIcon;
  if (!mimeType) return FileText;
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/csv"
  )
    return FileSpreadsheet;
  return FileText;
}

function formatCharCount(n: number): string {
  if (n < 1000) return `${n} chars`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${Math.round(n / 1000)}k chars`;
}

export class FileCardShapeUtil extends BaseBoxShapeUtil<FileCardShape> {
  static override type = "file-card" as const;
  static override props: RecordProps<FileCardShape> = {
    w: T.number,
    h: T.number,
    fileId: T.string,
    spaceId: T.string,
    sourceName: T.string,
    sourceType: T.literalEnum("file", "url", "text"),
    mimeType: T.string.nullable(),
    sourceUrl: T.string.nullable(),
    preview: T.string,
    charCount: T.number,
    analyzed: T.boolean,
    accent: T.string,
    visionStatus: T.literalEnum("idle", "analyzing", "ready", "error"),
    visionDescription: T.string,
    visionEntityCount: T.number,
    visionRelationshipCount: T.number,
    visionError: T.string.nullable(),
  };

  override getDefaultProps(): FileCardShape["props"] {
    return {
      w: 280,
      h: 140,
      fileId: "",
      spaceId: "",
      sourceName: "Untitled",
      sourceType: "file",
      mimeType: null,
      sourceUrl: null,
      preview: "",
      charCount: 0,
      analyzed: false,
      accent: "#64748B",
      visionStatus: "idle",
      visionDescription: "",
      visionEntityCount: 0,
      visionRelationshipCount: 0,
      visionError: null,
    };
  }

  override canResize = () => true;
  override onResize = (
    shape: FileCardShape,
    info: TLResizeInfo<FileCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: FileCardShape) {
    const {
      sourceName,
      sourceType,
      mimeType,
      sourceUrl,
      preview,
      charCount,
      analyzed,
      accent,
      visionStatus,
      visionDescription,
      visionEntityCount,
      visionRelationshipCount,
      visionError,
    } = shape.props;
    const isImageCard = !!mimeType?.startsWith("image/");

    const Icon = iconForFile(sourceType, mimeType);
    const typeLabel =
      sourceType === "url"
        ? "URL"
        : sourceType === "text"
          ? "Text"
          : mimeType?.includes("pdf")
            ? "PDF"
            : mimeType?.includes("docx") ||
                mimeType?.includes("wordprocessingml")
              ? "DOCX"
              : mimeType?.startsWith("image/")
                ? "Image"
                : "File";

    const handleOpen = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (sourceUrl) window.open(sourceUrl, "_blank", "noopener,noreferrer");
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
            background: "rgba(255, 255, 255, 0.95)",
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
          <div style={{ height: 3, background: accent, opacity: 0.85 }} />

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px 6px",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon size={14} strokeWidth={1.75} color={accent} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    padding: "2px 5px",
                    borderRadius: 3,
                    background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                    color: accent,
                  }}
                >
                  {typeLabel}
                </span>
                {analyzed && (
                  <span
                    title="Analyzed — entities materialized"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 2,
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#16a34a",
                    }}
                  >
                    <CheckCircle2 size={9} strokeWidth={2.25} />
                    Analyzed
                  </span>
                )}
                {/* Two-phase image ingest status — only shown for
                    image-typed cards. Drives the user's mental model
                    that the canvas is "looking" at the image. */}
                {isImageCard && visionStatus === "analyzing" && (
                  <span
                    title="Running vision analysis…"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#7c3aed",
                    }}
                  >
                    <Loader2
                      size={9}
                      strokeWidth={2.25}
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                    Analyzing…
                  </span>
                )}
                {isImageCard && visionStatus === "ready" && (
                  <span
                    title={
                      visionDescription
                        ? `Image analysis: ${visionDescription}`
                        : "Vision analysis complete"
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#7c3aed",
                    }}
                  >
                    <Sparkles size={9} strokeWidth={2.25} />
                    {visionEntityCount > 0
                      ? `${visionEntityCount}e · ${visionRelationshipCount}r`
                      : "Analyzed"}
                  </span>
                )}
                {isImageCard && visionStatus === "error" && (
                  <span
                    title={visionError ?? "Vision analysis failed"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#dc2626",
                    }}
                  >
                    <AlertCircle size={9} strokeWidth={2.25} />
                    Vision failed
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f172a",
                  lineHeight: 1.25,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
                title={sourceName}
              >
                {sourceName}
              </div>
            </div>
          </div>

          {/* Preview — for image cards, prefer the cached vision
              description when available (more useful than raw OCR). */}
          {(() => {
            const previewText =
              isImageCard && visionStatus === "ready" && visionDescription
                ? visionDescription
                : preview;
            if (!previewText) return null;
            return (
              <div
                style={{
                  flex: 1,
                  padding: "4px 12px 6px",
                  fontSize: 11,
                  fontWeight: 400,
                  color: "rgba(15,23,42,0.6)",
                  lineHeight: 1.4,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  whiteSpace: "pre-wrap",
                }}
                title={previewText}
              >
                {previewText}
              </div>
            );
          })()}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px 10px",
              borderTop: "1px solid rgba(15,23,42,0.05)",
              fontSize: 9.5,
              fontWeight: 600,
              color: "rgba(15,23,42,0.55)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>{formatCharCount(charCount)}</span>
            {sourceUrl ? (
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
            ) : (
              <span style={{ opacity: 0.6 }}>no link</span>
            )}
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: FileCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}
