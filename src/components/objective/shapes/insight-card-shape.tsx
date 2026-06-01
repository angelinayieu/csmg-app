"use client";

// ── InsightCardShapeUtil ──
//
// The AI's contribution to the board: a "Connect" (relationship between
// two cards) or "Synthesize" (insight across 3+ cards) result. It lands
// as a PROPOSAL — dashed, with Keep / Dismiss — so the human always
// curates. Nothing the AI says is forced onto the board.
//
// Self-contained (no app context, no external event bus): the card owns
// its own accept/reject. Accepting flips status to "accepted" and
// solidifies its linked arrows; dismissing deletes the card AND the
// arrows that tether it to its sources (tagged via meta.proposalFor).
// This keeps the focused objective board free of the heavy canvas
// chrome the main InteraxisCanvas uses for the same lifecycle.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
  resizeBox,
} from "tldraw";
import { Check, X, Globe } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** A web source backing a Deep Synthesize node. */
export type InsightCitation = { title: string; url: string };

export type InsightCardShape = TLBaseShape<
  "insight-card",
  {
    w: number;
    h: number;
    /** proposed → ghost with Keep/Dismiss; accepted → solid, persisted. */
    status: "proposed" | "accepted";
    /** connect = relationship between 2; synthesize = insight across N. */
    kind: "connect" | "synthesize";
    /** single = standalone Connect/Synthesize result; hub + branch = the
     *  nodes of a Deep Synthesize map (hub carries the cascade Keep/Dismiss
     *  for the whole cluster, tagged via meta.mapId). */
    role: "single" | "hub" | "branch";
    headline: string;
    body: string;
    color: string;
    /** tldraw ids of the source cards this insight links to. */
    sourceIds: string[];
    /** web sources backing this node (Deep Synthesize); empty otherwise. */
    citations: InsightCitation[];
  }
>;

// Props migration — `role` + `citations` were added after insight-card
// shapes were already persisted in canvases.snapshot. Without this, tldraw
// validation rejects older shapes on load. Defaults keep legacy Connect/
// Synthesize cards behaving exactly as before.
const Versions = createShapePropsMigrationIds("insight-card", {
  addRoleAndCitations: 1,
});

export const insightCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.addRoleAndCitations,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.role === undefined) p.role = "single";
        if (p.citations === undefined) p.citations = [];
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.role;
        delete p.citations;
      },
    },
  ],
});

export class InsightCardShapeUtil extends BaseBoxShapeUtil<InsightCardShape> {
  static override type = "insight-card" as const;
  static override props: RecordProps<InsightCardShape> = {
    w: T.number,
    h: T.number,
    status: T.literalEnum("proposed", "accepted"),
    kind: T.literalEnum("connect", "synthesize"),
    role: T.literalEnum("single", "hub", "branch"),
    headline: T.string,
    body: T.string,
    color: T.string,
    sourceIds: T.arrayOf(T.string),
    citations: T.arrayOf(T.object({ title: T.string, url: T.string })),
  };

  static override migrations = insightCardMigrations;

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: InsightCardShape, info: TLResizeInfo<InsightCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): InsightCardShape["props"] {
    return {
      w: 252,
      h: 168,
      status: "proposed",
      kind: "connect",
      role: "single",
      headline: "",
      body: "",
      color: "#475569",
      sourceIds: [],
      citations: [],
    };
  }

  component(shape: InsightCardShape) {
    return <InsightCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: InsightCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

/** Human-readable source label for a citation chip (bare host, no www.). */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return (url || "source").slice(0, 28);
  }
}

