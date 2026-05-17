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
} from "tldraw";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  Layers,
  MessageCircleQuestion,
  Sparkles,
  TestTube,
} from "lucide-react";
import type { WorkspaceRoomShape } from "./types";

export const WORKSPACE_ROOM_DEFAULT_W = 360;
export const WORKSPACE_ROOM_DEFAULT_H = 220;
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
};

export class WorkspaceRoomShapeUtil extends BaseBoxShapeUtil<WorkspaceRoomShape> {
  static override type = "workspace-room" as const;
  static override props: RecordProps<WorkspaceRoomShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum("brainstorm", "strategy", "twin", "probe"),
    artifact_id: T.string,
    cached_title: T.string,
    spawnedAt: T.number,
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
  const { w, h, kind, artifact_id, cached_title, spawnedAt } = shape.props;
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

  // Phase A wires only the brainstorm renderer. Other kinds render a
  // stub so the shape stays valid + visible while we build the
  // remaining renderers.
  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
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

        {/* Kind label row: glyph + caps label */}
        <div className="flex items-center gap-2 px-5 pt-5">
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

        {/* Per-kind body — phase A only brainstorm is wired */}
        {kind === "brainstorm" ? (
          <BrainstormRoomBody
            artifactId={artifact_id}
            cachedTitle={cached_title}
          />
        ) : (
          <StubRoomBody kind={kind} />
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
}: {
  artifactId: string;
  cachedTitle: string;
}) {
  const [data, setData] = useState<BrainstormSummary | null>(null);
  const [loading, setLoading] = useState(true);

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

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === "undefined" || !artifactId) return;
    // Open in a new tab — keeps the workspace canvas accessible.
    window.open(`/app/synergy/${artifactId}`, "_blank");
  };

  return (
    <div className="flex h-[calc(100%-44px)] flex-col px-5 pb-4 pt-2">
      <h3 className="font-display-tight line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">
        {title}
      </h3>

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

        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleOpen}
          className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-gray-700"
          title="Open this brainstorm in a new tab"
        >
          Open
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
        </button>
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
}: {
  kind: WorkspaceRoomShape["props"]["kind"];
}) {
  return (
    <div className="flex h-[calc(100%-44px)] flex-col items-start justify-center px-5">
      <p className="font-display-tight text-[15px] font-semibold leading-snug tracking-tight text-gray-900">
        {KIND_META[kind].label} room
      </p>
      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500">
        <Sparkles className="h-3 w-3" />
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
