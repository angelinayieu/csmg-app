// ── Synergy whiteboard (Phase 1, solo) ──
//
// Voice-augmented brainstorm canvas at /app/synergy/[id]. Ported from
// idea-synthesizer's Whiteboard.tsx with these changes:
//   - Auth via Supabase cookie (no anonymous owner-token shenanigans)
//   - LLM calls go through /api/synergy/* (we don't ship server functions)
//   - Light-theme aesthetic matching our existing InteraxisCanvas
//   - Strokes persist to brainstorm_strokes (idea-synth keeps them in-memory)
//
// State is intentionally local — no realtime, no SSE. Save loop is a
// 750ms debounce after the last mutation; PUT replaces the whole node
// (or stroke) list. RLS gates ownership server-side.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Cloud,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  augment,
  loadSession,
  rowToClientNode,
  saveNodes,
  saveStrokes,
} from "@/lib/synergy/client";
import { placeNear, radialTreeLayout } from "@/lib/synergy/radial-layout";
import {
  collectDescendantIds,
  computeFitToContent,
  computeSubtreeBbox,
  structuredGridLayout,
  subtreeRadialLayout,
} from "@/lib/synergy/layout-helpers";
import { repelOnInsert, withRepel } from "@/lib/synergy/repel";
import { normalizeKey, uid } from "@/lib/synergy/normalize";
import type {
  ClientLateralEdge,
  ClientNode,
  ClientStroke,
  DecomposeResult,
  HistoryBucket,
  HistoryItem,
  NodeKind,
  RankedItem,
  ResearchDirection,
  VariationItem,
} from "@/lib/synergy/types";
import { SynergyToolbar, type SynergyTool } from "./synergy-toolbar";
import { SynergyVoiceDock } from "./synergy-voice-dock";
import { SynergyAIRail } from "./synergy-ai-rail";
import { SynergyNode } from "./synergy-node";
import { SynergyActionableModal } from "./synergy-actionable-modal";
import { FocusModeOverlay } from "./focus-mode/focus-mode-overlay";
import { useFocusMode } from "./focus-mode/use-focus-mode";
import { useSpeech } from "@/hooks/synergy/use-speech";
import type { AutopilotNewNode } from "@/hooks/synergy/use-autopilot";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Transcript {
  id: string;
  text: string;
  at: number;
}

// ── Edge color by child kind ──
// Each edge takes its color from the CHILD it points to, so every
// subtree's connectors visually tag what they're producing (purple
// for insights, emerald for actions, etc.). Helps the eye trace
// "which thread is which" on a busy board.
const EDGE_COLOR_BY_KIND: Record<NodeKind, string> = {
  core: "rgba(59, 130, 246, 0.40)", // blue
  branch: "rgba(107, 114, 128, 0.30)", // gray (neutral; branches are catch-all)
  insight: "rgba(168, 85, 247, 0.40)", // purple
  question: "rgba(245, 158, 11, 0.40)", // amber
  action: "rgba(16, 185, 129, 0.40)", // emerald
  user: "rgba(107, 114, 128, 0.15)", // pale gray (legacy, hidden anyway)
  variation: "rgba(217, 70, 239, 0.40)", // fuchsia
  ranking: "rgba(249, 115, 22, 0.40)", // orange
  plan: "rgba(14, 165, 233, 0.50)", // sky — slightly stronger; plans are anchors
  synergy: "rgba(245, 158, 11, 0.55)", // amber — matches lateral-edge color so the lineage reads visually
};

// Folder region tint by category label. The Decompose action spawns
// four named categories — give each a faint background hue matching
// the kind of items it contains, so the four folders are visually
// distinguishable when they cluster around the same parent.
function folderTintForLabel(label: string): { fill: string; stroke: string } {
  if (label.startsWith("Upstream")) {
    return { fill: "rgba(59, 130, 246, 0.05)", stroke: "rgba(59, 130, 246, 0.25)" };
  }
  if (label.startsWith("Downstream")) {
    return { fill: "rgba(16, 185, 129, 0.05)", stroke: "rgba(16, 185, 129, 0.25)" };
  }
  if (label.startsWith("First principles")) {
    return { fill: "rgba(168, 85, 247, 0.05)", stroke: "rgba(168, 85, 247, 0.25)" };
  }
  if (label.startsWith("Variations")) {
    return { fill: "rgba(217, 70, 239, 0.05)", stroke: "rgba(217, 70, 239, 0.25)" };
  }
  // Unknown / future folder label — neutral gray tint.
  return { fill: "rgba(107, 114, 128, 0.05)", stroke: "rgba(107, 114, 128, 0.20)" };
}

interface Props {
  sessionId: string;
  focusNodeId?: string;
  // Set when the user arrived from the dashboard voice orb — auto-
  // starts the mic on mount so the conversation continues seamlessly.
  autoStartVoice?: boolean;
  // Set when the user arrived from the brainstorm_speed homepage
  // pill. The whiteboard auto-fires the multi-wave autopilot
  // sequencer (variations → decompose → ... → converge) once the
  // seed node mounts, producing the cinematic speedrun crash. See
  // Wave 1.3 wiring below.
  autoStartAutopilot?: boolean;
}