function InsightCardRenderer({
  shape,
  util,
}: {
  shape: InsightCardShape;
  util: InsightCardShapeUtil;
}) {
  const { status, kind, role, headline, body, color, citations } = shape.props;
  const editor = util.editor;
  const proposed = status === "proposed";
  const isHub = role === "hub";
  const isBranch = role === "branch";

  /** Arrows tethering THIS insight to its sources (single-card lifecycle). */
  function linkedArrowIds(): TLShapeId[] {
    return editor
      .getCurrentPageShapes()
      .filter(
        (s) =>
          s.type === "arrow" &&
          (s.meta as { proposalFor?: string })?.proposalFor === shape.id,
      )
      .map((s) => s.id);
  }

  /** Every node + arrow belonging to this Deep Synthesize map — the hub
   *  curates the whole cluster as one decision (tagged via meta.mapId, and
   *  the hub is tagged with its own id so it's included). */
  function mapMemberShapes(): TLShape[] {
    const members = editor
      .getCurrentPageShapes()
      .filter((s) => (s.meta as { mapId?: string })?.mapId === shape.id);
    return members.some((s) => s.id === shape.id)
      ? members
      : [...members, shape as TLShape];
  }

  function keep(e: React.MouseEvent) {
    e.stopPropagation();
    if (isHub) {
      // Accept the entire map: every node → accepted, every arrow → solid.
      editor.updateShapes(
        mapMemberShapes().map((s) =>
          s.type === "arrow"
            ? {
                id: s.id,
                type: "arrow",
                props: { dash: "solid", color: "grey" },
              }
            : { id: s.id, type: "insight-card", props: { status: "accepted" } },
        ),
      );
      return;
    }
    editor.updateShape<InsightCardShape>({
      id: shape.id,
      type: "insight-card",
      props: { status: "accepted" },
    });
    // Solidify the tethers so an accepted insight reads as "real".
    for (const id of linkedArrowIds()) {
      editor.updateShape({
        id,
        type: "arrow",
        props: { dash: "solid", color: "grey" },
      });
    }
  }

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    if (isHub) {
      editor.deleteShapes(mapMemberShapes().map((s) => s.id));
      return;
    }
    editor.deleteShapes([shape.id, ...linkedArrowIds()]);
  }

  const eyebrow = isHub
    ? "Synthesis map"
    : isBranch
      ? "Cross-link"
      : kind === "connect"
        ? "Connection"
        : "Synthesis";

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
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(249,247,255,0.97) 100%)",
          border: proposed
            ? `1.5px dashed ${color}80`
            : `1px solid ${color}40`,
          boxShadow: proposed
            ? `0 1px 2px rgba(11,18,40,0.04), 0 14px 38px -16px ${color}40`
            : `0 1px 2px rgba(11,18,40,0.05), 0 18px 48px -16px ${color}55, 0 8px 22px -10px rgba(11,18,40,0.16)`,
          padding: "14px 15px 12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          opacity: proposed ? 0.97 : 1,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Eyebrow — the AI provenance tag. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Sparkle style={{ width: 12, height: 12, color }} strokeWidth={2.4} />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color,
            }}
          >
            {eyebrow}
          </span>
          {proposed && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: appleVibe.text.tertiary,
              }}
            >
              Proposed
            </span>
          )}
        </div>

        {/* Headline — the relationship / insight, lead element. */}
        <div
          style={{
            marginTop: 10,
            fontSize: kind === "connect" ? 17 : 15.5,
            fontWeight: 650,
            lineHeight: 1.2,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {headline}
        </div>

        {/* Body — the "why" / the "so what". */}
        {body && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: citations.length > 0 ? 2 : proposed ? 3 : 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {body}
          </div>
        )}

        {/* Citation chips — the web sources backing a Deep Synthesize node.
            Clickable; the source stays attached to the claim it supports. */}
        {citations.length > 0 && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexWrap: "wrap",
              gap: 5,
            }}
          >
            {citations.slice(0, 3).map((c, i) => (
              <button
                key={i}
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => {
                  e.stopPropagation();
                  if (c.url)
                    window.open(c.url, "_blank", "noopener,noreferrer");
                }}
                title={c.title || c.url}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: "100%",
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: `1px solid ${color}30`,
                  background: `${color}0F`,
                  color: appleVibe.text.secondary,
                  fontSize: 10,
                  fontWeight: 550,
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                <Globe
                  style={{ width: 10, height: 10, color, flexShrink: 0 }}
                  strokeWidth={2.2}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {domainOf(c.url)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Footer: Keep / Dismiss while proposed; branches are curated via
            the hub, so they carry no buttons of their own. */}
        {proposed && !isBranch && (
          <div
            style={{
              marginTop: "auto",
              paddingTop: 10,
              display: "flex",
              gap: 7,
            }}
          >
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={keep}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: color,
                color: "white",
                fontSize: 11.5,
                fontWeight: 600,
                boxShadow: `0 4px 12px -3px ${color}88`,
              }}
            >
              <Check style={{ width: 12, height: 12 }} strokeWidth={3} />
              {isHub ? "Keep all" : "Keep"}
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={dismiss}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid rgba(15,23,42,0.12)",
                cursor: "pointer",
                background: "rgba(255,255,255,0.6)",
                color: "rgba(15,23,42,0.55)",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              <X style={{ width: 12, height: 12 }} strokeWidth={2.6} />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
