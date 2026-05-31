"use client";

// ── SpecForgeCardShapeUtil ──
//
// One decision card in a SpecForge unfurl (idea → clean summary → target user →
// problem cause tree → root constraint → first-principles need → desired result
// → product thesis → alternatives → differentiation → solution families → top
// MVPs → recommended first build). Distinct from `artifact-card` (a room-item
// reference): this is a causal DECISION artifact, so it gets its own restrained
// Apple-Vision-Pro chrome — white card, stage color used only as a soft accent
// glow + a folder-tab eyebrow pill + a stage dot. No flat tinted rects, no side
// spines (per the module's UI taste). Self-contained, no app context.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useState, useEffect } from "react";
import {
  MoreHorizontal,
  Layers,
  Rocket,
  Split,
  Shuffle,
  ListChecks,
  BookmarkPlus,
} from "lucide-react";
import { CardHoverActions } from "../canvas-interactions/card-hover-actions";
import {
  dispatchCardAction,
  CARD_SAVED_EVENT,
  type CardSavedDetail,
  type CardAction,
} from "../board-bus";

// The actions a decision card can take, shown in its pop-up "⋯" menu.
const CARD_MENU_ITEMS: { key: CardAction; label: string; Icon: typeof Split }[] =
  [
    { key: "open_room", label: "Open as room", Icon: Layers },
    { key: "promote_objective", label: "New objective", Icon: Rocket },
    { key: "decompose", label: "Decompose", Icon: Split },
    { key: "variations", label: "Variations", Icon: Shuffle },
    { key: "make_plan", label: "Make plan", Icon: ListChecks },
    { key: "save", label: "Save to Library", Icon: BookmarkPlus },
  ];
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { STAGE_META, type SpecForgeStage } from "@/lib/objective-canvas/specforge/types";

export type SpecForgeCardShape = TLBaseShape<
  "specforge-card",
  {
    w: number;
    h: number;
    /** One of the SpecForge stages (drives the accent). */
    stage: string;
    /** Eyebrow label override (defaults to the stage label). */
    eyebrow: string;
    title: string;
    subtitle: string;
    /** Bullet lines, "\n"-delimited (each rendered as a row). */
    body: string;
    /** Stable id so Save → Library + the saved-confirm echo work. */
    entityId: string;
  }
>;

const NEUTRAL = { label: "Decision", color: appleVibe.text.tertiary };

function stageMeta(stage: string) {
  return STAGE_META[stage as SpecForgeStage] ?? NEUTRAL;
}

export class SpecForgeCardShapeUtil extends BaseBoxShapeUtil<SpecForgeCardShape> {
  static override type = "specforge-card" as const;
  static override props: RecordProps<SpecForgeCardShape> = {
    w: T.number,
    h: T.number,
    stage: T.string,
    eyebrow: T.string,
    title: T.string,
    subtitle: T.string,
    body: T.string,
    entityId: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SpecForgeCardShape,
    info: TLResizeInfo<SpecForgeCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): SpecForgeCardShape["props"] {
    return {
      w: 336,
      h: 150,
      stage: "input",
      eyebrow: "",
      title: "Decision",
      subtitle: "",
      body: "",
      entityId: "",
    };
  }

  component(shape: SpecForgeCardShape) {
    return <SpecForgeCardRenderer shape={shape} />;
  }

  indicator(shape: SpecForgeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function SpecForgeCardRenderer({ shape }: { shape: SpecForgeCardShape }) {
  const { stage, eyebrow, title, subtitle, body, entityId } = shape.props;
  const meta = stageMeta(stage);
  const color = meta.color;
  const eyebrowLabel = eyebrow || meta.label;
  const isHero = stage === "recommendation";

  const lines = body
    ? body.split("\n").map((l) => l.replace(/^•\s*/, "").trim()).filter(Boolean)
    : [];

  const [hovered, setHovered] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!entityId) return;
    function onSaved(e: Event) {
      const d = (e as CustomEvent<CardSavedDetail>).detail;
      if (d?.entityId === entityId) setSaved(true);
    }
    window.addEventListener(CARD_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(CARD_SAVED_EVENT, onSaved);
  }, [entityId]);

