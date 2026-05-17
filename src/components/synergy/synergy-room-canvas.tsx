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
  Mic,
  MousePointer2,
  Sparkles,
  StickyNote,
  Target,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  archiveRoom,
  createRoomNode,
  deleteRoomNode,
  updateRoomNode,
  type RoomNode,
  type RoomNodeKind,
  type SynergyRoomBundle,
} from "@/lib/synergy/room-client";
import { augment } from "@/lib/synergy/client";
import { useRoomRealtime } from "@/hooks/synergy/use-room-realtime";
import { useRoomPresence } from "@/hooks/synergy/use-room-presence";
import { useRoomEvents } from "@/hooks/synergy/use-room-events";
import { useRoomMessages } from "@/hooks/synergy/use-room-messages";
import { useSpeech } from "@/hooks/synergy/use-speech";
import { RoomCursorsLayer } from "./room-cursors-layer";
import { RoomPresenceStack } from "./room-presence-stack";
import { RoomRightRail } from "./room-right-rail";
import { abstractAvatarStyle } from "@/lib/synergy/abstract-avatar";
import { AI_META_PREFIX, SynergyRoomAIDock } from "./synergy-room-ai-dock";
import {
  SynergyRoomVoiceDock,
  VOICE_META_PREFIX,
} from "./synergy-room-voice-dock";

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

  // ── Presence + live cursors ──
  // The hook multiplexes:
  //   - presence (who's joined) → onlineUserIds
  //   - broadcast (live world-coord cursor positions) → cursors map
  //   - broadcastCursor(worldX, worldY) → throttled send (call on move)
  //
  // Single-other-user rooms in V1, so the sets are size 0 or 1.
  const { onlineUserIds, cursors, broadcastCursor } = useRoomPresence(
    roomId,
    myId,
  );
  const theyAreHere = onlineUserIds.has(theirId);
  // Derive a "cursor has ticked recently" set so the header avatar
  // ring goes hued (active) vs slate (present but idle). 5s threshold
  // matches a comfortable "they're working right now" read.
  const activeUserIds = useMemo(() => {
    const now = Date.now();
    const out = new Set<string>();
    for (const [uid, c] of cursors) {
      if (now - c.updatedAt < 5_000) out.add(uid);
    }
    return out;
  }, [cursors]);
  // Labels keyed by user_id — passed to the cursor layer for the pill
  // text. In v1 the only remote member is `theirId`, whose profile is
  // already revealed (this is an accepted-match room).
  const userLabels = useMemo(
    () => ({
      [theirId]: bundle.their_profile?.display_name ?? null,
    }),
    [theirId, bundle.their_profile?.display_name],
  );

  // ── Right rail state (Timeline + Chat) ──
  // Both feeds load lazily on mount and live-update via Realtime.
  // The shell handles tab switching + unseen tracking.
  const { events: timelineEvents, loading: timelineLoading } =
    useRoomEvents(roomId);
  const {
    messages: chatMessages,
    loading: chatLoading,
    sendMessage,
  } = useRoomMessages(roomId);
  const [rightRailOpen, setRightRailOpen] = useState(false);

  // Pan + zoom (world-space; same pattern as solo whiteboard)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  // ── Voice (Tier-2 2.1) ──
  // Free-flow toggle: when on, each speech-final phrase becomes a
  // new node AND fires augment(decompose) to spawn AI children.
  // Off, just the new node is added.
  const [voiceFreeFlow, setVoiceFreeFlow] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
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
  const addStickyAt = useCallback(
    async (worldX: number, worldY: number) => {
      const label = window.prompt("Note text:") ?? "";
      if (!label.trim()) return;
      // Optimistic local add
      const tempId = `tmp:${crypto.randomUUID()}`;
      const optimistic: RoomNode = {
        id: tempId,
        room_id: roomId,
        author_id: myId,
        parent_id: null,
        kind: "branch",
        label: label.trim(),
        meta: null,
        x: worldX,
        y: worldY,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setNodes((prev) => [...prev, optimistic]);
      try {
        const real = await createRoomNode(roomId, {
          kind: "branch",
          label: label.trim(),
          x: worldX,
          y: worldY,
        });
        setNodes((prev) =>
          prev.map((n) => (n.id === tempId ? real : n)),
        );
      } catch (e) {
        setNodes((prev) => prev.filter((n) => n.id !== tempId));
        toast.error("Couldn't add node", { description: (e as Error).message });
      }
    },
    [roomId, myId],
  );

  // ── Voice → room node (Tier-2 2.1) ──
  // Spawn a node at viewport center for each final phrase. With
  // free-flow on, also augment(decompose) and spiral-spawn 4 AI
  // children around the voice node. Realtime propagates each insert
  // to the partner automatically.
  const viewportCenterWorld = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 600, y: 400 };
    return {
      x: (rect.width / 2 - pan.x) / zoom,
      y: (rect.height / 2 - pan.y) / zoom,
    };
  }, [pan.x, pan.y, zoom]);

  const placeSpiralAround = useCallback(
    (cx: number, cy: number, i: number, total: number) => {
      const radius = 170;
      const angle = (i / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      const jitter = () => (Math.random() - 0.5) * 18;
      return {
        x: cx + Math.cos(angle) * radius + jitter(),
        y: cy + Math.sin(angle) * radius + jitter(),
      };
    },
    [],
  );

  const onVoiceFinal = useCallback(
    async (text: string) => {
      if (archived) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const c = viewportCenterWorld();
      // Spiral so back-to-back phrases don't stack at the same point.
      const offsetIdx = Math.floor(Math.random() * 6);
      const spot = placeSpiralAround(c.x, c.y, offsetIdx, 6);
      setVoiceBusy(true);
      let voiceNode: RoomNode | null = null;
      try {
        voiceNode = await createRoomNode(roomId, {
          kind: "branch",
          label: trimmed,
          meta: VOICE_META_PREFIX,
          x: spot.x,
          y: spot.y,
        });
        setNodes((prev) =>
          prev.some((n) => n.id === voiceNode!.id) ? prev : [...prev, voiceNode!],
        );
      } catch (err) {
        toast.error("Couldn't add voice note", {
          description: (err as Error).message,
        });
        setVoiceBusy(false);
        return;
      }

      // ── R4: shared voice transcript stream ──
      // Mirror the spoken phrase to the chat thread so the partner
      // sees what you said as a voice transcript bubble in real time
      // (the canvas-side mic dock would otherwise be silent on their
      // end except for a new node appearing). Fire-and-forget; the
      // node landed already — we don't want a chat failure to roll
      // back the canvas write. Meta carries the node id so a future
      // version can wire "click bubble → focus node" navigation.
      void sendMessage(trimmed, {
        kind: "voice_transcript",
        meta: { node_id: voiceNode.id },
      });

      if (!voiceFreeFlow || !voiceNode) {
        setVoiceBusy(false);
        return;
      }

      // Free-flow path: ask the augmenter to decompose this phrase
      // and spawn 4 children. We pass a tiny context block so the LLM
      // knows the anchors.
      try {
        const ctx: string[] = [];
        if (bundle.my_component) {
          ctx.push(
            `MY ANCHOR: ${bundle.my_component.label_public} — ${bundle.my_component.description_public}`,
          );
        }
        if (bundle.their_component) {
          ctx.push(
            `THEIR ANCHOR: ${bundle.their_component.label_public} — ${bundle.their_component.description_public}`,
          );
        }
        const res = await augment({
          transcript: trimmed,
          mode: "decompose",
          context: ctx.join("\n"),
        });
        if (res.mode !== "decompose") {
          return;
        }
        const d = res.result;
        const children: Array<{
          label: string;
          kind: RoomNodeKind;
          metaInner: string;
        }> = [
          ...d.upstream.map((t) => ({
            label: t,
            kind: "branch" as RoomNodeKind,
            metaInner: "upstream",
          })),
          ...d.downstream.map((t) => ({
            label: t,
            kind: "branch" as RoomNodeKind,
            metaInner: "downstream",
          })),
        ];
        // Cap at 4 so a chatty free-flow doesn't crowd the board.
        const top = children.slice(0, 4);
        for (let i = 0; i < top.length; i++) {
          const item = top[i];
          const pos = placeSpiralAround(spot.x, spot.y, i, top.length);
          try {
            const child = await createRoomNode(roomId, {
              parent_id: voiceNode.id,
              kind: item.kind,
              label: item.label,
              meta: `${AI_META_PREFIX} ${item.metaInner}`,
              x: pos.x,
              y: pos.y,
            });
            setNodes((prev) =>
              prev.some((n) => n.id === child.id) ? prev : [...prev, child],
            );
          } catch {
            // Per-child failure is non-fatal; the voice node is the
            // load-bearing artifact.
          }
        }
      } catch (err) {
        toast.error("Augment failed", {
          description: (err as Error).message,
        });
      } finally {
        setVoiceBusy(false);
      }
    },
    [
      archived,
      bundle.my_component,
      bundle.their_component,
      placeSpiralAround,
      roomId,
      sendMessage,
      viewportCenterWorld,
      voiceFreeFlow,
    ],
  );

  const speech = useSpeech(onVoiceFinal);

  const toggleMic = useCallback(() => {
    if (speech.listening) speech.stop();
    else speech.start();
  }, [speech]);

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
    if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === "svg") {
      setSelectedId(null);
    }
    if (tool === "sticky") {
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
    // Broadcast my cursor (world coords) to remote viewers. The hook
    // throttles internally at 30Hz so this is safe to fire on every
    // pointer event. Skip while archived to save channel traffic on
    // read-only rooms.
    if (!archived) {
      const w = toWorld(e.clientX, e.clientY);
      broadcastCursor(w.x, w.y);
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
      if (!target || trimmed === target.label) return;
      // Optimistic local update
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
    [nodes, roomId],
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
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div className="text-[12px] font-semibold text-gray-900">
                Shared synergy room
              </div>
              {bundle.their_profile && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-[12px] text-gray-700">
                    with{" "}
                    <Link
                      href={`/app/synergy/profile/${theirId}`}
                      className="font-semibold text-gray-900 underline-offset-2 hover:text-blue-700 hover:underline"
                      title="View profile"
                    >
                      {bundle.their_profile.display_name}
                    </Link>
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Avatar stack — one circular avatar per room member.
                  Ring intensity carries the live-presence signal:
                    active (cursor moved <5s ago) → hued ring
                    present (in channel, idle)    → slate ring
                    offline                       → faint slate ring */}
              <RoomPresenceStack
                members={
                  bundle.their_profile
                    ? [
                        {
                          userId: theirId,
                          displayName: bundle.their_profile.display_name,
                          avatarUrl: bundle.their_profile.avatar_url,
                        },
                      ]
                    : []
                }
                presentUserIds={onlineUserIds}
                activeUserIds={activeUserIds}
              />
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
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-1.5">
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
                onCancelEdit={() => setEditingNodeId(null)}
              />
            ))}
          </div>

          {/* ── Remote cursors overlay ──
              Sibling of the pan/zoom wrapper, so cursor pills stay at a
              constant viewport size regardless of zoom. The layer reads
              world coords from the presence channel and maps them to
              viewport pixels using the same pan/zoom transform. */}
          <RoomCursorsLayer
            cursors={cursors}
            pan={pan}
            zoom={zoom}
            userLabels={userLabels}
          />
        </div>

        {/* ── Right rail ──
            One unified panel with Timeline + Chat tabs. Collapsed
            by default; the pill at top-right surfaces unseen counts
            so the user can tell at a glance that something new
            arrived even when focused on the canvas. */}
        <RoomRightRail
          myUserId={myId}
          theirDisplayName={bundle.their_profile?.display_name ?? null}
          archived={archived}
          open={rightRailOpen}
          onToggle={() => setRightRailOpen((v) => !v)}
          events={timelineEvents}
          eventsLoading={timelineLoading}
          messages={chatMessages}
          messagesLoading={chatLoading}
          onSendMessage={sendMessage}
        />

        {/* Voice dock — bottom-LEFT mic + free-flow toggle. Each
            speech-final spawns a node at viewport center; free-flow
            additionally decomposes that node into 4 AI children. */}
        <SynergyRoomVoiceDock
          listening={speech.listening}
          supported={speech.supported}
          freeFlow={voiceFreeFlow}
          interim={speech.interim}
          busy={voiceBusy}
          disabled={archived}
          onToggleMic={toggleMic}
          onFreeFlowChange={setVoiceFreeFlow}
        />

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
  // Voice-captured nodes carry VOICE_META_PREFIX. Keep the author
  // tint (it's human content), but stamp a 🎙 chip in the header.
  const isVoice =
    typeof node.meta === "string" && node.meta.startsWith(VOICE_META_PREFIX);
  const tone = isAiGenerated
    ? // AI cards: neutral soft surface, distinct from both author tints
      "bg-gray-50 ring-gray-200 text-gray-900"
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
            {isVoice && !isAiGenerated && (
              <Mic
                className="h-2.5 w-2.5 text-rose-600"
                aria-label="Voice-captured"
              />
            )}
            {node.kind}
          </span>
          {/* Author stamp — small abstract avatar whose hashed gradient
              matches this user's cursor color + header avatar, so a
              glance ties "this card belongs to that person." Tooltip
              carries the semantic label ("you" / their display name).
              AI-generated cards keep the dedicated purple chip since
              they have no human actor. */}
          {isAiGenerated ? (
            <span
              className="rounded-full bg-purple-500/15 px-1 text-[8px] text-purple-700"
              title={
                isMine
                  ? "AI suggestion — triggered by you"
                  : isTheirs
                    ? "AI suggestion — triggered by them"
                    : "AI suggestion"
              }
            >
              AI
            </span>
          ) : (
            <span
              style={{
                ...abstractAvatarStyle(node.author_id, 14),
                fontSize: 7,
              }}
              title={isMine ? "You" : isTheirs ? "Them" : "Member"}
              aria-label={isMine ? "Your card" : "Their card"}
            />
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
