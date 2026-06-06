"use client";

// ── OcCardShapeUtil — Feature / Variable cards ──
//
// The downstream decomposition cards on the objective board. Two kinds,
// one shape (distinct visual treatment per kind):
//   • feature  — a concrete capability; face = name + a sharp, info-dense
//                description of its utility.
//   • variable — a concept the work turns on; face = name + a sharp
//                definition.
//
// The face shows ONLY the concrete summary (name + body). The rich
// metadata library + knowledge graph live behind a single click, which
// fires OPEN_CARD_DETAIL_EVENT (the board opens the expand drawer). The
// name/body are AI-refined from the card's metadata server-side and
// written back onto these props.
//
// Design: minimalist, zen. No icons. Type is conveyed by a single small
// accent dot + a sentence-case word + a soft accent-tinted glow — never a
// capital-grey eyebrow. Name is the bold near-black focal line; the body
// is smaller + lighter. Self-contained (no app context).

import { useRef, useState } from "react";
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
import { Heart } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { useAutoFitHeight } from "@/components/objective/canvas-interactions/use-auto-fit-height";
import { TasteReceipt } from "@/components/objective/canvas-interactions/taste-receipt";

export type OcCardKind = "feature" | "variable";

export type OcCardShape = TLBaseShape<
  "oc-card",
  {
    w: number;
    h: number;
    kind: OcCardKind;
    /** AI-refined direct name (utility-first, no metaphors). */
    name: string;
    /** feature → concise description; variable → concise definition. */
    body: string;
    /** Backing library_objects row id ("" until persisted). */
    objectId: string;
    /** Count of attached metadata items (sources + notes), for the footer. */
    metaCount: number;
  }
>;

/** Fired on click — the board opens the card's expand drawer
 *  (metadata → categorized gallery → knowledge graph). */
export const OPEN_CARD_DETAIL_EVENT = "objective-board:open-card-detail";

export interface OpenCardDetail {
  objectId: string;
  shapeId: string;
  kind: OcCardKind;
  name: string;
}

/** Typed dispatcher so callers don't hand-roll the CustomEvent. */
export function openCardDetail(detail: OpenCardDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail }));
}

// One accent per kind — a quiet identity hue (existing stage colors), used
// only for the dot + a soft glow. Everything else stays neutral.
const ACCENT: Record<OcCardKind, string> = {
  feature: appleVibe.stage.features, // #2563EB
  variable: appleVibe.stage.process, // #0D9488
};
const KIND_WORD: Record<OcCardKind, string> = {
  feature: "Feature",
  variable: "Variable",
};

