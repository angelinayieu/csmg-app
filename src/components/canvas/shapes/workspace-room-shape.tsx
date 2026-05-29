"use client";

// ── WorkspaceRoomShape util ──
//
// Renders a "workspace room" on the canvas. Each room hosts an
// arbitrary artifact (brainstorm session, strategy doc, twin
// construction, probe transcript). The `kind` prop decides which
// renderer body is used.
//
// This is the universal-canvas primitive — the space canvas's
// pipeline-stage rooms (RoomShape) handle the 8 stage backdrops;
// this shape handles everything else (user-created artifact rooms).
//
// Phase A: only "brainstorm" kind is fully implemented. Strategy /
// twin / probe kinds render a stub "Coming soon" body so the shape
// type validates for all four discriminants from day one.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
  useEditor,
  stopEventPropagation,
} from "tldraw";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Expand,
  FileText,
  Layers,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  Network,
  Sparkles,
  TestTube,
} from "lucide-react";
import type { WorkspaceRoomShape } from "./types";

// Collapsed preset — compact card the picker lands on by default.
export const WORKSPACE_ROOM_DEFAULT_W = 360;
export const WORKSPACE_ROOM_DEFAULT_H = 220;
// Expanded preset — bigger card with room for richer per-kind content
// (pitch line, next-action step, fuller pill row). Toggled via the
// header chevron button; keeps the shape on the canvas (not a route
// navigation) — that's the "state 2" inline-expand UX the universal
// canvas needed.
export const WORKSPACE_ROOM_EXPANDED_W = 540;
export const WORKSPACE_ROOM_EXPANDED_H = 380;
const ENTRANCE_MS = 700;

// Per-kind visual treatment. Keeps the kinds distinguishable on the
// canvas without needing the user to read the label — quick glance =
// instant recognition.
const KIND_META: Record<
  WorkspaceRoomShape["props"]["kind"],
  {
    label: string;
    Icon: typeof Layers;
    accent: string;
    accentSoft: string;
  }
> = {
  brainstorm: {
    label: "Brainstorm",
    Icon: Layers,
    accent: "#0A84FF",
    accentSoft: "rgba(10, 132, 255, 0.08)",
  },
  strategy: {
    label: "Strategy",
    Icon: FileText,
    accent: "#7C3AED",
    accentSoft: "rgba(124, 58, 237, 0.08)",
  },
  twin: {
    label: "Digital Twin",
    Icon: TestTube,
    accent: "#10B981",
    accentSoft: "rgba(16, 185, 129, 0.08)",
  },
  probe: {
    label: "Brain Probe",
    Icon: MessageCircleQuestion,
    accent: "#F59E0B",
    accentSoft: "rgba(245, 158, 11, 0.08)",
  },
  space: {
    label: "R&D Space",
    Icon: Network,
    accent: "#E11D48",
    accentSoft: "rgba(225, 29, 72, 0.08)",
  },
};

export class WorkspaceRoomShapeUtil extends BaseBoxShapeUtil<WorkspaceRoomShape> {
  static override type = "workspace-room" as const;
  static override props: RecordProps<WorkspaceRoomShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum("brainstorm", "strategy", "twin", "probe", "space"),
    artifact_id: T.string,
    cached_title: T.string,
    spawnedAt: T.number,
    expanded: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => true;

  override onResize = (
    shape: WorkspaceRoomShape,
    info: TLResizeInfo<WorkspaceRoomShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): WorkspaceRoomShape["props"] {
    return {
      w: WORKSPACE_ROOM_DEFAULT_W,
      h: WORKSPACE_ROOM_DEFAULT_H,
      kind: "brainstorm",
      artifact_id: "",
      cached_title: "",
      spawnedAt: Date.now(),
      expanded: false,
    };
  }

  component(shape: WorkspaceRoomShape) {
    return <WorkspaceRoomView shape={shape} />;
  }

