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
  useEditor,
  type RecordProps,
  type TLResizeInfo,
  type TLShapeId,
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
  CheckSquare,
  Eye,
} from "lucide-react";
import { useCanvasAssetDerivedEntities } from "../canvas-asset-derived-entities-context";
import type { AssetCardShape } from "./types";
import {
  ASSET_CLASS_LABEL,
  ASSET_CLASS_ACCENT,
  type AssetClass,
} from "@/types/asset";
import { canvasOpenExtractionReview } from "@/lib/canvas/canvas-bus";

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
    extractionStatus: T.string,
    extractedEntityCount: T.number,
    previewCandidateCount: T.number,
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
      extractionStatus: "pending_preview",
      extractedEntityCount: 0,
      previewCandidateCount: 0,
    };
  }

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: AssetCardShape,
    info: TLResizeInfo<AssetCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: AssetCardShape) {
    const {
      w,
      h,
      sourceName,
      assetClass,
      charCount,
      accent,
      extractionStatus,
      extractedEntityCount,
      previewCandidateCount,
    } = shape.props;
    const Icon =
      ICON_FOR_CLASS[assetClass as AssetClass] ?? Paperclip;
    const label = ASSET_CLASS_LABEL[assetClass as AssetClass] ?? "Asset";

    // Status badge — shows the HITL extraction lifecycle visibly on
    // the card so the user can scan a row of assets and immediately
    // see which need review vs which are done. Falls through to
    // "pending_preview" for shapes that predate the extraction-status
    // prop (back-compat with pre-2026-04-26 painted cards).
    const status = extractionStatus || "pending_preview";
    const statusBadge = (() => {
      switch (status) {
        case "previewed":
          return {
            label:
              previewCandidateCount > 0
                ? `${previewCandidateCount} candidate${previewCandidateCount === 1 ? "" : "s"} ready`
                : "Preview ready",
            bg: "rgba(37,99,235,0.10)",
            border: "rgba(37,99,235,0.35)",
            color: "#1d4ed8",
          };
        case "extracting":
          return {
            label: "Extracting…",
            bg: "rgba(15,23,42,0.06)",
            border: "rgba(15,23,42,0.18)",
            color: "#334155",
          };
        case "extracted":
          return {
            label:
              extractedEntityCount > 0
                ? `✓ ${extractedEntityCount} entit${extractedEntityCount === 1 ? "y" : "ies"} extracted`
                : "✓ Extracted",
            bg: "rgba(34,197,94,0.10)",
            border: "rgba(34,197,94,0.35)",
            color: "#15803d",
          };
        case "skipped":
          return {
            label: "Skipped",
            bg: "rgba(148,163,184,0.14)",
            border: "rgba(148,163,184,0.30)",
            color: "#475569",
          };
        case "auto_extracted":
          return {
            label:
              extractedEntityCount > 0
                ? `Auto-extracted · ${extractedEntityCount}`
                : "Auto-extracted",
            bg: "rgba(217,119,6,0.10)",
            border: "rgba(217,119,6,0.32)",
            color: "#b45309",
          };
        case "pending_preview":
        default:
          return {
            label: "Awaiting review",
            bg: "rgba(245,158,11,0.10)",
            border: "rgba(245,158,11,0.35)",
            color: "#b45309",
          };
      }
    })();

    // Pill label adapts to status. "Re-review →" appears when the
    // asset is already extracted/skipped — clicking it reopens the
    // drawer (the cached preview is reused; the user can change
    // their selection and re-commit).
    const pillLabel = (() => {
      if (status === "extracted") return "Re-review →";
      if (status === "skipped") return "Review again →";
      if (status === "extracting") return "Extracting…";
      return "Review extract →";
    })();
    const pillDisabled = status === "extracting";

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
          {/* Row 2: paper title (when extracted) → falls through to
              filename. Authors+year render as a small subtitle below
              the title when present. P6: title comes from the asset
              preview pass and lives in extraction_preview.paper_metadata. */}
          <AssetCardTitleRow
            assetId={shape.props.assetId}
            sourceName={sourceName}
          />
          {/* Row 2.5: extraction status badge.
              Shows the asset's HITL lifecycle so the user can scan
              a row of cards and immediately see which still need
              review. Status transitions are driven by post-extract
              shape updates (interaxis-canvas wires editor.updateShape
              from the drawer's onExtract / onSkip callbacks). */}
          <div
            style={{
              display: "inline-flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 999,
              background: statusBadge.bg,
              border: `1px solid ${statusBadge.border}`,
              color: statusBadge.color,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.04em",
              lineHeight: 1,
            }}
          >
            {statusBadge.label}
          </div>
          {/* P4 · contribution stats row. Tells the user at a glance
              what this paper actually added to the KG: entities (and
              how many are novel-vs-shared with other papers) + edges.
              Renders nothing until extraction has produced something. */}
          {shape.props.assetId && (
            <AssetContributionRow assetId={shape.props.assetId} accent={accent} />
          )}
          {/* Row 3: HITL extraction-review affordance.
              Fires canvas-bus → useExtractionReview.open() in the
              host (interaxis-canvas) which POSTs /api/ingest/[id]/preview
              and renders the ExtractionChecklistDrawer. Only meaningful
              when shape has a real assetId; defaults to a no-op for
              unwired shapes. The button stops propagation so clicking
              it doesn't trigger tldraw shape selection. */}
          {shape.props.assetId && (
            <div
              style={{
                marginTop: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
            <button
              type="button"
              disabled={pillDisabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (pillDisabled) return;
                // For already-extracted/skipped assets, force=true
                // regenerates the preview (otherwise the cached one
                // is reused and may reflect stale content).
                const force =
                  status === "extracted" || status === "skipped";
                canvasOpenExtractionReview({
                  assetId: shape.props.assetId,
                  assetName: sourceName,
                  assetClass,
                  force,
                });
              }}
              style={{
                marginTop: "auto",
                alignSelf: "flex-start",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 7px",
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
                background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                color: accent,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                lineHeight: 1,
                cursor: pillDisabled ? "not-allowed" : "pointer",
                opacity: pillDisabled ? 0.55 : 1,
                fontFamily: "inherit",
                transition:
                  "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
              }}
              onMouseEnter={(e) => {
                if (pillDisabled) return;
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.background = `color-mix(in srgb, ${accent} 22%, transparent)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "";
                e.currentTarget.style.background = `color-mix(in srgb, ${accent} 12%, transparent)`;
              }}
              title={
                pillDisabled
                  ? "Extraction in progress"
                  : status === "extracted" || status === "skipped"
                    ? "Re-review what to extract from this asset"
                    : "Review what to extract from this asset"
              }
              aria-label={pillLabel}
            >
              <CheckSquare style={{ width: 9, height: 9 }} />
              {pillLabel}
            </button>
            {/* P1 / D14 — sister affordance: highlight the entities
                this asset produced on the canvas. Renders nothing
                when zero derived entities (e.g. status=skipped). */}
            <AssetHighlightButton
              assetId={shape.props.assetId}
              accent={accent}
            />
            </div>
          )}
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

// ── P1 / D14 — Asset highlight button ────────────────────────────────
//
// Small "👁 N on canvas" affordance that, on click, finds every
// kg-node-shape whose `entityId` matches an entity derived from this
// asset and selects + zooms to them. Makes the paper-to-KG link
// spatially visible — clicking a paper highlights the entities it
// produced.
//
// Renders nothing when the asset has no derived entities (e.g.
// status=skipped, or pre-extraction failed). Uses useEditor() inside
// so it can read shape state + drive the camera; uses the canvas-
// wide derived-entities context so it doesn't fetch per-card.

function AssetHighlightButton({
  assetId,
  accent,
}: {
  assetId: string;
  accent: string;
}) {
  const editor = useEditor();
  const { index } = useCanvasAssetDerivedEntities();
  const derived = index.byAssetId.get(assetId) ?? [];

  if (derived.length === 0 || index.loading) return null;

  const handleClick = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    // Walk all shapes once, collect the kg-node-shapes whose
    // entityId matches one of our derived entities. O(shapes ×
    // derived) — typical: ~200 × ~5 = 1000 ops. Cheap.
    const derivedIds = new Set(derived.map((d) => d.id));
    const matched: TLShapeId[] = [];
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type !== "kg-node") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eid = (s.props as any)?.entityId;
      if (typeof eid === "string" && derivedIds.has(eid)) {
        matched.push(s.id);
      }
    }
    if (matched.length === 0) return;
    editor.select(...matched);
    // Animate the camera to fit the selection so even off-screen
    // entities come into view. tldraw's zoomToSelection is
    // selection-aware and respects existing animation prefs.
    editor.zoomToSelection({ animation: { duration: 380 } });
  };

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      title={`Highlight the ${derived.length} ${
        derived.length === 1 ? "entity" : "entities"
      } extracted from this asset on the canvas`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "3px 7px",
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
        background: `color-mix(in srgb, ${accent} 8%, transparent)`,
        color: accent,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        lineHeight: 1,
        cursor: "pointer",
        fontFamily: "inherit",
        transition:
          "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.background = `color-mix(in srgb, ${accent} 18%, transparent)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.background = `color-mix(in srgb, ${accent} 8%, transparent)`;
      }}
    >
      <Eye style={{ width: 9, height: 9 }} />
      {derived.length} on canvas
    </button>
  );
}

// ── P4 — Asset contribution row ──────────────────────────────────────
//
// One-line stats summary above the action pills:
//   📦 5 entities (2 shared)   🔗 8 edges
//
// "shared" = entities also referenced by another paper (P3 dedup
// matched). When 0 shared, that segment is suppressed to keep the
// row terse. Renders nothing until the first commit produces something.

function AssetContributionRow({
  assetId,
  accent,
}: {
  assetId: string;
  accent: string;
}) {
  const { index } = useCanvasAssetDerivedEntities();
  const stats = index.statsByAssetId.get(assetId);
  if (
    !stats ||
    (stats.entityCount === 0 &&
      stats.edgeCount === 0 &&
      stats.effectSizeCount === 0 &&
      stats.temporalCount === 0)
  ) {
    return null;
  }
  const sharedCount = Math.max(
    0,
    stats.entityCount - stats.novelEntityCount,
  );
  const titleLines = [
    `Contributes ${stats.entityCount} entities + ${stats.edgeCount} edges to this space`,
    sharedCount > 0
      ? `  · ${stats.novelEntityCount} novel · ${sharedCount} shared with other papers`
      : `  · all ${stats.entityCount} unique to this paper`,
  ];
  if (stats.effectSizeCount > 0 || stats.temporalCount > 0) {
    titleLines.push(
      `Auto-extracted evidence: ${stats.effectSizeCount} effect sizes · ${stats.temporalCount} temporal anchors`,
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginTop: 6,
        marginBottom: 2,
        padding: "3px 6px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${accent} 6%, transparent)`,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: `color-mix(in srgb, ${accent} 75%, #475569)`,
      }}
      title={titleLines.join("\n")}
    >
      {stats.entityCount > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 11 }}>📦</span>
          {stats.entityCount}
          {sharedCount > 0 && (
            <span
              style={{
                marginLeft: 2,
                fontSize: 9,
                fontWeight: 600,
                color: `color-mix(in srgb, ${accent} 60%, #94a3b8)`,
              }}
            >
              ({sharedCount} shared)
            </span>
          )}
        </span>
      )}
      {stats.edgeCount > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 11 }}>🔗</span>
          {stats.edgeCount}
        </span>
      )}
      {/* Initiative 2 — auto-extracted evidence counts. Each segment
          renders only when present so single-pass papers stay terse.
          Tone shifts to a "studied" purple accent so users can quickly
          distinguish "this paper has been mined for numbers" from
          plain entity contribution. */}
      {stats.effectSizeCount > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            color: "#6d28d9",
          }}
        >
          <span style={{ fontSize: 11 }}>📊</span>
          {stats.effectSizeCount}
        </span>
      )}
      {stats.temporalCount > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            color: "#0891b2",
          }}
        >
          <span style={{ fontSize: 11 }}>⏱</span>
          {stats.temporalCount}
        </span>
      )}
    </div>
  );
}