export function SynergyWhiteboard({
  sessionId,
  focusNodeId,
  autoStartVoice = false,
  autoStartAutopilot = false,
}: Props) {
  const [tool, setTool] = useState<SynergyTool>("select");
  const [autoMode, setAutoMode] = useState(true);
  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [strokes, setStrokes] = useState<ClientStroke[]>([]);
  // Sprint synergy-3 — lateral edges. In-memory only (V1); page reload
  // currently loses them. Persistence schema lands once the UX is
  // validated. connectFromId tracks the first card the user clicked
  // while the Connect tool is active.
  const [lateralEdges, setLateralEdges] = useState<ClientLateralEdge[]>([]);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  // ── Focus Mode (Phase 3.5b) ──
  // The immersive convergence overlay. Hook owns the phase machine
  // and override state; rendering happens via <FocusModeOverlay/>
  // below, gated on focus.phase !== "closed".
  // hoveredNodeId is bidirectional — both the pane (Stage 1 row
  // hovers) and the canvas (node hovers in focus mode) write to it,
  // and both surfaces read it to highlight the corresponding peer.
  // We attach a window-level pointermove handler in focus mode below
  // for canvas-side hover propagation.
  const [questions, setQuestions] = useState<string[]>([]);
  const [research, setResearch] = useState<ResearchDirection[]>([]);
  const [decomp, setDecomp] = useState<DecomposeResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [precision, setPrecision] = useState(3);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Drives the "Make actionable" modal. Set when the user clicks the
  // hover-menu button; cleared on close or after the plan is accepted.
  // Hoisted up here so the global Esc-keybind in the keydown useEffect
  // (defined below) can reference it without use-before-declare lint.
  const [actionableTargetId, setActionableTargetId] = useState<string | null>(
    null,
  );

  // Pan + zoom. World coordinates are what's stored on each node and
  // each stroke; pointer events convert via toWorld() before being
  // appended to state.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const spaceHeldRef = useRef(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<ClientStroke | null>(null);

  // Node-drag bookkeeping. Window-level pointermove/up listeners attach
  // on drag start (handleNodeDragStart) so the drag survives the cursor
  // leaving the card. `hasMoved` lets onNodeClick distinguish a click
  // from a drag-end so a small wiggle doesn't change the selection.
  const nodeDragRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startNodeX: number;
    startNodeY: number;
    hasMoved: boolean;
  } | null>(null);
  // Mirror of `zoom` for the window listener closure, which captures
  // the value at subscribe time.
  const zoomRef = useRef(1);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const pickedKeys = useMemo(
    () => new Set(history.filter((h) => h.picked).map((h) => normalizeKey(h.bucket, h.text))),
    [history],
  );
  const isPicked = useCallback(
    (bucket: HistoryBucket, text: string) => pickedKeys.has(normalizeKey(bucket, text)),
    [pickedKeys],
  );

  const addToHistory = useCallback(
    (items: Array<Omit<HistoryItem, "id" | "picked" | "generatedAt">>) => {
      if (!items.length) return;
      setHistory((prev) => {
        const seen = new Set(prev.map((h) => normalizeKey(h.bucket, h.text)));
        const fresh: HistoryItem[] = [];
        for (const it of items) {
          const key = normalizeKey(it.bucket, it.text);
          if (seen.has(key)) continue;
          seen.add(key);
          fresh.push({ id: uid(), picked: false, generatedAt: Date.now(), ...it });
        }
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    },
    [],
  );

  const markPicked = useCallback((bucket: HistoryBucket, text: string) => {
    const key = normalizeKey(bucket, text);
    setHistory((prev) =>
      prev.map((h) => (normalizeKey(h.bucket, h.text) === key ? { ...h, picked: true } : h)),
    );
  }, []);

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

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    loadSession(sessionId)
      .then((res) => {
        if (cancelled) return;
        setNodes(res.nodes.map(rowToClientNode));
        setStrokes(
          res.strokes.map((s) => ({
            id: s.id,
            points: s.points,
            color: s.color,
          })),
        );
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error("Couldn't load session", { description: (e as Error).message });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!loaded || !focusNodeId) return;
    setSelectedId(focusNodeId);
  }, [loaded, focusNodeId]);

  // Wave 0/1 — brainstorm-speedrun autostart. When the URL arrived
  // with ?autopilot=1 (set by the homepage redirect chain for the
  // brainstorm_speed experience mode), dispatch the speedrun event
  // once the seed node has loaded AND at least one persisted node
  // exists. The autopilot panel (which is mounted inside the AI rail)
  // listens for this event and fires the multi-wave sequence.
  // useRef gate prevents duplicate fires on hot-reload / re-render.
  const autopilotStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartAutopilot) return;
    if (!loaded) return;
    if (autopilotStartedRef.current) return;
    if (nodes.length === 0) return;
    autopilotStartedRef.current = true;
    // Brief defer so the canvas finishes its first paint + the
    // autopilot panel has subscribed to the event listener.
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("autopilot:start-speedrun"));
    }, 400);
    return () => window.clearTimeout(t);
  }, [autoStartAutopilot, loaded, nodes.length]);

  // Auto-save: 750ms debounce after the most recent node/stroke mutation.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus("saving");
      Promise.all([saveNodes(sessionId, nodes), saveStrokes(sessionId, strokes)])
        .then(() => {
          setSaveStatus("saved");
          if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
          savedFlashTimer.current = setTimeout(() => setSaveStatus("idle"), 1400);
        })
        .catch((e) => {
          setSaveStatus("error");
          toast.error("Save failed", { description: (e as Error).message });
        });
    }, 750);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, strokes, loaded, sessionId]);

  const addNodeFromPanel = useCallback(
    (label: string, kind: NodeKind, parentId?: string) => {
      setNodes((prev) => {
        const parent =
          (parentId ? prev.find((n) => n.id === parentId) : undefined) ??
          prev.find((n) => n.kind === "core") ??
          prev[0];
        if (!parent) {
          // Empty board — drop a core seed first, then this node as a branch.
          const seed: ClientNode = {
            id: uid(),
            x: 600,
            y: 360,
            label: "Your idea",
            kind: "core",
          };
          const next: ClientNode = {
            id: uid(),
            x: 600 + 200,
            y: 360,
            label,
            kind,
            parent: seed.id,
          };
          // Empty-board case: nothing to repel against. Keep selection
          // null so the next panel-pick falls back to the core seed,
          // making subsequent items siblings (not a chain).
          return [seed, next];
        }
        const siblings = prev.filter((n) => n.parent === parent.id).length;
        const pos = placeNear(parent, siblings, Math.max(siblings + 1, 4), 180);
        const newNode: ClientNode = {
          id: uid(),
          x: pos.x + (Math.random() - 0.5) * 40,
          y: pos.y + (Math.random() - 0.5) * 40,
          label,
          kind,
          parent: parent.id,
        };
        // Chain-bug fix: do NOT call setSelectedId here. Auto-selecting
        // the new node made every subsequent panel-pick chain off the
        // previous addition, producing a vertical sequence that looked
        // like a temporal/dependency order. By leaving the user's
        // current selection in place, multiple picks correctly attach
        // as siblings of the same parent.
        //
        // Insert-time repulsion: push any existing nodes that overlap
        // or crowd the new node outward in one physics pass.
        // Pure helper; the new node + core are anchored.
        return repelOnInsert({
          nodes: [...prev, newNode],
          newIds: [newNode.id],
        });
      });
      setTool("select");
      toast.info(`Added "${label.slice(0, 40)}"`);
    },
    [],
  );

  const handleAIAugment = useCallback(
    async (transcript: string) => {
      if (!autoMode || !transcript.trim()) return;
      setAiBusy("augment");
      const cleanTranscript = transcript.trim();
      const recordedAt = Date.now();
      setTranscripts((prev) =>
        [...prev, { id: uid(), text: cleanTranscript, at: recordedAt }].slice(-30),
      );
      try {
        const ctx = nodes
          .filter((n) => n.kind !== "user")
          .map((n) => `${n.kind}: ${n.label}`)
          .join("\n");
        const res = await augment({ transcript, mode: "augment", context: ctx, precision });
        if (res.mode !== "augment") return;
        const newNodes = res.result.nodes ?? [];
        if (newNodes.length === 0) {
          toast.info(res.result.summary || "Already on the board — nothing new to add.");
          return;
        }
        setNodes((prev) => {
          const seed = prev.find((n) => n.kind === "core") || prev[0];

          // ── Spawn a voice transcript anchor for THIS utterance ──
          // Each spoken thought becomes its own subtree. The anchor
          // node (kind: 'user') is the parent of the AI-augmented
          // children, NOT the core seed. Position it sequentially —
          // either next to the most recent voice anchor or a fresh
          // slot near the seed if it's the first one.
          const existingVoice = prev.filter((n) => n.kind === "user");
          const lastVoice = existingVoice[existingVoice.length - 1];
          let anchorX: number;
          let anchorY: number;
          if (lastVoice) {
            // Stagger to the right + slightly down so anchors form a
            // readable timeline rather than overlapping.
            anchorX = lastVoice.x + 280;
            anchorY = lastVoice.y + 60;
          } else if (seed) {
            // First voice anchor: place above and to the right of the
            // seed so it doesn't fight existing seed children.
            anchorX = seed.x + 260;
            anchorY = seed.y - 180;
          } else {
            anchorX = 600;
            anchorY = 200;
          }
          const transcriptAnchor: ClientNode = {
            id: uid(),
            x: anchorX,
            y: anchorY,
            label: cleanTranscript.slice(0, 400),
            kind: "user",
            parent: seed?.id ?? null,
            meta: `voice:${recordedAt}`,
          };

          // AI children fan out from the anchor (not the seed). Use
          // placeNear with the anchor as the parent — gives the cluster
          // its own little constellation rather than crowding the core.
          const created: ClientNode[] = newNodes.map((n, i) => {
            const pos = placeNear(
              transcriptAnchor,
              i,
              newNodes.length,
              160,
            );
            return {
              id: uid(),
              x: pos.x + (Math.random() - 0.5) * 24,
              y: pos.y + (Math.random() - 0.5) * 24,
              label: n.label,
              kind: n.kind,
              parent: transcriptAnchor.id,
            };
          });
          return withRepel(prev, [...prev, transcriptAnchor, ...created]);
        });
        if (res.result.summary) toast.info(res.result.summary);
      } catch (e) {
        toast.error("Augment failed", { description: (e as Error).message });
      } finally {
        setAiBusy(null);
      }
    },
    [autoMode, nodes, precision],
  );

  const speech = useSpeech(handleAIAugment);

  // ── Auto-start voice on arrival from the dashboard voice orb ──
  // When the user arrived with ?voice=1, the dashboard orb already
  // handled the initial spoken phrase (and committed it as the seed
  // node). The whiteboard takes over by immediately starting its own
  // mic so the user can keep talking without re-clicking. Fires once,
  // gated on `loaded` so the board is rendered first.
  const voiceAutoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartVoice) return;
    if (voiceAutoStartedRef.current) return;
    if (!loaded) return;
    if (!speech.supported) return;
    voiceAutoStartedRef.current = true;
    // Slight delay lets the previous mic stream (orb's analyser) fully
    // release before the whiteboard requests a new one.
    const t = window.setTimeout(() => {
      if (!speech.listening) speech.start();
    }, 380);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartVoice, loaded, speech.supported]);

  const toggleMic = () => {
    if (!speech.supported) {
      toast.error("Voice unsupported", { description: "Try Chrome." });
      return;
    }
    if (speech.listening) speech.stop();
    else speech.start();
  };

  // ── Pointer handling: pan / draw / drop sticky / select ──
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
    if (tool === "pen") {
      const w = toWorld(e.clientX, e.clientY);
      drawingRef.current = { id: uid(), points: [[w.x, w.y]], color: "#3b82f6" };
      setStrokes((p) => [...p, drawingRef.current!]);
    } else if (tool === "note") {
      const w = toWorld(e.clientX, e.clientY);
      const label = window.prompt("Note text:") ?? "";
      if (label.trim()) {
        setNodes((p) =>
          withRepel(p, [
            ...p,
            {
              id: uid(),
              x: w.x,
              y: w.y,
              label: label.trim(),
              kind: "branch",
            },
          ]),
        );
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isPanning && panStartRef.current) {
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.clientX),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.clientY),
      });
      return;
    }
    if (tool !== "pen" || !drawingRef.current) return;
    const w = toWorld(e.clientX, e.clientY);
    drawingRef.current.points.push([w.x, w.y]);
    setStrokes((p) => [...p.slice(0, -1), { ...drawingRef.current! }]);
  };

  const onPointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
    drawingRef.current = null;
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

  // Track Space-as-pan-modifier + Esc as close-everything.
  // Esc clears the current selection AND closes the actionable modal
  // — single mental model: "stop whatever menu/modal is open."
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (e.code === "Space" && !e.repeat) {
        if (typing) return;
        spaceHeldRef.current = true;
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        // Don't intercept Esc inside form fields — let inputs handle it
        // (e.g. clearing autocomplete). Only the canvas-level dismiss.
        if (typing) return;
        if (actionableTargetId) {
          setActionableTargetId(null);
          return;
        }
        // Connect-tool source cancel — release the in-flight connection
        // before falling back to deselect.
        if (connectFromId) {
          setConnectFromId(null);
          return;
        }
        if (selectedId) {
          setSelectedId(null);
        }
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
  }, [actionableTargetId, selectedId, connectFromId]);

  const onNodeClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // If the pointer moved >4px between down and up, treat this as a
    // drag-end rather than a click; selection stays where it was.
    if (nodeDragRef.current?.hasMoved) return;
    if (tool === "eraser") {
      setNodes((p) => p.filter((n) => n.id !== id && n.parent !== id));
      // Cascade: drop any lateral edges referencing the deleted node.
      setLateralEdges((p) => p.filter((ed) => ed.from !== id && ed.to !== id));
      if (selectedId === id) setSelectedId(null);
      if (connectFromId === id) setConnectFromId(null);
      return;
    }
    if (tool === "connect") {
      // First click captures the source; second click on a different
      // card finalizes the edge and resets so the user can chain
      // connections. Click the same card twice to cancel.
      if (!connectFromId) {
        setConnectFromId(id);
        setSelectedId(id);
        toast.info("Pick a second card to connect");
        return;
      }
      if (connectFromId === id) {
        setConnectFromId(null);
        return;
      }
      const from = connectFromId;
      const to = id;
      setLateralEdges((prev) => {
        const exists = prev.some(
          (ed) =>
            (ed.from === from && ed.to === to) ||
            (ed.from === to && ed.to === from),
        );
        if (exists) return prev;
        return [...prev, { id: uid(), from, to }];
      });
      setConnectFromId(null);
      toast.success("Connection drawn");
      return;
    }
    setSelectedId(id);
  };

  // Begin dragging a node. Eraser tool short-circuits (no drag — the
  // pointerdown there means "delete on click"). Otherwise we install
  // window listeners that update the node's world coords as the cursor
  // moves; drag ends on pointerup.
  const handleNodeDragStart = (e: React.PointerEvent, nodeId: string) => {
    if (tool === "eraser") return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    nodeDragRef.current = {
      nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      hasMoved: false,
    };

    const onMove = (ev: PointerEvent) => {
      const d = nodeDragRef.current;
      if (!d) return;
      const dxScreen = ev.clientX - d.startClientX;
      const dyScreen = ev.clientY - d.startClientY;
      if (!d.hasMoved && Math.hypot(dxScreen, dyScreen) > 4) {
        d.hasMoved = true;
      }
      if (!d.hasMoved) return;
      const dxWorld = dxScreen / zoomRef.current;
      const dyWorld = dyScreen / zoomRef.current;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === d.nodeId
            ? { ...n, x: d.startNodeX + dxWorld, y: d.startNodeY + dyWorld }
            : n,
        ),
      );
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Keep `hasMoved` set until after the synthetic click fires, so
      // onNodeClick can suppress the click that follows a drag.
      window.setTimeout(() => {
        nodeDragRef.current = null;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const clearAll = () => {
    setNodes((prev) => {
      const core = prev.find((n) => n.kind === "core");
      return core ? [core] : prev.slice(0, 1);
    });
    setStrokes([]);
    setQuestions([]);
    setResearch([]);
    setDecomp(null);
    setSelectedId(null);
    setTranscripts([]);
    speech.reset();
  };

  const tidyUp = useCallback(() => {
    setNodes((prev) => {
      const positions = radialTreeLayout(prev);
      return prev.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      });
    });
    setPan({ x: 0, y: 0 });
    setZoom(1);
    toast.info("Board tidied");
  }, []);

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const runMode = async (mode: "decompose" | "questions" | "research") => {
    const transcript =
      [...speech.finals, speech.interim].join(" ").trim() ||
      nodes
        .filter((n) => n.kind !== "user")
        .map((n) => n.label)
        .join(", ");
    if (!transcript) {
      toast.info("Speak or add something first.");
      return;
    }
    setAiBusy(mode);
    try {
      // Pass the precision slider through — Lv 1 = wild cross-domain,
      // Lv 5 = surgical (named entities + quantified targets). Used to
      // be a Variations-only knob; now all augment modes respect it.
      const res = await augment({ transcript, mode, precision });
      if (mode === "questions" && res.mode === "questions") {
        const qs = res.result.questions ?? [];
        setQuestions(qs);
        addToHistory(qs.map((q) => ({ bucket: "question" as const, text: q, kind: "question" as const })));
      } else if (mode === "research" && res.mode === "research") {
        const ds = res.result.directions ?? [];
        setResearch(ds);
        addToHistory(
          ds.map((d) => ({
            bucket: "research" as const,
            text: d.prompt,
            kind: "insight" as const,
            meta: `[${d.angle}] ${d.why}`,
          })),
        );
      } else if (mode === "decompose" && res.mode === "decompose") {
        const d = res.result;
        setDecomp(d);
        addToHistory([
          ...d.upstream.map((t) => ({ bucket: "upstream" as const, text: t, kind: "branch" as const })),
          ...d.downstream.map((t) => ({ bucket: "downstream" as const, text: t, kind: "action" as const })),
          ...d.first_principles.map((t) => ({ bucket: "first_principles" as const, text: t, kind: "insight" as const })),
          ...d.variations.map((t) => ({ bucket: "variations" as const, text: t, kind: "variation" as const })),
        ]);
      }
    } catch (e) {
      toast.error(`${mode} failed`, { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  const handlePick = useCallback(
    (bucket: HistoryBucket, text: string, kind: NodeKind, meta?: string) => {
      addNodeFromPanel(text, kind, selectedId ?? undefined);
      addToHistory([{ bucket, text, kind, meta }]);
      markPicked(bucket, text);
    },
    [addNodeFromPanel, addToHistory, markPicked, selectedId],
  );

  // Autopilot inserts variation rows directly into the DB; we merge them
  // into local state here so the canvas reflects the new nodes immediately.
  // The auto-save loop will subsequently PUT the full node list (including
  // these), which is idempotent — IDs are preserved on the round-trip.
  const handleAutopilotRound = useCallback((newNodes: AutopilotNewNode[]) => {
    if (newNodes.length === 0) return;
    setNodes((prev) =>
      withRepel(prev, [
        ...prev,
        ...newNodes.map(
          (n): ClientNode => ({
            id: n.id,
            x: n.x,
            y: n.y,
            label: n.label,
            // Wave 1: autopilot round-kinds now produce multiple node
            // kinds (variation / branch / ranking). The hook's
            // AutopilotNewNode.kind is intentionally loose (string)
            // since each round kind picks its own. The server only
            // emits values that are valid NodeKinds — assertion is
            // safe but loud-on-bug if a typo lands.
            kind: n.kind as NodeKind,
            parent: n.parent_id,
            meta: n.meta ?? undefined,
          }),
        ),
      ]),
    );
  }, []);

  // Build the rich context block for a scoped action on a target node.
  // Used by all five scoped actions (decompose/variations/questions/
  // research/actionable) to prevent LLM domain-drift. Includes:
  //   - the core seed (overarching concept)
  //   - the full ancestor chain (root → target's parent)
  //   - the target's siblings at the same hierarchy level
  // The target's own label is sent as the `transcript`, not the context,
  // so the prompt's "given concept" anchor stays explicit.
  const buildRichContext = useCallback(
    (target: ClientNode): string => {
      const ancestorChain: string[] = [];
      let cursor: ClientNode | undefined = target;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        ancestorChain.unshift(`${cursor.kind}: ${cursor.label}`);
        cursor = cursor.parent ? nodes.find((n) => n.id === cursor!.parent) : undefined;
      }
      const core = nodes.find((n) => n.kind === "core");
      const siblings = nodes
        .filter((n) => n.parent === target.parent && n.id !== target.id && n.kind !== "user")
        .slice(0, 6)
        .map((n) => `- ${n.label}`);

      const ctxLines: string[] = [];
      if (core && core.id !== target.id) {
        ctxLines.push(`Overarching brainstorm seed: ${core.label}`);
      }
      if (ancestorChain.length > 1) {
        // Drop the last entry — that's the target itself.
        ctxLines.push(
          `Ancestor chain (root → target):\n${ancestorChain.slice(0, -1).join("\n")}`,
        );
      }
      if (siblings.length > 0) {
        ctxLines.push(`Sibling concepts at the same level:\n${siblings.join("\n")}`);
      }
      return ctxLines.join("\n\n");
    },
    [nodes],
  );

  // ── Auto-fit viewport to a set of newly-spawned/affected nodes ──
  // Called after every scoped action so the user immediately sees what
  // just happened instead of having to hunt across the canvas. Uses
  // the layout-helpers' computeFitToContent which accounts for the
  // left toolbar (64px) and right AI rail (320px) plus a small top
  // inset for the zoom/sync indicators.
  //
  // We pad the bbox so the new subtree never touches the rail edges,
  // and cap zoom at 1.0 so we don't dramatically zoom IN on a tiny
  // subtree (would feel jarring after a click). A small subtree at
  // close range is fine — just don't magnify it.
  const autoFitToBbox = useCallback(
    (bbox: ReturnType<typeof computeSubtreeBbox>) => {
      if (!bbox) return;
      const { pan: nextPan, zoom: nextZoom } = computeFitToContent(bbox, {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        leftRail: 64,
        rightRail: 320,
        topInset: 64,
        bottomInset: 100,
      }, {
        padding: 120,
        maxZoom: 1.0,
        minZoom: 0.35,
      });
      setPan(nextPan);
      setZoom(nextZoom);
    },
    [],
  );

  const runVariations = async (parentId: string) => {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return;
    setAiBusy(`variations:${parentId}`);
    try {
      const ancestorChain: string[] = [];
      let cursor: ClientNode | undefined = parent;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        ancestorChain.unshift(`${cursor.kind}: ${cursor.label}`);
        cursor = cursor.parent ? nodes.find((n) => n.id === cursor!.parent) : undefined;
      }
      const core = nodes.find((n) => n.kind === "core");
      const siblings = nodes
        .filter((n) => n.parent === parent.parent && n.id !== parent.id && n.kind !== "user")
        .slice(0, 6)
        .map((n) => `- ${n.label}`);

      const ctxLines: string[] = [];
      if (core && core.id !== parent.id) {
        ctxLines.push(`Overarching brainstorm seed: ${core.label}`);
      }
      if (ancestorChain.length > 1) {
        ctxLines.push(
          `Ancestor chain (root → target):\n${ancestorChain.slice(0, -1).join("\n")}`,
        );
      }
      if (siblings.length > 0) {
        ctxLines.push(`Sibling concepts at the same level:\n${siblings.join("\n")}`);
      }
      const ctx = ctxLines.join("\n\n");

      const res = await augment({
        transcript: parent.label,
        mode: "variations",
        context: ctx || undefined,
        precision,
      });
      if (res.mode !== "variations") return;
      const list: VariationItem[] = res.result.variations ?? [];
      if (!list.length) {
        toast.info("No variations returned.");
        return;
      }
      const newlyAdded: ClientNode[] = [];
      setNodes((prev) => {
        const existing = prev.filter((n) => n.parent === parentId && n.kind === "variation").length;
        const created: ClientNode[] = list.map((v, i) => {
          const pos = placeNear(parent, existing + i, existing + list.length, 160);
          return {
            id: uid(),
            x: pos.x + (Math.random() - 0.5) * 30,
            y: pos.y + (Math.random() - 0.5) * 30,
            label: v.label,
            kind: "variation",
            parent: parentId,
            meta: `[Lv ${precision}] ${v.rationale}`,
          };
        });
        newlyAdded.push(...created);
        return withRepel(prev, [...prev, ...created]);
      });
      autoFitToBbox(computeSubtreeBbox([parent, ...newlyAdded]));
      toast.success(`${list.length} variations added`);
    } catch (e) {
      toast.error("Variations failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  const runRank = async (parentId: string) => {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return;
    const variations = nodes.filter((n) => n.parent === parentId && n.kind === "variation");
    if (variations.length < 2) {
      toast.info("Generate at least 2 variations first.");
      return;
    }
    setAiBusy(`rank:${parentId}`);
    try {
      const transcript = `Concept: ${parent.label}\nVariations:\n${variations
        .map((v) => `- ${v.label}${v.meta ? ` — ${v.meta}` : ""}`)
        .join("\n")}`;
      const res = await augment({ transcript, mode: "rank", precision });
      if (res.mode !== "rank") return;
      const ranked: RankedItem[] = res.result.ranked ?? [];
      if (!ranked.length) {
        toast.info("No ranking returned.");
        return;
      }
      const summary = ranked.map((r, i) => `#${i + 1} ${r.label} (${r.score})`).join(" · ");
      const meta = ranked
        .map((r, i) => `${i + 1}. ${r.label} — ${r.score}/100 · ${r.reason}`)
        .join("\n");
      setNodes((prev) => {
        const existing = prev.filter((n) => n.parent === parentId && n.kind === "ranking").length;
        const pos = placeNear(parent, variations.length + existing, variations.length + 1, 240);
        const node: ClientNode = {
          id: uid(),
          x: pos.x,
          y: pos.y,
          label: `Ranking: ${summary.slice(0, 80)}`,
          kind: "ranking",
          parent: parentId,
          meta,
        };
        return withRepel(prev, [...prev, node]);
      });
      toast.success("Variations ranked");
    } catch (e) {
      toast.error("Rank failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  // ── Scoped Decompose ──
  //
  // Decompose just THIS card's concept. Spawns 4 category folder
  // nodes (Upstream / Downstream / First principles / Variations) as
  // direct children of the target, and the LLM's items as the
  // grand-children under each category. The result is a natural
  // 2-level tree that traces back to its origin card — addresses the
  // "decomposed items don't trace back" feedback from live testing.
  const runDecomposeOnNode = async (targetId: string) => {
    const target = nodes.find((n) => n.id === targetId);
    if (!target) return;
    setAiBusy(`decompose:${targetId}`);
    try {
      const ctx = buildRichContext(target);
      const res = await augment({
        transcript: target.label,
        mode: "decompose",
        context: ctx || undefined,
        precision,
      });
      if (res.mode !== "decompose") return;
      const d = res.result;
      const categoryDefs = [
        { label: "Upstream needs", items: d.upstream, childKind: "branch" as NodeKind },
        { label: "Downstream produces", items: d.downstream, childKind: "action" as NodeKind },
        { label: "First principles", items: d.first_principles, childKind: "insight" as NodeKind },
        { label: "Variations", items: d.variations, childKind: "variation" as NodeKind },
      ];
      const totalItems = categoryDefs.reduce((s, c) => s + c.items.length, 0);
      if (totalItems === 0) {
        toast.info("Decompose returned nothing — try adding more context to the card.");
        return;
      }

      // Track new nodes for auto-fit.
      const newlyAdded: ClientNode[] = [];
      let replacedCount = 0;

      setNodes((prev) => {
        // ── Replace existing decomposition on this card ──
        // Re-decomposing means "give me a fresh take" — keeping the old
        // categories stacked next to new ones is the messy outcome the
        // user complained about. Find existing category folders (their
        // meta starts with "Decomposed from") and drop them + their
        // descendants in one pass.
        const existingCategories = prev.filter(
          (n) =>
            n.parent === targetId &&
            n.kind === "branch" &&
            n.meta?.startsWith("Decomposed from"),
        );
        let cleaned = prev;
        if (existingCategories.length > 0) {
          const staleIds = collectDescendantIds(
            existingCategories.map((n) => n.id),
            prev,
            { includeRoots: true },
          );
          cleaned = prev.filter((n) => !staleIds.has(n.id));
          replacedCount = existingCategories.length;
        }

        // ── Structured grid layout ──
        // Categories in a horizontal row directly below the target,
        // items stacked vertically under each category. Predictable,
        // never self-overlaps, easy to skim.
        const categoryIds = categoryDefs.map(() => uid());
        const placements = structuredGridLayout(
          target,
          categoryDefs.map((c, i) => ({ catId: categoryIds[i], itemCount: c.items.length })),
        );
        const placementById = new Map(placements.map((p) => [p.catId, p]));

        const created: ClientNode[] = [];
        categoryDefs.forEach((cat, idx) => {
          if (cat.items.length === 0) return;
          const place = placementById.get(categoryIds[idx]);
          if (!place) return;
          const catNode: ClientNode = {
            id: categoryIds[idx],
            x: place.catX,
            y: place.catY,
            label: cat.label,
            kind: "branch",
            parent: targetId,
            meta: `Decomposed from "${target.label.slice(0, 60)}"`,
          };
          created.push(catNode);
          cat.items.forEach((item, i) => {
            const pos = place.itemPositions[i];
            created.push({
              id: uid(),
              x: pos.x,
              y: pos.y,
              label: item,
              kind: cat.childKind,
              parent: catNode.id,
            });
          });
        });
        newlyAdded.push(...created);

        // Batch insert with repel — the structured grid is already
        // collision-free internally; repel handles overlaps with
        // any other content on the board.
        return withRepel(cleaned, [...cleaned, ...created]);
      });

      // Auto-fit viewport to the new subtree (target + new arrivals).
      // We have the planned positions in `newlyAdded`; combine with the
      // target's known position for the bbox.
      const fitBbox = computeSubtreeBbox([target, ...newlyAdded]);
      autoFitToBbox(fitBbox);

      if (replacedCount > 0) {
        toast.success(
          `Decomposed into ${totalItems} items · replaced previous decomposition`,
        );
      } else {
        toast.success(`Decomposed into ${totalItems} items across 4 categories`);
      }
    } catch (e) {
      toast.error("Decompose failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  // ── Scoped Sharper Questions ──
  // Generates 3-4 Socratic questions specifically about the target
  // concept; spawns them as question-kind children. Different from
  // the right-rail Questions mode (which is board-wide).
  const runQuestionsOnNode = async (targetId: string) => {
    const target = nodes.find((n) => n.id === targetId);
    if (!target) return;
    setAiBusy(`questions:${targetId}`);
    try {
      const ctx = buildRichContext(target);
      const res = await augment({
        transcript: target.label,
        mode: "questions",
        context: ctx || undefined,
        precision,
      });
      if (res.mode !== "questions") return;
      const qs = res.result.questions ?? [];
      if (qs.length === 0) {
        toast.info("No questions returned.");
        return;
      }
      const newlyAdded: ClientNode[] = [];
      setNodes((prev) => {
        const existing = prev.filter(
          (n) => n.parent === targetId && n.kind === "question",
        ).length;
        const created: ClientNode[] = qs.map((q, i) => {
          const pos = placeNear(target, existing + i, existing + qs.length, 180);
          return {
            id: uid(),
            x: pos.x + (Math.random() - 0.5) * 25,
            y: pos.y + (Math.random() - 0.5) * 25,
            label: q,
            kind: "question",
            parent: targetId,
          };
        });
        newlyAdded.push(...created);
        return withRepel(prev, [...prev, ...created]);
      });
      autoFitToBbox(computeSubtreeBbox([target, ...newlyAdded]));
      toast.success(`${qs.length} sharper questions added`);
    } catch (e) {
      toast.error("Questions failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  // ── Scoped Research directions ──
  // Generates concrete research directions specifically anchored to
  // this card's concept; each direction carries an angle (validate /
  // refute / extend / alternative) stored in the node's meta so the
  // card can render the angle pill.
  const runResearchOnNode = async (targetId: string) => {
    const target = nodes.find((n) => n.id === targetId);
    if (!target) return;
    setAiBusy(`research:${targetId}`);
    try {
      const ctx = buildRichContext(target);
      const res = await augment({
        transcript: target.label,
        mode: "research",
        context: ctx || undefined,
        precision,
      });
      if (res.mode !== "research") return;
      const ds = res.result.directions ?? [];
      if (ds.length === 0) {
        toast.info("No research directions returned.");
        return;
      }
      const newlyAdded: ClientNode[] = [];
      setNodes((prev) => {
        const existing = prev.filter(
          (n) => n.parent === targetId && n.kind === "insight",
        ).length;
        const created: ClientNode[] = ds.map((d, i) => {
          const pos = placeNear(target, existing + i, existing + ds.length, 180);
          return {
            id: uid(),
            x: pos.x + (Math.random() - 0.5) * 25,
            y: pos.y + (Math.random() - 0.5) * 25,
            label: d.prompt,
            kind: "insight",
            parent: targetId,
            meta: `[${d.angle}] ${d.why}`,
          };
        });
        newlyAdded.push(...created);
        return withRepel(prev, [...prev, ...created]);
      });
      autoFitToBbox(computeSubtreeBbox([target, ...newlyAdded]));
      toast.success(`${ds.length} research directions added`);
    } catch (e) {
      toast.error("Research failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  // ── Make actionable ──
  // Opens a modal that walks the user through clarifying questions
  // and then generates a structured plan. On accept the modal calls
  // back into `spawnPlanFromModal` which inserts a plan-kind node
  // as a child of the source card. (State is declared at the top of
  // the component so the Esc keybind effect can reference it.)
  const runActionableOnNode = (targetId: string) => {
    const target = nodes.find((n) => n.id === targetId);
    if (!target) return;
    setActionableTargetId(targetId);
  };

  const actionableTarget = useMemo(
    () =>
      actionableTargetId
        ? nodes.find((n) => n.id === actionableTargetId) ?? null
        : null,
    [actionableTargetId, nodes],
  );

  const spawnPlanFromModal = useCallback(
    (planLabel: string, planMeta: string) => {
      if (!actionableTarget) return;
      const target = actionableTarget;
      setNodes((prev) => {
        const existing = prev.filter(
          (n) => n.parent === target.id && n.kind === "plan",
        ).length;
        const pos = placeNear(target, existing, existing + 1, 260);
        return withRepel(prev, [
          ...prev,
          {
            id: uid(),
            x: pos.x,
            y: pos.y,
            // Use the refined goal as the card label so a glance shows
            // the intent; the structured detail goes in meta and is
            // rendered as the <pre> block under the label.
            label: planLabel.slice(0, 200),
            kind: "plan",
            parent: target.id,
            meta: planMeta,
          },
        ]);
      });
      toast.success("Plan added to board");
    },
    [actionableTarget],
  );

  // ── Synthesize: combine two source cards into a new "synergy" node ──
  //
  // Triggered from the lateral-edge chip (rendered floating near each
  // edge's midpoint). Sends both source cards' label + kind + ancestor
  // chain to /api/synergy/augment?mode=synthesize. On response inserts
  // a new synergy-kind node positioned between the two sources, wired
  // as a polyhierarchy child (parent = a.id for layout; parents =
  // [a.id, b.id] for full lineage). Repel pass anchors the new node so
  // it stays exactly between A and B, pushing crowding cards outward.
  const runSynthesize = useCallback(
    async (aId: string, bId: string) => {
      const a = nodes.find((n) => n.id === aId);
      const b = nodes.find((n) => n.id === bId);
      if (!a || !b) return;
      // Use both nodes' rich context to anchor the synthesis — the
      // LLM gets ancestor + siblings for each, so it can produce a
      // synthesis that respects their respective domains instead of
      // pivoting to an unrelated topic.
      const ctxA = buildRichContext(a);
      const ctxB = buildRichContext(b);
      const transcript =
        `Idea A (${a.kind}): ${a.label}\n` +
        `Idea B (${b.kind}): ${b.label}\n\n` +
        `What concrete new thing do these two create TOGETHER?`;
      const context = [
        ctxA ? `Context for A:\n${ctxA}` : null,
        ctxB ? `Context for B:\n${ctxB}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const busyKey = `synthesize:${aId}:${bId}`;
      setAiBusy(busyKey);
      try {
        const res = await augment({
          transcript,
          mode: "synthesize",
          context: context || undefined,
          precision,
        });
        if (res.mode !== "synthesize") return;
        const { label, why } = res.result;
        // Midpoint between sources for the new node's position.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const newId = uid();
        setNodes((prev) =>
          withRepel(prev, [
            ...prev,
            {
              id: newId,
              x: mx,
              y: my,
              label,
              kind: "synergy",
              parent: a.id,
              parents: [a.id, b.id],
              meta: why,
            },
          ]),
        );
        setSelectedId(newId);
        toast.success("Synergy created");
      } catch (e) {
        toast.error("Synthesize failed", { description: (e as Error).message });
      } finally {
        setAiBusy(null);
      }
    },
    [nodes, buildRichContext],
  );

  // ── Scoped Describe (free-form instruction) ──
  // Routes the popover's "Or describe what you want…" submission to
  // the augment endpoint's `describe` mode. Reuses the rich-context
  // builder so anti-drift anchoring is identical to other scoped
  // actions. Spawns 1-6 new children of the target card with kinds
  // chosen by the LLM based on the user's instruction.
  const runDescribeOnNode = async (targetId: string, instruction: string) => {
    const target = nodes.find((n) => n.id === targetId);
    if (!target) return;
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setAiBusy(`describe:${targetId}`);
    try {
      const ctx = buildRichContext(target);
      // The instruction is sent as the transcript so the system prompt
      // sees it as the user's command. The card label goes in the
      // context so the model knows what it's expanding.
      const fullCtx = [
        `Target card: ${target.label}`,
        ctx,
      ]
        .filter(Boolean)
        .join("\n\n");
      const res = await augment({
        transcript: trimmed,
        mode: "describe",
        context: fullCtx || undefined,
      });
      if (res.mode !== "describe") return;
      const newNodes = res.result.nodes ?? [];
      if (newNodes.length === 0) {
        toast.info(
          res.result.summary ||
            "No new nodes — try rephrasing or picking a more specific card.",
        );
        return;
      }
      const newlyAdded: ClientNode[] = [];
      setNodes((prev) => {
        const existing = prev.filter((n) => n.parent === targetId).length;
        const created: ClientNode[] = newNodes.map((n, i) => {
          const pos = placeNear(target, existing + i, existing + newNodes.length, 200);
          return {
            id: uid(),
            x: pos.x + (Math.random() - 0.5) * 25,
            y: pos.y + (Math.random() - 0.5) * 25,
            label: n.label,
            kind: n.kind,
            parent: targetId,
          };
        });
        newlyAdded.push(...created);
        return withRepel(prev, [...prev, ...created]);
      });
      autoFitToBbox(computeSubtreeBbox([target, ...newlyAdded]));
      toast.success(
        res.result.summary
          ? `${newNodes.length} added · ${res.result.summary}`
          : `${newNodes.length} new ${newNodes.length === 1 ? "card" : "cards"} added`,
      );
    } catch (e) {
      toast.error("Describe failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  // ── Dispatcher passed to SynergyNode ──
  // Centralizes routing so the node component just emits "this action
  // for this node" and stays presentation-only. Describe is handled
  // separately via onDescribe because it carries an instruction string.
  // ── Tidy this subtree ──
  // Less-destructive cousin of the global Tidy button. Re-applies the
  // radial-tree layout to JUST the target's subtree, anchored at the
  // target's current position. Other nodes on the board stay put.
  // Then auto-fit to the re-laid subtree so the user sees the result.
  const tidySubtree = useCallback(
    (targetId: string) => {
      const target = nodes.find((n) => n.id === targetId);
      if (!target) return;
      const descIds = collectDescendantIds([targetId], nodes);
      if (descIds.size === 0) {
        toast.info("Nothing to tidy — this card has no descendants.");
        return;
      }
      const positions = subtreeRadialLayout(targetId, nodes);
      if (positions.size === 0) return;
      setNodes((prev) =>
        prev.map((n) => {
          const p = positions.get(n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        }),
      );
      // Compute bbox from the new positions and fit. Build a phantom
      // subtree (current nodes with new positions applied) for the
      // bbox calculation.
      const laidOut = nodes
        .filter((n) => n.id === targetId || descIds.has(n.id))
        .map((n) => {
          const p = positions.get(n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        });
      autoFitToBbox(computeSubtreeBbox(laidOut));
      toast.success(`Tidied ${descIds.size} descendant${descIds.size === 1 ? "" : "s"}`);
    },
    [nodes, autoFitToBbox],
  );

  const handleNodeAction = (
    action:
      | "decompose"
      | "variations"
      | "questions"
      | "research"
      | "actionable"
      | "rank"
      | "describe"
      | "tidy",
    nodeId: string,
  ) => {
    switch (action) {
      case "decompose":
        return runDecomposeOnNode(nodeId);
      case "variations":
        return runVariations(nodeId);
      case "questions":
        return runQuestionsOnNode(nodeId);
      case "research":
        return runResearchOnNode(nodeId);
      case "actionable":
        return runActionableOnNode(nodeId);
      case "rank":
        return runRank(nodeId);
      case "tidy":
        return tidySubtree(nodeId);
      case "describe":
        // Not invoked via tile click — describe flows through
        // onDescribe (which carries the instruction text). This case
        // exists only for type-exhaustiveness.
        return;
    }
  };

  // Edges colored by child kind so each subtree's connectors visually
  // tag what they produce (purple = insight, emerald = action, etc.).
  // Makes the hierarchy parse at a glance.
  const edges = nodes
    .filter((n) => n.parent)
    .map((n) => {
      const p = nodes.find((x) => x.id === n.parent);
      if (!p) return null;
      return { id: n.id, x1: p.x, y1: p.y, x2: n.x, y2: n.y, kind: n.kind };
    })
    .filter(
      (e): e is { id: string; x1: number; y1: number; x2: number; y2: number; kind: NodeKind } =>
        e !== null,
    );

  // Lateral edges resolved to geometry. Drawn as quadratic curves
  // (perpendicular bow ~12% of edge length) so they visually separate
  // from the straight dashed tree edges even when overlapping the
  // same node pair. Drop edges whose endpoints no longer exist
  // (defensive — node deletion cascade should have cleared them
  // already, but a stale edge would otherwise crash the SVG path).
  // Also exposes the chip-anchor position (peak of the curve) so the
  // Synthesize chip can render right on the edge.
  const lateralEdgesGeom = lateralEdges
    .map((ed) => {
      const a = nodes.find((n) => n.id === ed.from);
      const b = nodes.find((n) => n.id === ed.to);
      if (!a || !b) return null;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const bow = Math.min(80, len * 0.12);
      const cx = mx + (-dy / len) * bow;
      const cy = my + (dx / len) * bow;
      // Curve peak (t=0.5 on the quadratic) — where the chip sits.
      const px = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
      const py = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
      return {
        id: ed.id,
        from: ed.from,
        to: ed.to,
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        cx,
        cy,
        px,
        py,
      };
    })
    .filter(
      (g): g is {
        id: string;
        from: string;
        to: string;
        ax: number;
        ay: number;
        bx: number;
        by: number;
        cx: number;
        cy: number;
        px: number;
        py: number;
      } => g !== null,
    );

  // Secondary-parent edges: synergy nodes (and any future polyhierarchy
  // kinds) carry parents[] beyond the primary `parent`. Render each
  // secondary parent → child as a curved amber path matching lateral
  // edges, so the visual lexicon stays consistent: straight dashed =
  // primary tree, curved amber = "non-primary connection."
  const secondaryParentEdges = nodes.flatMap((n) => {
    if (!n.parents || n.parents.length <= 1) return [];
    return n.parents
      .filter((pid) => pid !== n.parent) // primary already drawn as tree edge
      .map((pid) => {
        const p = nodes.find((x) => x.id === pid);
        if (!p) return null;
        const mx = (p.x + n.x) / 2;
        const my = (p.y + n.y) / 2;
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const bow = Math.min(80, len * 0.12);
        const cx = mx + (-dy / len) * bow;
        const cy = my + (dx / len) * bow;
        return { id: `${pid}-${n.id}-sp`, ax: p.x, ay: p.y, bx: n.x, by: n.y, cx, cy };
      })
      .filter(
        (g): g is { id: string; ax: number; ay: number; bx: number; by: number; cx: number; cy: number } =>
          g !== null,
      );
  });

  // Folder regions: any node tagged as a Decompose category (its meta
  // starts with "Decomposed from") gets a subtle containment region
  // rendered behind it + its direct children. This is the visual
  // affordance for the "folder" pattern the scoped Decompose creates
  // — the user can see at a glance which items came from which card.
  const folderRegions = useMemo(() => {
    return nodes
      .filter((n) => n.meta?.startsWith("Decomposed from"))
      .map((folder) => {
        const children = nodes.filter((c) => c.parent === folder.id);
        const all = [folder, ...children];
        const xs = all.map((n) => n.x);
        const ys = all.map((n) => n.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        // Padding accounts for ~280px-wide cards + 110px-tall typical
        // cards rendered around the bbox centerpoints.
        const padX = 170;
        const padY = 95;
        return {
          id: folder.id,
          x: minX - padX,
          y: minY - padY,
          width: maxX - minX + padX * 2,
          height: maxY - minY + padY * 2,
          // Tint by folder label so the four category folders read
          // distinctly when they cluster around the same parent.
          tint: folderTintForLabel(folder.label),
        };
      });
  }, [nodes]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  // Surfaced in the AI rail's "Will attach under" indicator as the
  // fallback target when no card is selected. Mirrors the resolution
  // chain inside addNodeFromPanel (selectedId → core seed → nodes[0]).
  const seedNode = useMemo(
    () => nodes.find((n) => n.kind === "core") ?? null,
    [nodes],
  );
  const selectedHasVariations = useMemo(
    () =>
      !!selectedNode &&
      nodes.some((n) => n.parent === selectedNode.id && n.kind === "variation"),
    [nodes, selectedNode],
  );

  // ── Focus Mode hook + canvas dimming helpers ──
  const focus = useFocusMode(nodes);
  const focusActive =
    focus.phase === "open" ||
    focus.phase === "entering" ||
    focus.phase === "publishing";

  // Pan the canvas to a given node id — used by Stage 1 row clicks
  // (pane → canvas linkage). Smooth-eases pan to center the node.
  const recenterOnNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!target || !rect) return;
      // Pane reserves the right ~528px (480 + 24 inset + cushion), so
      // visible center sits to the left of the geometric canvas center.
      const visibleCenterX = (rect.width - 528) / 2;
      const visibleCenterY = rect.height / 2;
      setPan({
        x: visibleCenterX - target.x * zoom,
        y: visibleCenterY - target.y * zoom,
      });
    },
    [nodes, zoom],
  );

  // Compute the per-node opacity + visual variant based on focus state.
  // Plan nodes get the persistent cyan glow throughout focus mode.
  // Hovered nodes (from either pane or canvas) jump to full opacity
  // with a brighter cyan pulse ring.
  //
  // When Focus Mode is scoped to a thread (focus.scopedIds is non-null),
  // nodes outside the thread get a stronger blur+dim treatment so the
  // scoped thread reads as the active spotlight. Inside the thread,
  // we skip the converged-set dimming entirely — the whole thread
  // stays sharp until the user starts excluding individual nodes.
  const focusVisualFor = useCallback(
    (
      n: ClientNode,
    ): { opacity: number; ring: string | null; blurPx: number } => {
      if (!focusActive) return { opacity: 1, ring: null, blurPx: 0 };

      const isPlan = focus.planIds.has(n.id);
      const isHovered = focus.hoveredNodeId === n.id;
      const isExcluded = focus.excludedIds.has(n.id);
      const isKept = focus.keptIds.has(n.id);
      const scoped = focus.scopedIds;
      const inScope = !scoped || scoped.has(n.id);

      // Out-of-scope thread spotlight treatment — wins over everything
      // else; user-driven kept/excluded only applies within the scope.
      if (!inScope) {
        return { opacity: 0.12, ring: null, blurPx: 2.5 };
      }

      if (isHovered) return { opacity: 1, ring: "hover", blurPx: 0 };
      if (isPlan) return { opacity: 0.95, ring: "plan", blurPx: 0 };
      if (isExcluded) return { opacity: 0.18, ring: null, blurPx: 1 };
      if (scoped) {
        // In-scope nodes during a thread-spotlight stay sharp; the
        // converged-set distinction is rendered through the pane,
        // not via canvas dimming.
        return { opacity: 1, ring: null, blurPx: 0 };
      }
      if (isKept) return { opacity: 0.6, ring: null, blurPx: 0 };
      return { opacity: 0.28, ring: null, blurPx: 0 };
    },
    [
      focusActive,
      focus.planIds,
      focus.hoveredNodeId,
      focus.excludedIds,
      focus.keptIds,
      focus.scopedIds,
    ],
  );

  return (
    // Fixed overlay escapes the /app layout's main padding/scroll —
    // same trick the Space whiteboard uses (src/app/app/space/[id]/whiteboard/page.tsx).
    // z-40 keeps us under the GlobalToolbox (z-50) but above PulseStrip.
    <div className="fixed inset-0 z-40 flex overflow-hidden bg-gray-50">
      <SynergyToolbar
        tool={tool}
        onToolChange={setTool}
        onTidy={tidyUp}
        onResetView={resetView}
        onClear={clearAll}
      />

      <main className="relative flex-1 overflow-hidden">
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
          <button
            onClick={resetView}
            title="Click to reset view. Wheel to zoom, space+drag to pan."
            className="rounded-full border border-gray-200 bg-white/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gray-600 backdrop-blur transition hover:text-gray-900"
          >
            {Math.round(zoom * 100)}%
          </button>
          <div className="pointer-events-none flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-600 backdrop-blur">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-blue-600" /> saving…
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3 text-emerald-600" /> saved
              </>
            )}
            {saveStatus === "error" && (
              <>
                <Cloud className="h-3 w-3 text-rose-600" /> save failed
              </>
            )}
            {saveStatus === "idle" && (
              <>
                <Cloud className="h-3 w-3" /> synced
              </>
            )}
          </div>
          <Link
            href={`/app/synergy/${sessionId}/process`}
            title="Process page: components + scoring (utilitarian view)"
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/80 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-600 backdrop-blur transition hover:text-gray-900"
          >
            <Target className="h-3 w-3" /> Process
          </Link>
          <button
            onClick={() => focus.open()}
            title="Enter Focus Mode — converge + publish"
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_20px_-4px_rgba(6,182,212,0.5)] transition hover:scale-[1.03]"
          >
            <Sparkles className="h-3 w-3" /> Focus & Publish
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {!loaded && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/40 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Loading your session…
            </div>
          </div>
        )}

        <div
          ref={canvasRef}
          className="absolute inset-0"
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
                  : tool === "eraser"
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
              {/* Folder containment regions render first so edges and
                  nodes paint on top of them. Subtle fill + dashed
                  border matching the category's hue. */}
              {folderRegions.map((r) => (
                <rect
                  key={`folder-${r.id}`}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  rx={24}
                  ry={24}
                  fill={r.tint.fill}
                  stroke={r.tint.stroke}
                  strokeWidth={1}
                  strokeDasharray="6 6"
                />
              ))}
              {edges.map((e) => {
                // Edge is in-scope if its child node is in-scope —
                // since scope includes the full ancestor chain, the
                // parent is guaranteed in-scope whenever the child is.
                const inScope =
                  !focus.scopedIds || focus.scopedIds.has(e.id);
                return (
                  <line
                    key={e.id}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke={EDGE_COLOR_BY_KIND[e.kind]}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    opacity={focusActive && !inScope ? 0.12 : 1}
                    style={{ transition: "opacity 350ms ease" }}
                  />
                );
              })}
              {/* Lateral edges — curved amber paths to differentiate
                  from straight dashed tree edges. Solid stroke + arc
                  bow = "these are related but not nested." */}
              {lateralEdgesGeom.map((g) => (
                <path
                  key={`lat-${g.id}`}
                  d={`M ${g.ax} ${g.ay} Q ${g.cx} ${g.cy} ${g.bx} ${g.by}`}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeOpacity={0.75}
                  strokeLinecap="round"
                />
              ))}
              {/* Secondary-parent edges (polyhierarchy lineage from
                  Synthesize). Same curved amber lexicon as lateral
                  edges; dashed lightly to distinguish "this is also
                  a parent" from "these are related." */}
              {secondaryParentEdges.map((g) => (
                <path
                  key={`sp-${g.id}`}
                  d={`M ${g.ax} ${g.ay} Q ${g.cx} ${g.cy} ${g.bx} ${g.by}`}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />
              ))}
              {strokes.map((s) => (
                <polyline
                  key={s.id}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={s.points.map((p) => p.join(",")).join(" ")}
                />
              ))}
            </svg>

            {/* Synthesize chips — one per lateral edge, rendered at
                the curve peak. Click to fire an LLM synthesis that
                emits a new "synergy" node with both endpoints as
                parents. Busy state matches the in-flight key. */}
            {lateralEdgesGeom.map((g) => {
              const busyKey = `synthesize:${g.from}:${g.to}`;
              const busyKeyRev = `synthesize:${g.to}:${g.from}`;
              const busy = aiBusy === busyKey || aiBusy === busyKeyRev;
              return (
                <button
                  key={`chip-${g.id}`}
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (!busy) void runSynthesize(g.from, g.to);
                  }}
                  disabled={busy}
                  className={[
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-sm transition",
                    busy
                      ? "cursor-wait bg-amber-100 text-amber-700"
                      : "bg-amber-500 text-white hover:bg-amber-600",
                  ].join(" ")}
                  style={{ left: g.px, top: g.py }}
                  title="Synthesize a new idea from these two cards"
                >
                  {busy ? "…" : "Synthesize"}
                </button>
              );
            })}

            {nodes.map((n) => {
              // busyAction is the in-flight action key for THIS node,
              // or null. The wire format is "<action>:<nodeId>"; we
              // surface just the action name to the child.
              const busyAction =
                aiBusy && aiBusy.endsWith(`:${n.id}`)
                  ? aiBusy.split(":")[0]
                  : null;
              const visual = focusVisualFor(n);
              return (
                <div
                  key={n.id}
                  style={{
                    opacity: visual.opacity,
                    filter:
                      visual.blurPx > 0
                        ? `blur(${visual.blurPx}px)`
                        : undefined,
                    transition: "opacity 350ms ease, filter 350ms ease",
                    // Out-of-scope nodes shouldn't accept clicks during
                    // thread-spotlight — the user is concentrating on
                    // the highlighted subtree.
                    pointerEvents:
                      focusActive && visual.opacity < 0.25
                        ? "none"
                        : undefined,
                  }}
                >
                  <SynergyNode
                    node={n}
                    selected={n.id === selectedId}
                    showActions={true}
                    busyAction={busyAction}
                    canRank={nodes.some(
                      (c) => c.parent === n.id && c.kind === "variation",
                    )}
                    canTidy={nodes.some((c) => c.parent === n.id)}
                    onClick={(e) => onNodeClick(e, n.id)}
                    onAction={handleNodeAction}
                    onDescribe={runDescribeOnNode}
                    onFocusThread={(id) =>
                      focus.open({ scopeNodeId: id })
                    }
                    onDragStart={handleNodeDragStart}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <SynergyVoiceDock
          listening={speech.listening}
          supported={speech.supported}
          autoMode={autoMode}
          interim={speech.interim}
          busy={aiBusy === "augment"}
          onAutoModeChange={setAutoMode}
          onToggleMic={toggleMic}
        />
      </main>

      <SynergyAIRail
        sessionId={sessionId}
        selectedNode={selectedNode}
        seedNode={seedNode}
        selectedHasVariations={selectedHasVariations}
        precision={precision}
        onPrecisionChange={setPrecision}
        transcripts={transcripts}
        onClearTranscripts={() => setTranscripts([])}
        aiBusy={aiBusy}
        onRunMode={runMode}
        onRankSelected={() => selectedId && runRank(selectedId)}
        decomp={decomp}
        questions={questions}
        research={research}
        isPicked={isPicked}
        onPick={handlePick}
        history={history}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        onAutopilotRound={handleAutopilotRound}
      />

      {actionableTarget && (
        <SynergyActionableModal
          open={!!actionableTarget}
          targetLabel={actionableTarget.label}
          context={buildRichContext(actionableTarget)}
          onClose={() => setActionableTargetId(null)}
          onAccept={spawnPlanFromModal}
        />
      )}

      {/* ── Focus Mode immersive overlay (Phase 3.5b) ──
          The overlay manages its own backdrop dimmer (covers the
          canvas) + the glassmorphic pane (right side). Mounts only
          when phase !== "closed"; the hook handles entrance/exit
          animations and ESC-to-close. */}
      <FocusModeOverlay
        sessionId={sessionId}
        nodes={nodes}
        focus={focus}
        onFocusNode={recenterOnNode}
      />
    </div>
  );
}