export class OcCardShapeUtil extends BaseBoxShapeUtil<OcCardShape> {
  static override type = "oc-card" as const;
  static override props: RecordProps<OcCardShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum("feature", "variable"),
    name: T.string,
    body: T.string,
    objectId: T.string,
    metaCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: OcCardShape, info: TLResizeInfo<OcCardShape>) => {
    return resizeBox(shape, info);
  };

  // Single-click opens the metadata/KG drawer — smooth, no double-click (which
  // raced tldraw's edit and felt unreliable). A modifier-click (shift / ctrl /
  // alt) is left for multi-select so Connect / Synthesize / Converge still work.
  override onClick = (shape: OcCardShape) => {
    const i = this.editor.inputs;
    if (i.shiftKey || i.ctrlKey || i.altKey) return;
    openCardDetail({
      objectId: shape.props.objectId,
      shapeId: shape.id,
      kind: shape.props.kind,
      name: shape.props.name,
    });
  };

  getDefaultProps(): OcCardShape["props"] {
    return {
      w: 248,
      // Fits the clamped face (2-line name + 3-line body + footer) so the card
      // never spawns cropped; useAutoFitHeight grows it further if needed.
      h: 176,
      kind: "feature",
      name: "Untitled",
      body: "",
      objectId: "",
      metaCount: 0,
    };
  }

  component(shape: OcCardShape) {
    return <OcCardRenderer shape={shape} />;
  }

  indicator(shape: OcCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function OcCardRenderer({ shape }: { shape: OcCardShape }) {
  const { kind, name, body, metaCount, objectId } = shape.props;
  const accent = ACCENT[kind];
  const [hovered, setHovered] = useState(false);

  // No-crop on spawn: grow the card to fit its rendered face so the name/body
  // are never clipped. The standardized board-card rule (see useAutoFitHeight),
  // same as the prompt-sharpening card.
  const editor = useEditor();
  const contentRef = useRef<HTMLDivElement>(null);
  useAutoFitHeight(editor, shape.id, "oc-card", shape.props.h, contentRef, [
    kind,
    name,
    body,
    shape.props.w,
  ]);

  // Favorite (meta.favorited) — surfaces the card in the FavoritesSidebar and
  // weights it higher in the objective node's contents. For a card with a
  // backing library object it ALSO flags included_in_spec so the favorite
  // carries real weight into the build spec.
  const favorited = !!(shape.meta as { favorited?: boolean })?.favorited;
  function toggleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !favorited;
    editor.updateShape({
      id: shape.id,
      type: "oc-card",
      meta: { ...shape.meta, favorited: next },
    });
    if (objectId) {
      // spaceId isn't on the shape props — read it from the board URL.
      const m =
        typeof window !== "undefined"
          ? window.location.pathname.match(/\/objective\/([^/?#]+)/)
          : null;
      const spaceId = m?.[1];
      if (spaceId) {
        void fetch(`/api/brainstorm/space/${spaceId}/library/objects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "include", objectId, included: next }),
        }).catch(() => {
          /* best-effort — the board meta is the source of truth for the heart */
        });
      }
    }
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        ref={contentRef}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: appleVibe.surface.card,
          // Soft accent-tinted glow (no hard border/spine), lifts on hover.
          boxShadow: hovered
            ? `0 1px 2px rgba(11,18,40,0.05), 0 22px 48px -20px ${accent}4d, 0 10px 24px -14px rgba(11,18,40,0.18)`
            : `0 1px 2px rgba(11,18,40,0.05), 0 16px 38px -22px ${accent}3d, 0 7px 18px -14px rgba(11,18,40,0.13)`,
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "box-shadow 220ms ease-out, transform 220ms ease-out",
          padding: "15px 17px 13px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Type marker — accent dot + sentence-case word. No caps, no icon. */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: accent,
              flex: "none",
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: appleVibe.text.tertiary,
            }}
          >
            {KIND_WORD[kind]}
          </span>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={toggleFavorite}
            aria-label={favorited ? "Unfavorite" : "Favorite"}
            title={
              favorited ? "Remove weight" : "Favorite — weights the build spec"
            }
            style={{
              marginLeft: "auto",
              display: "inline-grid",
              placeItems: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              border: "none",
              background: favorited
                ? "rgba(244,63,94,0.10)"
                : "rgba(15,23,42,0.04)",
              cursor: "pointer",
              opacity: favorited || hovered ? 1 : 0.5,
              transition: "opacity 160ms ease-out",
            }}
          >
            <Heart
              style={{
                width: 13,
                height: 13,
                color: favorited ? "#F43F5E" : appleVibe.text.faint,
              }}
              fill={favorited ? "#F43F5E" : "none"}
              strokeWidth={2.2}
            />
          </button>
        </div>

        {/* Name — the bold near-black focal line. Wraps naturally; the card
            auto-grows (useAutoFitHeight) so the full name is visible. */}
        <div
          style={{
            marginTop: 9,
            fontSize: 15.5,
            fontWeight: 600,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            color: appleVibe.text.primary,
            wordBreak: "break-word",
          }}
        >
          {name || "Untitled"}
        </div>

        {/* Body — description / definition: smaller + lighter. Wraps naturally;
            the card auto-grows so nothing is clipped. */}
        {body && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: 400,
              lineHeight: 1.45,
              color: appleVibe.text.secondary,
              wordBreak: "break-word",
            }}
          >
            {body}
          </div>
        )}

        {/* Taste receipt — which user-shaped glossary terms the AI honored
            when writing this card. Self-renders only when there are hits +
            spaceId resolves from the URL. Click stops propagation so the
            chip-clicks don't open the card drawer. */}
        {body && (
          <div onPointerDown={stopEventPropagation}>
            <OcCardTasteReceipt text={`${name} ${body}`} />
          </div>
        )}

        {/* Footer — a quiet "Open" affordance signalling the card opens. The
            whole card opens on a single click (ShapeUtil.onClick); a
            modifier-click (shift / ctrl) stays selection for Connect /
            Synthesize / Converge. */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          {metaCount > 0 ? (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: appleVibe.text.faint,
              }}
            >
              {metaCount} in library
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              openCardDetail({ objectId, shapeId: shape.id, kind, name });
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              color: accent,
              padding: 0,
              opacity: hovered ? 1 : 0.65,
              transition: "opacity 160ms ease-out",
            }}
          >
            Open ↗
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

/** Thin wrapper that resolves spaceId from the URL and renders the
 *  taste receipt only when the page is a board page. Keeps the shape
 *  itself decoupled from routing (it's still pure-presentational from
 *  tldraw's perspective). */
function OcCardTasteReceipt({ text }: { text: string }) {
  const spaceId =
    typeof window !== "undefined"
      ? window.location.pathname.match(/\/objective\/([^/?#]+)/)?.[1] ?? null
      : null;
  if (!spaceId) return null;
  return <TasteReceipt text={text} spaceId={spaceId} variant="strip" />;
}