  indicator(shape: WorkspaceRoomShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}

function WorkspaceRoomView({ shape }: { shape: WorkspaceRoomShape }) {
  const editor = useEditor();
  const { w, h, kind, artifact_id, cached_title, spawnedAt, expanded } =
    shape.props;
  const meta = KIND_META[kind];
  const Icon = meta.Icon;

  // Entrance animation — plays once on spawn so the user sees the
  // room "land" on the canvas. Drop after ENTRANCE_MS so subsequent
  // re-renders don't replay.
  const [inEntrance, setInEntrance] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setInEntrance(false), ENTRANCE_MS);
    return () => window.clearTimeout(t);
  }, [spawnedAt]);

  // Toggle expanded ↔ collapsed. Anchors the card's CENTER so the
  // expansion feels like the card grows in place rather than snapping
  // its bottom-right outward. Tldraw stores x/y at top-left, so we
  // recompute x/y from the current center against the new w/h.
  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !expanded;
    const nextW = next ? WORKSPACE_ROOM_EXPANDED_W : WORKSPACE_ROOM_DEFAULT_W;
    const nextH = next ? WORKSPACE_ROOM_EXPANDED_H : WORKSPACE_ROOM_DEFAULT_H;
    const cx = shape.x + w / 2;
    const cy = shape.y + h / 2;
    editor.updateShape<WorkspaceRoomShape>({
      id: shape.id,
      type: "workspace-room",
      x: cx - nextW / 2,
      y: cy - nextH / 2,
      props: { w: nextW, h: nextH, expanded: next },
    });
  };

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
        // Animates the inline width/height when expand/collapse changes
        // the shape props. Tldraw's selection rect still snaps, but the
        // rendered card grows smoothly in place.
        transition:
          "width 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-2xl"
        style={{
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          boxShadow:
            "0 0 0 1px rgba(15,23,42,0.06), 0 12px 28px -16px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
          transform: inEntrance ? "scale(0.97) translateY(8px)" : "none",
          opacity: inEntrance ? 0 : 1,
          transition:
            "transform 600ms cubic-bezier(0.22, 1, 0.36, 1), opacity 600ms ease",
        }}
      >
        {/* Top-edge accent rail in the kind's color */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: meta.accent }}
        />

        {/* Header row: kind label on the left, expand/collapse on the
            right. The expand toggle stops pointer-down propagation so
            tldraw doesn't start a drag when the user clicks it. */}
        <div className="flex items-center justify-between gap-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg"
              style={{
                background: meta.accentSoft,
                color: meta.accent,
              }}
            >
              <Icon size={14} strokeWidth={1.75} />
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ color: meta.accent }}
            >
              {meta.label}
            </span>
          </div>
          <button
            onPointerDown={stopEventPropagation}
            onClick={handleToggleExpand}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            title={expanded ? "Collapse card" : "Expand card"}
            aria-label={expanded ? "Collapse card" : "Expand card"}
          >
            {expanded ? (
              <Minimize2 size={12} strokeWidth={1.75} />
            ) : (
              <Maximize2 size={12} strokeWidth={1.75} />
            )}
          </button>
        </div>

        {/* Per-kind body */}
        {kind === "brainstorm" ? (
          <BrainstormRoomBody
            artifactId={artifact_id}
            cachedTitle={cached_title}
            expanded={expanded}
          />
        ) : kind === "strategy" ? (
          <StrategyRoomBody
            artifactId={artifact_id}
            cachedTitle={cached_title}
            expanded={expanded}
          />
        ) : kind === "space" ? (
          <SpaceRoomBody
            artifactId={artifact_id}
            cachedTitle={cached_title}
            expanded={expanded}
            mode="space"
          />
        ) : kind === "twin" ? (
          <SpaceRoomBody
            artifactId={artifact_id}
            cachedTitle={cached_title}
            expanded={expanded}
            mode="twin"
          />
        ) : (
          <StubRoomBody kind={kind} expanded={expanded} />
        )}
      </div>
    </HTMLContainer>
  );
}

// ── BrainstormRoomBody ──
// Fetches the brainstorm_sessions row by id and renders title + node
// count + last-modified. Click anywhere → opens the synergy whiteboard
// in a new tab so the user can keep their canvas open.