// ── P6 — Asset card title row ────────────────────────────────────────
//
// When the preview pass extracts paper_metadata (title/authors/year),
// promote the title to the primary card name and demote the original
// filename to a small mono-styled secondary line. Authors+year render
// as a one-line byline under the title.
//
// Falls through to the previous "just show the filename" behavior for
// non-paper assets (specs, web articles, datasets, anything pre-P6).

function AssetCardTitleRow({
  assetId,
  sourceName,
}: {
  assetId: string;
  sourceName: string;
}) {
  const { index } = useCanvasAssetDerivedEntities();
  const meta = index.metadataByAssetId.get(assetId);
  const paperMeta = meta?.paper_metadata ?? null;
  const title =
    paperMeta?.title && paperMeta.title.trim().length > 0
      ? paperMeta.title.trim()
      : null;

  // Compact authors+year line. Mirrors formatAuthorsLine from drawer
  // and ResearchLibraryChip so the three surfaces read identically.
  const authorsLine = (() => {
    if (!paperMeta) return null;
    const yearStr = paperMeta.year ? ` ${paperMeta.year}` : "";
    const a = paperMeta.authors ?? [];
    if (a.length === 0)
      return yearStr.trim().length > 0 ? yearStr.trim() : null;
    if (a.length === 1) return `${a[0]}${yearStr}`;
    if (a.length === 2) return `${a[0]} & ${a[1]}${yearStr}`;
    return `${a[0]} et al.${yearStr}`;
  })();

  if (!title) {
    // No paper title extracted — preserve original single-line filename
    // rendering so non-paper assets look the same as before P6.
    return (
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
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
        title={`${title}${authorsLine ? ` — ${authorsLine}` : ""}\nFile: ${sourceName}`}
      >
        {title}
      </div>
      {authorsLine && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "rgba(15,23,42,0.6)",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={authorsLine}
        >
          {authorsLine}
        </div>
      )}
    </div>
  );
}