  // "Open as room" — promote this decision card into its own sub-objective
  // room (Pain → Features → Outcomes → Objective layers), like any other
  // feature. Creates the sub-objective from the card's text, pre-warms room
  // generation, then opens the room. spaceId is read from the canvas URL.
  const [opening, setOpening] = useState(false);
  async function openAsRoom() {
    if (opening) return;
    const spaceId = window.location.pathname.match(/\/objective\/([^/]+)/)?.[1];
    if (!spaceId) return;
    setOpening(true);
    try {
      const res = await fetch("/api/brainstorm/sub-objectives/from-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          title,
          description: subtitle || body || title,
          rationale: body || undefined,
        }),
      });
      const json = (await res.json()) as { goal_id?: string };
      if (!json?.goal_id) {
        setOpening(false);
        return;
      }
      // Pre-warm the room's layered generation (idempotent on initial mode),
      // then open the room so its layers are visible as they land.
      void fetch("/api/brainstorm/room/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          subObjectiveId: json.goal_id,
          mode: "initial",
        }),
      });
      window.location.assign(`/app/objective/${spaceId}/sub/${json.goal_id}`);
    } catch {
      setOpening(false);
    }
  }

  // "New objective" — spin this card off into its OWN objective canvas via
  // the full intake pipeline (its own clarify → sub-objectives → rooms →
  // layers). Autopilot mode skips the questions and advances straight to the
  // sub-objective picker, mirroring the entry card.
  async function promoteToObjective() {
    if (opening) return;
    setOpening(true);
    try {
      const objective = [title, subtitle, body]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 4000);
      const res = await fetch("/api/brainstorm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective, mode: "autopilot" }),
      });
      const json = (await res.json()) as { spaceId?: string };
      if (!json?.spaceId) {
        setOpening(false);
        return;
      }
      // Autopilot: skip clarifying questions → advance to the picker.
      try {
        await fetch("/api/brainstorm/clarify/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId: json.spaceId }),
        });
      } catch {
        /* non-fatal — the new canvas can recover on load */
      }
      // Carry the parent objective so the new canvas can show a "Back to
      // parent" breadcrumb — the cross-space branch lineage.
      const fromSpaceId = window.location.pathname.match(
        /\/objective\/([^/]+)/,
      )?.[1];
      const dest = `/app/objective/${json.spaceId}${
        fromSpaceId ? `?from=${fromSpaceId}` : ""
      }`;
      window.location.assign(dest);
    } catch {
      setOpening(false);
    }
  }

  // Unified action dispatch — shared by the hover bar + the "⋯" pop-up menu.
  // Spawn actions are handled locally; the rest ride the board-bus.
  const [menuOpen, setMenuOpen] = useState(false);
  function handleAction(action: CardAction) {
    setMenuOpen(false);
    if (action === "open_room") {
      void openAsRoom();
      return;
    }
    if (action === "promote_objective") {
      void promoteToObjective();
      return;
    }
    dispatchCardAction({ action, entityId, title, shapeId: shape.id });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 20,
            background: isHero
              ? `linear-gradient(160deg, rgba(255,255,255,0.99) 0%, ${color}0E 100%)`
              : "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,249,252,0.97) 100%)",
            border: `1px solid ${isHero ? `${color}33` : "rgba(15,23,42,0.07)"}`,
            // The signature: a soft accent glow tinted by the stage color, over a
            // neutral depth shadow + inset top sheen. No flat fills, no spines.
            boxShadow: [
              "inset 0 1px 0 rgba(255,255,255,0.9)",
              "0 1px 2px rgba(11,18,40,0.05)",
              `0 16px 40px -18px ${color}${isHero ? "8C" : "55"}`,
              "0 6px 18px -12px rgba(11,18,40,0.16)",
            ].join(", "),
            padding: "13px 15px 12px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {/* Spawn feedback — "Open as room" / "New objective" run a
              multi-second async (create → generate → navigate); a frosted
              veil tells the user it's working instead of looking frozen. */}
          {opening && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 12,
                borderRadius: 20,
                background: "rgba(255,255,255,0.74)",
                backdropFilter: "blur(5px)",
                WebkitBackdropFilter: "blur(5px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontSize: 12.5,
                fontWeight: 600,
                color,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  border: `2px solid ${color}`,
                  borderTopColor: "transparent",
                  animation: "spin 0.7s linear infinite",
                }}
              />
              Opening…
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {/* Eyebrow row — folder-tab pill + grip. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: color,
                  boxShadow: `0 0 0 2px ${color}22`,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                  color,
                }}
              >
                {eyebrowLabel}
              </span>
            </span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="Card actions"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: 7,
                border: "none",
                background: menuOpen ? "rgba(15,23,42,0.07)" : "transparent",
                color: "rgba(15,23,42,0.4)",
                cursor: "pointer",
              }}
            >
              <MoreHorizontal style={{ width: 15, height: 15 }} />
            </button>
          </div>

          {/* Title */}
          <div
            style={{
              marginTop: 9,
              fontSize: isHero ? 15.5 : 14.5,
              fontWeight: 650,
              lineHeight: 1.24,
              letterSpacing: "-0.01em",
              color: appleVibe.text.primary,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </div>

          {/* Subtitle */}
          {subtitle && (
            <div
              style={{
                marginTop: 5,
                fontSize: 11.5,
                fontWeight: 500,
                lineHeight: 1.36,
                color: appleVibe.text.secondary,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {subtitle}
            </div>
          )}

          {/* Body bullets */}
          {lines.length > 0 && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 3,
                overflow: "hidden",
              }}
            >
              {lines.slice(0, 4).map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 11,
                    lineHeight: 1.32,
                    color: appleVibe.text.tertiary,
                  }}
                >
                  <span
                    style={{
                      marginTop: 5,
                      width: 3,
                      height: 3,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: `${color}AA`,
                    }}
                  />
                  <span
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {line}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* "⋯" pop-up menu — the discoverable list of what this card can do.
            Rendered in the OUTER (relative) wrapper so it isn't clipped by the
            card body's overflow:hidden. */}
        {menuOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 38,
              right: 8,
              zIndex: 80,
              minWidth: 188,
              padding: 6,
              borderRadius: 14,
              background: "rgba(255,255,255,0.93)",
              border: "1px solid rgba(15,23,42,0.08)",
              boxShadow:
                "0 18px 50px -16px rgba(11,18,40,0.35), inset 0 1px 0 rgba(255,255,255,0.8)",
              backdropFilter: "blur(20px) saturate(170%)",
              WebkitBackdropFilter: "blur(20px) saturate(170%)",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              fontFamily: appleVibe.font.stack,
            }}
          >
            {CARD_MENU_ITEMS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(key);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  borderRadius: 9,
                  border: "none",
                  background: "transparent",
                  color: "rgba(15,23,42,0.82)",
                  fontSize: 12.5,
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(15,23,42,0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon
                  style={{ width: 14, height: 14, color }}
                  strokeWidth={2}
                />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Per-card hover action bar — same component the room/artifact cards
            use, so a decision card can be saved to Library or pushed deeper. */}
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: "50%",
            transform: `translateX(-50%) translateY(${hovered ? 0 : -4}px)`,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 130ms ease-out, transform 130ms ease-out",
            zIndex: 60,
          }}
        >
          <CardHoverActions
            accent={color}
            saved={saved}
            onAction={handleAction}
          />
        </div>
      </div>
    </HTMLContainer>
  );
}
