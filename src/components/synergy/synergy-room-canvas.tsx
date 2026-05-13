// ── Synergy Room Canvas — two-author co-edit whiteboard ──
//
// Simpler than SynergyWhiteboard:
//   - No voice, no AI augmentation (defer)
//   - Per-node CRUD (no replace-all save)
//   - Real-time sync via Supabase postgres_changes
//   - Each node visually tinted by author (mine = blue, theirs = emerald)
//   - The two matched components pin as "anchor" nodes at the top
//
// Tools: select / sticky (creates a branch) / connect-via-parent /
// delete (eraser). Pan/zoom mirrors the solo whiteboard.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArchiveX,
  ArrowLeft,
  Eraser,
  Loader2,
  Maximize2,
  MousePointer2,
  Sparkles,
  StickyNote,
  Target,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  archiveRoom,
  createRoomNode,
  deleteRoomNode,
  updateRoomNode,
  type RoomNode,
  type SynergyRoomBundle,
} from "@/lib/synergy/room-client";
import { useRoomRealtime } from "@/hooks/synergy/use-room-realtime";
import { useRoomPresence } from "@/hooks/synergy/use-room-presence";
import { AI_META_PREFIX, SynergyRoomAIDock } from "./synergy-room-ai-dock";

type Tool = "select" | "sticky" | "erase";

interface Props {
  bundle: SynergyRoomBundle;
}

