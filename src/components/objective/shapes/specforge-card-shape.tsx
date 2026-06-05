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
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
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
  Network,
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

export const OPEN_CAUSAL_MODEL_EVENT = "objective-board:open-causal-model";

export interface OpenCausalModelDetail {
  modelJson: string;
  title: string;
}

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
    /** Stringified multifactor causal model for the full CLD panel. */
    modelJson: string;
    /** Stable id so Save → Library + the saved-confirm echo work. */
    entityId: string;
    /** specforge_engine_runs.id — the durable engine_run this card was
     *  produced from (KG state model Phase A, migration 20260924).
     *  Empty string when the card pre-dates persistence or when the
     *  forge ran without a spaceId. Enables future "click card → see
     *  this artifact's run / pipeline / quality verdict" UX. */
    engineRunId: string;
  }
>;

const Versions = createShapePropsMigrationIds("specforge-card", {
  addModelJson: 1,
  addEngineRunId: 2,
});

export const specForgeCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.addModelJson,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.modelJson === undefined) p.modelJson = "";
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.modelJson;
      },
    },
    {
      id: Versions.addEngineRunId,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.engineRunId === undefined) p.engineRunId = "";
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.engineRunId;
      },
    },
  ],
});

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
    modelJson: T.string,
    entityId: T.string,
    engineRunId: T.string,
  };

  static override migrations = specForgeCardMigrations;

  override canResize = () => true;
  override canEdit = () => false;

  // Single-click opens the Side Panel — matches the oc-card pattern
  // (double-click raced tldraw's edit and felt unreliable). Modifier-
  // clicks (shift/ctrl/alt) skip the panel so multi-select for
  // Connect/Synthesize/Converge still works. The detail panel fires
  // OPEN_SPECFORGE_DETAIL_EVENT — listener is the SpecForgeDetailPanel
  // mounted once at the board level.
  override onClick = (shape: SpecForgeCardShape) => {
    const i = this.editor.inputs;
    if (i.shiftKey || i.ctrlKey || i.altKey) return;
    try {
      window.dispatchEvent(
        new CustomEvent("objective-board:open-specforge-detail", {
          detail: { shapeId: String(shape.id) },
        }),
      );
    } catch {
      /* SSR / no window — board never runs there but be defensive */
    }
  };

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
      modelJson: "",
      entityId: "",
      engineRunId: "",
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
  const { stage, eyebrow, title, subtitle, body, modelJson, entityId } = shape.props;
  const meta = stageMeta(stage);
  const color = meta.color;
  const eyebrowLabel = eyebrow || meta.label;
  const isHero = stage === "recommendation";
  // Gate badge — written into shape.meta by the runner from Phase A's
  // critic result. "passed" shows a subtle green dot only (we don't shout
  // for clean passes); "repaired" / "failed" show a tiny pill so the user
  // immediately sees which engines need attention. Per spec §21.
  const gateStatus = (shape.meta as { gateStatus?: unknown })?.gateStatus as
    | "passed"
    | "repaired"
    | "failed"
    | undefined;

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
      // Record the branch lineage so the new objective can show a titled
      // breadcrumb chain back through its ancestors (folder/sub-tab nav).
      const fromSpaceId = window.location.pathname.match(
        /\/objective\/([^/]+)/,
      )?.[1];
      if (fromSpaceId) {
        try {
          await fetch(`/api/brainstorm/space/${json.spaceId}/lineage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ parentSpaceId: fromSpaceId }),
          });
        } catch {
          /* non-fatal — the breadcrumb just won't render */
        }
      }
      window.location.assign(`/app/objective/${json.spaceId}`);
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

  function openCausalModel(e: React.MouseEvent) {
    e.stopPropagation();
    if (!modelJson) return;
    window.dispatchEvent(
      new CustomEvent<OpenCausalModelDetail>(OPEN_CAUSAL_MODEL_EVENT, {
        detail: { modelJson, title },
      }),
    );
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
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {gateStatus === "passed" && (
                <span
                  title="Quality gate passed"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: "#22C55E",
                    boxShadow: "0 0 0 2px rgba(34,197,94,0.18)",
                  }}
                />
              )}
              {gateStatus === "repaired" && (
                <span
                  title="Output repaired after critic flagged issues"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "rgba(245,158,11,0.12)",
                    border: "1px solid rgba(245,158,11,0.32)",
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: "#B45309",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: "#F59E0B",
                    }}
                  />
                  REPAIRED
                </span>
              )}
              {gateStatus === "failed" && (
                <span
                  title="Quality gate flagged this output; downstream engines may be affected"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "rgba(239,68,68,0.10)",
                    border: "1px solid rgba(239,68,68,0.32)",
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: "#B91C1C",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: "#EF4444",
                    }}
                  />
                  FLAGGED
                </span>
              )}
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
            </span>
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

          {modelJson && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={openCausalModel}
              title="Open causal model"
              style={{
                marginTop: "auto",
                alignSelf: "flex-start",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${color}24`,
                background: `${color}10`,
                color,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 650,
              }}
            >
              <Network style={{ width: 12, height: 12 }} strokeWidth={2.4} />
              Open model
            </button>
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