interface BrainstormSummary {
  id: string;
  title: string;
  node_count: number;
  updated_at: string;
}

function BrainstormRoomBody({
  artifactId,
  cachedTitle,
  expanded,
}: {
  artifactId: string;
  cachedTitle: string;
  expanded: boolean;
}) {
  const [data, setData] = useState<BrainstormSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!artifactId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/synergy/sessions/${artifactId}/summary`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to load brainstorm");
        const json = (await res.json()) as { session: BrainstormSummary };
        if (!cancelled) setData(json.session);
      } catch {
        // Soft-fail — keep cached title visible
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const title = data?.title || cachedTitle || "Untitled brainstorm";
  const updated = data?.updated_at;
  const nodeCount = data?.node_count;

  const openHref = artifactId ? `/app/synergy/${artifactId}` : null;

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === "undefined" || !openHref) return;
    // Open in a new tab — keeps the workspace canvas accessible.
    window.open(openHref, "_blank");
  };

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!openHref) return;
    // Magic-move origin: the clicked control's screen rect, so the
    // window appears to grow out of where the user clicked.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:open-fullscreen", {
        detail: {
          kind: "brainstorm",
          artifactId,
          title,
          href: openHref,
          originRect: {
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            width: r.width,
          },
        },
      }),
    );
  };

  // Promotion bridge: brainstorm → strategy. Fires the existing
  // strategy-generate endpoint, then spawns a strategy room beside
  // this brainstorm so the lineage is immediately visible on canvas.
  const handleGenerateStrategy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!artifactId || generating) return;
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/synergy/sessions/${artifactId}/strategy/generate`,
        { method: "POST", cache: "no-store" },
      );
      if (!res.ok) throw new Error("Strategy generation failed");
      const json = (await res.json()) as {
        strategy: { id: string; statement: string | null; session_id: string };
      };
      window.dispatchEvent(
        new CustomEvent("canvas-workspace:add-strategy", {
          detail: {
            strategyId: json.strategy.id,
            sessionId: json.strategy.session_id,
            statement: json.strategy.statement ?? "",
          },
        }),
      );
    } catch (err) {
      console.warn("[brainstorm-room] generate strategy failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-[calc(100%-44px)] flex-col px-5 pb-4 pt-2">
      <h3
        className={
          expanded
            ? "font-display-tight line-clamp-4 text-[18px] font-semibold leading-snug tracking-tight text-gray-900"
            : "font-display-tight line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-gray-900"
        }
      >
        {title}
      </h3>

      {expanded && (
        <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
          A voice-augmented brainstorm canvas. Open to add nodes, refine
          components, and let the synthesizer turn your ideas into a strategy.
        </p>
      )}

      {/* Meta row */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
          {loading ? (
            <span className="text-gray-300">Loading…</span>
          ) : (
            <>
              {nodeCount !== undefined && (
                <span>
                  {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
                </span>
              )}
              {updated && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>{relativeTime(updated)}</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {expanded && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleGenerateStrategy}
              disabled={generating}
              className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100 disabled:opacity-60"
              title="Synthesize a strategy from this brainstorm and spawn its room"
            >
              <FileText className="h-3 w-3" />
              {generating ? "Generating…" : "Generate strategy"}
            </button>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleFullscreen}
            disabled={!openHref}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-50 text-gray-600 ring-1 ring-black/[0.04] transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
            title="Open fullscreen over the canvas"
            aria-label="Open fullscreen"
          >
            <Expand className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleOpen}
            className={
              expanded
                ? "inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-700"
                : "inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-gray-700"
            }
            title="Open this brainstorm in a new tab"
          >
            {expanded ? "Open in new tab" : "Open"}
            <ArrowUpRight
              className={expanded ? "h-3.5 w-3.5" : "h-3 w-3"}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── StrategyRoomBody ──
// Renders a synergy_strategies row as a compact dashboard tile:
// statement (truncated), effort-weighted progress strip, summary
// pills (steps / risks / hypotheses), last-modified + open-link.
// The strategy room is essentially a mini-version of the strategy
// doc's hero — same progress signal, same effort-weighting.

interface StrategySummary {
  id: string;
  statement: string | null;
  pitch: string | null;
  session_id: string;
  updated_at: string;
  total_steps: number;
  done_steps: number;
  risk_count: number;
  hypothesis_count: number;
  effort_weighted_done_pct: number;
}

function StrategyRoomBody({
  artifactId,
  cachedTitle,
  expanded,
}: {
  artifactId: string;
  cachedTitle: string;
  expanded: boolean;
}) {
  const [data, setData] = useState<StrategySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (!artifactId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/synergy/strategies/${artifactId}/summary`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to load strategy");
        const json = (await res.json()) as { strategy: StrategySummary };
        if (!cancelled) setData(json.strategy);
      } catch {
        // Soft-fail — keep cached title visible
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const statement = data?.statement?.trim() || cachedTitle || "Untitled strategy";
  const pitch = data?.pitch?.trim() || "";
  const totalSteps = data?.total_steps ?? 0;
  const doneSteps = data?.done_steps ?? 0;
  const riskCount = data?.risk_count ?? 0;
  const hypoCount = data?.hypothesis_count ?? 0;
  const pct = data?.effort_weighted_done_pct ?? 0;
  const updated = data?.updated_at;
  // Open destination — the strategy doc lives at the brainstorm's
  // session route, not the strategy id route.
  const openHref = data?.session_id
    ? `/app/synergy/${data.session_id}/strategy`
    : null;

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === "undefined" || !openHref) return;
    window.open(openHref, "_blank");
  };

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!openHref) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:open-fullscreen", {
        detail: {
          kind: "strategy",
          artifactId,
          title: statement,
          href: openHref,
          originRect: {
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            width: r.width,
          },
        },
      }),
    );
  };

  // Phase A.6 — reverse-direction CTA. Spawns the source brainstorm
  // as a workspace room. The spawner's drawProvenanceFromBrainstorm
  // detects this strategy room on the canvas and auto-draws the
  // B → S arrow.
  const handleShowSourceBrainstorm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data?.session_id) return;
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-brainstorm", {
        detail: {
          sessionId: data.session_id,
          title: "",
        },
      }),
    );
  };

  // Promotion bridge: strategy → R&D space. Packages the strategy's
  // statement + pitch as seed text, calls /api/intake/bootstrap to
  // create a new space, then spawns the corresponding space room with
  // fromStrategyId so the spawner auto-draws the provenance arrow.
  const handlePromoteToSpace = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data?.statement || promoting) return;
    setPromoting(true);
    try {
      const seed = [data.statement, data.pitch].filter(Boolean).join("\n\n");
      const res = await fetch("/api/intake/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Phase A.6 — forward both upstream pointers so the new space
        // persists them in synthesis_data.provenance. The brainstorm
        // session id rides through transitively because every strategy
        // is FK-linked to its source brainstorm. With these stored on
        // the space row, S → R and B → R arrows redraw in fresh canvas
        // sessions (not just the live event flow).
        body: JSON.stringify({
          text: seed,
          promoted_from_strategy_id: artifactId,
          promoted_from_brainstorm_session_id: data.session_id,
        }),
      });
      if (!res.ok) throw new Error("intake bootstrap failed");
      const json = (await res.json()) as { spaceId?: string };
      if (!json.spaceId) throw new Error("no spaceId in response");
      window.dispatchEvent(
        new CustomEvent("canvas-workspace:add-space", {
          detail: {
            spaceId: json.spaceId,
            name: data.statement.slice(0, 60),
            fromStrategyId: artifactId,
            fromBrainstormSessionId: data.session_id,
          },
        }),
      );
    } catch (err) {
      console.warn("[strategy-room] promote-to-space failed:", err);
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="flex h-[calc(100%-44px)] flex-col px-5 pb-4 pt-2">
      <h3
        className={
          expanded
            ? "font-display-tight line-clamp-4 text-[18px] font-semibold leading-snug tracking-tight text-gray-900"
            : "font-display-tight line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-gray-900"
        }
      >
        {statement}
      </h3>

      {expanded && pitch && (
        <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-gray-600">
          {pitch}
        </p>
      )}

      {/* Effort-weighted progress strip — matches the strategy doc's
          ProgressStrip vocabulary so canvas + doc speak the same
          language. */}
      {totalSteps > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-gray-200/70">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gray-900 transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
            {doneSteps} of {totalSteps}
          </span>
        </div>
      )}

      {/* Summary pills */}
      {(totalSteps > 0 || riskCount > 0 || hypoCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {totalSteps > 0 && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {totalSteps} {totalSteps === 1 ? "step" : "steps"}
            </span>
          )}
          {riskCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {riskCount} {riskCount === 1 ? "risk" : "risks"}
            </span>
          )}
          {hypoCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {hypoCount} {hypoCount === 1 ? "hypothesis" : "hypotheses"}
            </span>
          )}
        </div>
      )}

      {/* Meta row + open */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
          {loading ? (
            <span className="text-gray-300">Loading…</span>
          ) : updated ? (
            <span>{relativeTime(updated)}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {expanded && data?.session_id && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleShowSourceBrainstorm}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100"
              title="Spawn the source brainstorm room on this canvas"
            >
              <Sparkles className="h-3 w-3" />
              Show source
            </button>
          )}
          {expanded && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handlePromoteToSpace}
              disabled={promoting || !data?.statement}
              className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-60"
              title="Promote this strategy to a fresh R&D space and spawn its room"
            >
              <Network className="h-3 w-3" />
              {promoting ? "Promoting…" : "Take deeper"}
            </button>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleFullscreen}
            disabled={!openHref}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-50 text-gray-600 ring-1 ring-black/[0.04] transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
            title="Open fullscreen over the canvas"
            aria-label="Open fullscreen"
          >
            <Expand className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleOpen}
            disabled={!openHref}
            className={
              expanded
                ? "inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-50"
                : "inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-50"
            }
            title="Open this strategy in a new tab"
          >
            {expanded ? "Open in new tab" : "Open"}
            <ArrowUpRight
              className={expanded ? "h-3.5 w-3.5" : "h-3 w-3"}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SpaceRoomBody ──
// Handles both kind="space" (R&D pipeline mini-dashboard) and
// kind="twin" (twin-state mini-dashboard for the same underlying
// space row). Same fetch, different chrome: space mode shows KG
// coverage as the headline; twin mode shows twin readiness +
// "Open twin" as the headline. artifact_id is the space_id in both
// cases — keeping them on one row makes the cross-add UX simple
// (Open twin from a space room just spawns a twin room beside it
// with the same artifact_id).

interface SpaceRoomSummary {
  id: string;
  name: string;
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  maturity: "actionable_now" | "waiting_on_dependency" | "theoretical" | "blocked";
  digital_twin_state: "not_started" | "ready" | "active" | "retired";
  twin_initialized_at: string | null;
  updated_at: string;
  has_synthesis: boolean;
  /** Phase A.6 — surfaced from synthesis_data.provenance so the room
   *  can offer "Show source" CTAs that spawn the upstream rooms. Null
   *  when the space wasn't promoted from anything (direct intake). */
  from_strategy_id: string | null;
  from_brainstorm_session_id: string | null;
}

const MATURITY_LABEL: Record<SpaceRoomSummary["maturity"], string> = {
  actionable_now: "Actionable",
  waiting_on_dependency: "Pending dep",
  theoretical: "Exploratory",
  blocked: "Blocked",
};

const TWIN_STATE_LABEL: Record<SpaceRoomSummary["digital_twin_state"], string> = {
  not_started: "Twin not started",
  ready: "Twin ready",
  active: "Twin live",
  retired: "Twin retired",
};

function SpaceRoomBody({
  artifactId,
  cachedTitle,
  expanded,
  mode,
}: {
  artifactId: string;
  cachedTitle: string;
  expanded: boolean;
  mode: "space" | "twin";
}) {
  const [data, setData] = useState<SpaceRoomSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!artifactId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/spaces/${artifactId}/room-summary`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to load space");
        const json = (await res.json()) as { space: SpaceRoomSummary };
        if (!cancelled) setData(json.space);
      } catch {
        // Soft-fail — keep cached title visible
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const name = data?.name?.trim() || cachedTitle || "Untitled space";
  const entityCount = data?.entity_count ?? 0;
  const edgeCount = data?.edge_count ?? 0;
  const cycleCount = data?.cycle_count ?? 0;
  const maturity = data?.maturity ?? "theoretical";
  const twinState = data?.digital_twin_state ?? "not_started";
  const updated = data?.updated_at;
  // Twin mode is meaningless if the space has no twin yet — surface
  // a "not ready" caption instead of pretending to be live.
  const twinReady = twinState === "ready" || twinState === "active";

  // Open destination depends on mode. Space → whiteboard. Twin →
  // dedicated twin detail page (Twin Detail Page Phase 2 ships this
  // route as a real surface, not a stub).
  const openHref =
    mode === "twin"
      ? `/app/space/${artifactId}/twin`
      : `/app/space/${artifactId}/whiteboard`;

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === "undefined" || !artifactId) return;
    window.open(openHref, "_blank");
  };

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!artifactId) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:open-fullscreen", {
        detail: {
          kind: mode,
          artifactId,
          title: name,
          href: openHref,
          originRect: {
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            width: r.width,
          },
        },
      }),
    );
  };

  // Promotion bridges (Phase A.4).
  // Strategy-style "go to next stage" actions live in the expanded
  // body. Space room: "Build twin →" spawns a sibling twin room
  // with the same artifact_id. Twin room: "Show source" spawns the
  // shared space room so the lineage is visible in both rooms.
  const handleSpawnTwin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === "undefined" || !artifactId) return;
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-twin", {
        detail: { spaceId: artifactId, cachedTitle: name },
      }),
    );
  };

  // Phase A.6 — reverse-direction "Show source" handlers. Spawn the
  // upstream room; the spawner's hydration helpers detect this space
  // room on the canvas and auto-draw arrows in both directions.
  const handleShowSourceStrategy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data?.from_strategy_id) return;
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-strategy", {
        detail: {
          strategyId: data.from_strategy_id,
          sessionId: data.from_brainstorm_session_id ?? undefined,
          statement: "",
        },
      }),
    );
  };
  const handleShowSourceBrainstorm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data?.from_brainstorm_session_id) return;
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-brainstorm", {
        detail: {
          sessionId: data.from_brainstorm_session_id,
          title: "",
        },
      }),
    );
  };
  const handleShowParentSpace = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Twin mode only — spawn the space that backs this twin (same
    // artifact_id).
    if (!artifactId) return;
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-space", {
        detail: { spaceId: artifactId, name },
      }),
    );
  };

  return (
    <div className="flex h-[calc(100%-44px)] flex-col px-5 pb-4 pt-2">
      <h3
        className={
          expanded
            ? "font-display-tight line-clamp-3 text-[18px] font-semibold leading-snug tracking-tight text-gray-900"
            : "font-display-tight line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-gray-900"
        }
      >
        {name}
      </h3>

      {/* Mode-specific second line. Twin mode shows readiness; space
          mode shows the maturity label so the user knows whether the
          pipeline is still inferring or settled. */}
      <p
        className={
          expanded
            ? "mt-2 text-[12px] leading-relaxed text-gray-500"
            : "mt-1 text-[11px] leading-snug text-gray-500"
        }
      >
        {mode === "twin" ? (
          twinReady ? (
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {TWIN_STATE_LABEL[twinState]}
            </span>
          ) : (
            <span className="text-gray-400">
              {TWIN_STATE_LABEL[twinState]} — needs synthesis
            </span>
          )
        ) : (
          <span>{MATURITY_LABEL[maturity]}</span>
        )}
      </p>

      {/* Coverage pills row */}
      {(entityCount > 0 || edgeCount > 0 || cycleCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entityCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {entityCount} {entityCount === 1 ? "entity" : "entities"}
            </span>
          )}
          {edgeCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {edgeCount} {edgeCount === 1 ? "edge" : "edges"}
            </span>
          )}
          {cycleCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {cycleCount} {cycleCount === 1 ? "cycle" : "cycles"}
            </span>
          )}
        </div>
      )}

      {/* Expanded extras: a second pill row + promotion CTA. Only
          shown in space mode (twin mode has no further downstream to
          promote to in this batch). */}
      {expanded && mode === "space" && data?.has_synthesis && !twinReady && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Synthesis is in progress — the twin will surface here once the
          knowledge graph stabilizes.
        </p>
      )}

      {/* Meta row + open + promotion */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
          {loading ? (
            <span className="text-gray-300">Loading…</span>
          ) : updated ? (
            <span>{relativeTime(updated)}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Phase A.6 — reverse "Show source" CTAs. Space mode shows
              the strategy that spawned it (if any). Twin mode shows
              the space it's a projection of. Brainstorm pointer is
              transitive — only worth surfacing when there's no strategy
              in between (otherwise the strategy room becomes the
              natural hop). */}
          {expanded && mode === "space" && data?.from_strategy_id && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleShowSourceStrategy}
              className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100"
              title="Spawn the strategy room this space was promoted from"
            >
              <FileText className="h-3 w-3" />
              Show source
            </button>
          )}
          {expanded &&
            mode === "space" &&
            !data?.from_strategy_id &&
            data?.from_brainstorm_session_id && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleShowSourceBrainstorm}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100"
                title="Spawn the brainstorm room this space was derived from"
              >
                <Sparkles className="h-3 w-3" />
                Show source
              </button>
            )}
          {expanded && mode === "twin" && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleShowParentSpace}
              className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
              title="Spawn the R&D space room this twin is a projection of"
            >
              <Network className="h-3 w-3" />
              Show source
            </button>
          )}
          {expanded && mode === "space" && twinReady && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleSpawnTwin}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
              title="Spawn a twin room beside this one"
            >
              <TestTube className="h-3 w-3" />
              Build twin
            </button>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleFullscreen}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-50 text-gray-600 ring-1 ring-black/[0.04] transition hover:bg-gray-100 hover:text-gray-900"
            title="Open fullscreen over the canvas"
            aria-label="Open fullscreen"
          >
            <Expand className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleOpen}
            className={
              expanded
                ? "inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-700"
                : "inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-gray-700"
            }
            title={mode === "twin" ? "Open twin detail page" : "Open R&D whiteboard"}
          >
            {expanded ? "Open in new tab" : "Open"}
            <ArrowUpRight
              className={expanded ? "h-3.5 w-3.5" : "h-3 w-3"}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── StubRoomBody ──
// Placeholder for kinds whose renderers aren't built yet. Shows the
// kind label + a "Coming soon" caption so the shape stays valid while
// the user adds the remaining renderers incrementally.

function StubRoomBody({
  kind,
  expanded,
}: {
  kind: WorkspaceRoomShape["props"]["kind"];
  expanded: boolean;
}) {
  return (
    <div className="flex h-[calc(100%-44px)] flex-col items-start justify-center px-5">
      <p
        className={
          expanded
            ? "font-display-tight text-[18px] font-semibold leading-snug tracking-tight text-gray-900"
            : "font-display-tight text-[15px] font-semibold leading-snug tracking-tight text-gray-900"
        }
      >
        {KIND_META[kind].label} room
      </p>
      <p
        className={
          expanded
            ? "mt-2 inline-flex items-center gap-1 text-[12px] text-gray-500"
            : "mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500"
        }
      >
        <Sparkles className={expanded ? "h-3.5 w-3.5" : "h-3 w-3"} />
        Coming soon — renderer not built yet
      </p>
    </div>
  );
}

// ── Helpers ──

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