export function SynergyRoomCanvas({ bundle }: Props) {
  const roomId = bundle.room.id;
  const myId = bundle.room.i_am === "a" ? bundle.room.user_a : bundle.room.user_b;
  const theirId = bundle.room.i_am === "a" ? bundle.room.user_b : bundle.room.user_a;

  const [nodes, setNodes] = useState<RoomNode[]>(bundle.nodes);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Inline-edit state: which node is the user currently text-editing?
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  // ── Intersection objective ──
  // Header banner. If the bundle came with one cached, use it
  // immediately. Otherwise lazy-infer on mount via a single POST
  // call. Idempotent; other room visits within the same row reuse
  // the cached value (the endpoint short-circuits).
  const [intersectionObjective, setIntersectionObjective] = useState<
    string | null
  >(bundle.room.intersection_objective);
  useEffect(() => {
    if (intersectionObjective) return;
    if (!bundle.my_component || !bundle.their_component) return;
    let cancelled = false;
    fetch(`/api/synergy/rooms/${roomId}/infer-objective`, { method: "POST" })
      .then((r) => r.json())
      .then((body: { intersection_objective?: string; error?: string }) => {
        if (cancelled) return;
        if (body.intersection_objective) {
          setIntersectionObjective(body.intersection_objective);
        }
      })
      .catch(() => {
        // Silent — banner just stays empty
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Presence ──
  // Set of OTHER user_ids currently in this room channel.
  // Single-other-user rooms in V1, so size is 0 or 1.
  const otherPresent = useRoomPresence(roomId, myId);
  const theyAreHere = otherPresent.has(theirId);

  // Pan + zoom (world-space; same pattern as solo whiteboard)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const spaceHeldRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const archived = !!bundle.room.archived_at;

  // ── Realtime sync ──
  // Local state is the source of truth in this client; realtime events
  // from OTHER users (i.e., theirId) merge in. Events we triggered
  // ourselves still arrive but are idempotent merges (same row state).
  useRoomRealtime(roomId, {
    onInsert: (node) => {
      setNodes((prev) =>
        prev.some((n) => n.id === node.id) ? prev : [...prev, node],
      );
    },
    onUpdate: (node) => {
      setNodes((prev) => prev.map((n) => (n.id === node.id ? node : n)));
    },
    onDelete: (nodeId) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      if (selectedId === nodeId) setSelectedId(null);
    },
  });

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom],
  );

  // Anchor nodes (the two matched components) render specially —
  // not from synergy_room_nodes, but composed from bundle.my_component
  // + bundle.their_component. They sit at fixed positions in the
  // world space top.
  const anchors = useMemo(() => {
    const out: Array<{
      id: string;
      x: number;
      y: number;
      label: string;
      description: string;
      kind: string;
      author: "mine" | "theirs";
    }> = [];
    if (bundle.my_component) {
      out.push({
        id: `anchor:mine`,
        x: 300,
        y: 100,
        label: bundle.my_component.label_public,
        description: bundle.my_component.description_public,
        kind: bundle.my_component.kind,
        author: "mine",
      });
    }
    if (bundle.their_component) {
      out.push({
        id: `anchor:theirs`,
        x: 900,
        y: 100,
        label: bundle.their_component.label_public,
        description: bundle.their_component.description_public,
        kind: bundle.their_component.kind,
        author: "theirs",
      });
    }
    return out;
  }, [bundle.my_component, bundle.their_component]);

  // ── Tool: sticky-create ──
  // Drops a local-only tmp: node with an empty label at the cursor and
  // enters inline-edit mode. The server insert is deferred until the
  // user actually commits text (see commitNodeLabel) — this prevents
  // empty placeholder rows from being persisted (and from flickering
  // into the co-editor's view via realtime).
  const addStickyAt = useCallback(
    (worldX: number, worldY: number) => {
      const tempId = `tmp:${crypto.randomUUID()}`;
      const optimistic: RoomNode = {
        id: tempId,
        room_id: roomId,
        author_id: myId,
        parent_id: null,
        kind: "branch",
        label: "",
        meta: null,
        x: worldX,
        y: worldY,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setNodes((prev) => [...prev, optimistic]);
      setSelectedId(tempId);
      setEditingNodeId(tempId);
    },
    [roomId, myId],
  );

  // ── Pointer events ──

  const onPointerDown = (e: React.PointerEvent) => {
    if (spaceHeldRef.current || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const onCanvasBackground =
      e.target === canvasRef.current ||
      (e.target as HTMLElement).tagName === "svg";
    if (onCanvasBackground) {
      setSelectedId(null);
    }
    // Sticky tool only spawns on empty canvas; clicking on an existing
    // card falls through so its own click/drag handlers run instead of
    // dropping a fresh draft on top of it.
    if (tool === "sticky" && onCanvasBackground) {
      const w = toWorld(e.clientX, e.clientY);
      addStickyAt(w.x, w.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isPanning && panStartRef.current) {
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.clientX),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.clientY),
      });
    }
  };

  const onPointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const nextZoom = Math.min(2.5, Math.max(0.25, zoom * factor));
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const worldX = (cx - pan.x) / zoom;
    const worldY = (cy - pan.y) / zoom;
    setPan({ x: cx - worldX * nextZoom, y: cy - worldY * nextZoom });
    setZoom(nextZoom);
  };

  // Space-as-pan modifier
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        spaceHeldRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ── Node interactions ──

  const onNodeClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (tool === "erase") {
      // Optimistic remove + server delete
      setNodes((prev) => prev.filter((n) => n.id !== id));
      deleteRoomNode(roomId, id).catch((err) => {
        toast.error("Delete failed", { description: (err as Error).message });
      });
      if (selectedId === id) setSelectedId(null);
      return;
    }
    // Toggle inline edit on second click of an already-selected node
    if (!archived && selectedId === id && !editingNodeId) {
      setEditingNodeId(id);
      return;
    }
    setSelectedId(id);
  };

  const commitNodeLabel = useCallback(
    async (nodeId: string, label: string) => {
      setEditingNodeId(null);
      const trimmed = label.trim();
      const target = nodes.find((n) => n.id === nodeId);
      if (!target) return;
      const isDraft = nodeId.startsWith("tmp:");
      // Empty commit on a fresh draft → drop the card entirely. Empty
      // commit on an existing node → ignore (don't clobber with empty).
      if (!trimmed) {
        if (isDraft) {
          setNodes((prev) => prev.filter((n) => n.id !== nodeId));
          if (selectedId === nodeId) setSelectedId(null);
        }
        return;
      }
      // Draft → first server insert. Swap the tmp id for the real row
      // returned by the API so subsequent edits hit the right row.
      if (isDraft) {
        setNodes((prev) =>
          prev.map((n) => (n.id === nodeId ? { ...n, label: trimmed } : n)),
        );
        try {
          const real = await createRoomNode(roomId, {
            kind: "branch",
            label: trimmed,
            x: target.x,
            y: target.y,
          });
          setNodes((prev) => prev.map((n) => (n.id === nodeId ? real : n)));
          setSelectedId((cur) => (cur === nodeId ? real.id : cur));
        } catch (e) {
          setNodes((prev) => prev.filter((n) => n.id !== nodeId));
          if (selectedId === nodeId) setSelectedId(null);
          toast.error("Couldn't add node", {
            description: (e as Error).message,
          });
        }
        return;
      }
      // Existing node — no-op if the label didn't change.
      if (trimmed === target.label) return;
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, label: trimmed } : n)),
      );
      try {
        await updateRoomNode(roomId, nodeId, { label: trimmed });
      } catch (e) {
        toast.error("Couldn't save edit", {
          description: (e as Error).message,
        });
      }
    },
    [nodes, roomId, selectedId],
  );

  // ── Cancel inline-edit ──
  // Drops fresh drafts (tmp:* with no committed label); existing nodes
  // just exit edit mode (their original label is intact).
  const cancelNodeEdit = useCallback(
    (nodeId: string) => {
      setEditingNodeId(null);
      if (nodeId.startsWith("tmp:")) {
        setNodes((prev) => prev.filter((n) => n.id !== nodeId));
        if (selectedId === nodeId) setSelectedId(null);
      }
    },
    [selectedId],
  );

  // ── Node-drag (window-level for delivery beyond the card) ──
  const dragRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    hasMoved: boolean;
  } | null>(null);

  const beginDrag = (e: React.PointerEvent, nodeId: string) => {
    if (archived) return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    dragRef.current = {
      nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: node.x,
      startY: node.y,
      hasMoved: false,
    };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startClientX) / zoom;
      const dy = (ev.clientY - d.startClientY) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.hasMoved = true;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === d.nodeId ? { ...n, x: d.startX + dx, y: d.startY + dy } : n,
        ),
      );
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d?.hasMoved) return;
      const final = nodes.find((n) => n.id === d.nodeId);
      const current = (typeof window !== "undefined" ? document : null) && final;
      // Re-read latest position from state via setNodes' callback
      // trick: use a fresh ref. Simpler: use the most recent state.
      // We'll just send the dx/dy-derived final from our optimistic state.
      try {
        // Read from state via setNodes "current view" hack
        setNodes((prev) => {
          const n = prev.find((x) => x.id === d.nodeId);
          if (n && !n.id.startsWith("tmp:")) {
            updateRoomNode(roomId, n.id, { x: n.x, y: n.y }).catch((err) =>
              toast.error("Move save failed", {
                description: (err as Error).message,
              }),
            );
          }
          return prev;
        });
      } catch {
        // No-op; toast inside handles failure
      }
      void current;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Toolbar actions ──

  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  const onArchive = async () => {
    if (!confirm("Archive this room? It becomes read-only.")) return;
    try {
      await archiveRoom(roomId, true);
      toast.success("Room archived");
      // Page reload via window.location to refresh archive banner
      window.location.reload();
    } catch (e) {
      toast.error("Archive failed", { description: (e as Error).message });
    }
  };

  // ── Edges (parent → child) ──
  const edges = nodes
    .filter((n) => n.parent_id)
    .map((n) => {
      const p = nodes.find((x) => x.id === n.parent_id);
      if (!p) return null;
      return { id: n.id, x1: p.x, y1: p.y, x2: n.x, y2: n.y };
    })
    .filter((e): e is { id: string; x1: number; y1: number; x2: number; y2: number } => e !== null);

  return (
    <div className="fixed inset-0 z-40 flex overflow-hidden bg-gray-50">
      {/* ── Left rail: tools + back ── */}
      <aside className="flex w-16 flex-col items-center justify-between border-r border-gray-200 bg-white/80 py-4 backdrop-blur">
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/app/synergy/requests"
            className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label="Back to inbox"
            title="Back to inbox"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <ToolBtn
            label="Select"
            active={tool === "select"}
            onClick={() => setTool("select")}
            icon={MousePointer2}
            disabled={archived}
          />
          <ToolBtn
            label="Sticky note"
            active={tool === "sticky"}
            onClick={() => setTool("sticky")}
            icon={StickyNote}
            disabled={archived}
          />
          <ToolBtn
            label="Erase"
            active={tool === "erase"}
            onClick={() => setTool("erase")}
            icon={Eraser}
            disabled={archived}
          />
          <div className="my-1 h-px w-6 bg-gray-200" />
          <button
            onClick={resetView}
            aria-label="Reset view"
            title="Reset pan & zoom"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={onArchive}
          disabled={archived}
          aria-label="Archive room"
          title="Archive (read-only)"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
        >
          <ArchiveX className="h-4 w-4" />
        </button>
      </aside>

      {/* ── Main canvas + header ── */}
      <main className="relative flex-1 overflow-hidden">
        {/* Header — co-editor identity + presence + intersection objective */}
        <div className="absolute inset-x-0 top-0 z-20 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-700">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div className="text-[12px] font-semibold text-gray-900">
                Shared synergy room
              </div>
              {bundle.their_profile && (
                <>
                  <span className="text-gray-300">·</span>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="relative inline-flex">
                      <UserCircle2 className="h-3.5 w-3.5 text-gray-500" />
                      {theyAreHere && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 inline-block h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"
                          style={{
                            animation: "synergyPresencePulse 2s ease-in-out infinite",
                          }}
                        />
                      )}
                    </span>
                    <span className="text-[12px] text-gray-700">
                      with{" "}
                      <span className="font-semibold text-gray-900">
                        {bundle.their_profile.display_name}
                      </span>
                    </span>
                    {theyAreHere && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-700">
                        here now
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {archived && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
                  <ArchiveX className="h-3 w-3" /> archived (read-only)
                </span>
              )}
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-700"
                title="Realtime sync active"
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                live
              </span>
            </div>
          </div>
          {/* Intersection objective banner */}
          {intersectionObjective && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50/60 to-cyan-50/40 px-3 py-1.5">
              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
              <p className="text-[12px] leading-snug text-gray-800">
                <span className="font-mono text-[9px] uppercase tracking-wider text-blue-700">
                  Together →{" "}
                </span>
                {intersectionObjective}
              </p>
            </div>
          )}
          <style jsx>{`
            @keyframes synergyPresencePulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.3); opacity: 0.7; }
            }
          `}</style>
        </div>

        <div
          ref={canvasRef}
          className="absolute inset-0 pt-12"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            cursor: isPanning
              ? "grabbing"
              : spaceHeldRef.current
                ? "grab"
                : tool === "select"
                  ? "default"
                  : tool === "erase"
                    ? "not-allowed"
                    : "crosshair",
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <svg
              className="pointer-events-none absolute"
              style={{ overflow: "visible", left: 0, top: 0 }}
              width={1}
              height={1}
            >
              {edges.map((e) => (
                <line
                  key={e.id}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="rgba(107, 114, 128, 0.3)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              ))}
            </svg>

            {/* ── Anchor components (mine + theirs) ── */}
            {anchors.map((a) => (
              <AnchorCard key={a.id} anchor={a} />
            ))}

            {/* ── Co-edit nodes ── */}
            {nodes.map((n) => (
              <RoomNodeCard
                key={n.id}
                node={n}
                selected={n.id === selectedId}
                editing={editingNodeId === n.id}
                isMine={n.author_id === myId}
                isTheirs={n.author_id === theirId}
                archived={archived}
                onClick={(e) => onNodeClick(e, n.id)}
                onDragStart={(e) => beginDrag(e, n.id)}
                onCommitEdit={(label) => commitNodeLabel(n.id, label)}
                onCancelEdit={() => cancelNodeEdit(n.id)}
              />
            ))}
          </div>
        </div>

        {/* AI dock — appears at the bottom; replaces the static help
            ribbon. Shows a selected-node header + 4 AI action chips
            when a node is selected; falls back to a "select to call
            the AI" hint when nothing is selected. */}
        <SynergyRoomAIDock
          roomId={roomId}
          selectedNode={
            selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null
          }
          myAnchor={
            bundle.my_component
              ? {
                  label: bundle.my_component.label_public,
                  description: bundle.my_component.description_public,
                }
              : null
          }
          theirAnchor={
            bundle.their_component
              ? {
                  label: bundle.their_component.label_public,
                  description: bundle.their_component.description_public,
                }
              : null
          }
          roomNodes={nodes}
          onNodeSpawned={(node) => {
            // Realtime will eventually deliver this same row to both
            // clients; we optimistically merge for instant feedback.
            setNodes((prev) =>
              prev.some((n) => n.id === node.id) ? prev : [...prev, node],
            );
          }}
          onClearSelection={() => setSelectedId(null)}
          disabled={archived}
        />
      </main>
    </div>
  );
}

// ── Toolbar button ──

function ToolBtn({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? "Room archived" : label}
      className={[
        "inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:opacity-40",
        active
          ? "bg-blue-600 text-white shadow"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ── Anchor cards ──

function AnchorCard({
  anchor,
}: {
  anchor: {
    id: string;
    x: number;
    y: number;
    label: string;
    description: string;
    kind: string;
    author: "mine" | "theirs";
  };
}) {
  const tone =
    anchor.author === "mine"
      ? "border-blue-200 bg-blue-50/80 ring-blue-300 text-blue-900"
      : "border-emerald-200 bg-emerald-50/80 ring-emerald-300 text-emerald-900";
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
      style={{ left: anchor.x, top: anchor.y }}
    >
      <div
        className={`rounded-2xl border ring-2 ${tone} px-4 py-3 shadow-md backdrop-blur`}
        style={{ minWidth: 240, maxWidth: 320 }}
      >
        <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.15em] opacity-70">
          <span>{anchor.author === "mine" ? "YOU" : "THEM"}</span>
          <span className="rounded-full bg-white/70 px-1.5 py-0.5">
            {anchor.kind}
          </span>
        </div>
        <div className="text-[14px] font-semibold leading-snug">
          {anchor.label}
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed opacity-80">
          {anchor.description}
        </p>
      </div>
    </div>
  );
}

// ── Co-edit node card ──

function RoomNodeCard({
  node,
  selected,
  editing,
  isMine,
  isTheirs,
  archived,
  onClick,
  onDragStart,
  onCommitEdit,
  onCancelEdit,
}: {
  node: RoomNode;
  selected: boolean;
  editing: boolean;
  isMine: boolean;
  isTheirs: boolean;
  archived: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onCommitEdit: (label: string) => void;
  onCancelEdit: () => void;
}) {
  // AI-generated nodes carry the AI_META_PREFIX in meta. We strip it
  // for display + show a ✨ chip + soften the tint so AI-suggested
  // cards visually distinguish from human contributions while still
  // attributing the triggering user.
  const isAiGenerated =
    typeof node.meta === "string" && node.meta.startsWith(AI_META_PREFIX);
  const aiHint = isAiGenerated
    ? node.meta!.slice(AI_META_PREFIX.length).trim()
    : null;
  const tone = isAiGenerated
    ? // AI cards lean amber-violet — distinct from both author tints
      "bg-gradient-to-br from-purple-50 to-amber-50 ring-purple-200 text-gray-900"
    : isMine
      ? "bg-blue-50 ring-blue-200 text-blue-900"
      : isTheirs
        ? "bg-emerald-50 ring-emerald-200 text-emerald-900"
        : "bg-white ring-gray-200 text-gray-900";
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: node.x, top: node.y }}
    >
      <div
        onClick={onClick}
        // Dragging starts on the wrapper, but if we're editing,
        // don't initiate drag — the user is typing inside.
        onPointerDown={editing ? undefined : onDragStart}
        className={[
          "select-none rounded-2xl px-3 py-2 text-xs shadow-sm ring-1 transition",
          editing
            ? "cursor-text ring-2 ring-blue-500 shadow-md"
            : "cursor-grab active:cursor-grabbing hover:scale-[1.02]",
          tone,
          selected && !editing && "ring-2 ring-blue-500 shadow-md",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ minWidth: 160, maxWidth: 260 }}
        title={aiHint ? `AI suggestion · ${aiHint}` : undefined}
      >
        <div className="mb-0.5 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider opacity-60">
          <span className="flex items-center gap-1">
            {isAiGenerated && (
              <span className="text-purple-600" title="AI-suggested" aria-label="AI-suggested">
                ✨
              </span>
            )}
            {node.kind}
          </span>
          {isAiGenerated ? (
            <span className="rounded-full bg-purple-500/15 px-1 text-[8px] text-purple-700">
              {isMine ? "you · AI" : isTheirs ? "them · AI" : "AI"}
            </span>
          ) : (
            <>
              {isMine && (
                <span className="rounded-full bg-blue-500/15 px-1 text-[8px] text-blue-700">
                  you
                </span>
              )}
              {isTheirs && (
                <span className="rounded-full bg-emerald-500/15 px-1 text-[8px] text-emerald-700">
                  them
                </span>
              )}
            </>
          )}
        </div>
        {editing ? (
          <InlineEditField
            initial={node.label}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <div
            className="font-medium leading-snug whitespace-pre-wrap break-words"
            title={!archived ? "Click to select; click again to edit" : undefined}
          >
            {node.label}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline edit field ──
// Autofocuses, autosizes vertically, commits on blur or Cmd+Enter,
// cancels on Escape. Stops pointer-down propagation so dragging the
// underlying card while editing doesn't fire.

function InlineEditField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        }
      }}
      rows={1}
      className="w-full resize-none rounded border border-blue-300 bg-white px-1.5 py-1 text-[12px] font-medium leading-snug text-gray-900 outline-none ring-2 ring-blue-100"
    />
  );
}

// Suppress unused-X import warnings — `X` is reserved for future
// inline-edit affordances.
void X;
