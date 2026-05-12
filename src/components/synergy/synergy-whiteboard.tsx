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
import { normalizeKey, uid } from "@/lib/synergy/normalize";
import type {
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
import { useSpeech } from "@/hooks/synergy/use-speech";
import type { AutopilotNewNode } from "@/hooks/synergy/use-autopilot";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Transcript {
  id: string;
  text: string;
  at: number;
}

interface Props {
  sessionId: string;
  focusNodeId?: string;
}

export function SynergyWhiteboard({ sessionId, focusNodeId }: Props) {
  const [tool, setTool] = useState<SynergyTool>("select");
  const [autoMode, setAutoMode] = useState(true);
  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [strokes, setStrokes] = useState<ClientStroke[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [research, setResearch] = useState<ResearchDirection[]>([]);
  const [decomp, setDecomp] = useState<DecomposeResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [precision, setPrecision] = useState(3);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

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
          setSelectedId(next.id);
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
        setSelectedId(newNode.id);
        return [...prev, newNode];
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
      setTranscripts((prev) =>
        [...prev, { id: uid(), text: transcript.trim(), at: Date.now() }].slice(-30),
      );
      try {
        const ctx = nodes
          .filter((n) => n.kind !== "user")
          .map((n) => `${n.kind}: ${n.label}`)
          .join("\n");
        const res = await augment({ transcript, mode: "augment", context: ctx });
        if (res.mode !== "augment") return;
        const newNodes = res.result.nodes ?? [];
        if (newNodes.length === 0) {
          toast.info(res.result.summary || "Already on the board — nothing new to add.");
          return;
        }
        setNodes((prev) => {
          const seed = prev.find((n) => n.kind === "core") || prev[0];
          const existingChildren = prev.filter((n) => n.parent === seed?.id).length;
          const created: ClientNode[] = newNodes.map((n, i) => {
            const pos = placeNear(seed, existingChildren + i, existingChildren + newNodes.length);
            return {
              id: uid(),
              x: pos.x + (Math.random() - 0.5) * 30,
              y: pos.y + (Math.random() - 0.5) * 30,
              label: n.label,
              kind: n.kind,
              parent: seed?.id,
            };
          });
          return [...prev, ...created];
        });
        if (res.result.summary) toast.info(res.result.summary);
      } catch (e) {
        toast.error("Augment failed", { description: (e as Error).message });
      } finally {
        setAiBusy(null);
      }
    },
    [autoMode, nodes],
  );

  const speech = useSpeech(handleAIAugment);

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
        setNodes((p) => [
          ...p,
          {
            id: uid(),
            x: w.x,
            y: w.y,
            label: label.trim(),
            kind: "branch",
          },
        ]);
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

  // Track Space-as-pan-modifier
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

  const onNodeClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // If the pointer moved >4px between down and up, treat this as a
    // drag-end rather than a click; selection stays where it was.
    if (nodeDragRef.current?.hasMoved) return;
    if (tool === "eraser") {
      setNodes((p) => p.filter((n) => n.id !== id && n.parent !== id));
      if (selectedId === id) setSelectedId(null);
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
      const res = await augment({ transcript, mode });
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
    setNodes((prev) => [
      ...prev,
      ...newNodes.map(
        (n): ClientNode => ({
          id: n.id,
          x: n.x,
          y: n.y,
          label: n.label,
          kind: n.kind,
          parent: n.parent_id,
          meta: n.meta ?? undefined,
        }),
      ),
    ]);
  }, []);

  const runVariations = async (parentId: string) => {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return;
    setAiBusy(`var:${parentId}`);
    try {
      // Build richer context for variations. Off-topic drift (e.g.
      // "AI ethics certification" emerging from a cognitive-modelling
      // node) happens when the model only sees the target label. Pass:
      //   - the full ancestor chain (root → parent) for domain anchor
      //   - sibling labels so the LLM understands the granularity level
      //     the new variations should match
      //   - the core seed so the user's overarching concept is visible
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
        // Drop the last entry — that's the target itself.
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
        return [...prev, ...created];
      });
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
      const res = await augment({ transcript, mode: "rank" });
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
        return [...prev, node];
      });
      toast.success("Variations ranked");
    } catch (e) {
      toast.error("Rank failed", { description: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  };

  const edges = nodes
    .filter((n) => n.parent)
    .map((n) => {
      const p = nodes.find((x) => x.id === n.parent);
      if (!p) return null;
      return { id: n.id, x1: p.x, y1: p.y, x2: n.x, y2: n.y };
    })
    .filter((e): e is { id: string; x1: number; y1: number; x2: number; y2: number } => e !== null);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const selectedHasVariations = useMemo(
    () =>
      !!selectedNode &&
      nodes.some((n) => n.parent === selectedNode.id && n.kind === "variation"),
    [nodes, selectedNode],
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
            title="Extract typed components + score rabbit holes"
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
          >
            <Target className="h-3 w-3" /> Process
            <ArrowRight className="h-3 w-3" />
          </Link>
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
              {edges.map((e) => (
                <line
                  key={e.id}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="rgba(59, 130, 246, 0.35)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
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

            {nodes.map((n) => (
              <SynergyNode
                key={n.id}
                node={n}
                selected={n.id === selectedId}
                showActions={true}
                variationBusy={aiBusy === `var:${n.id}`}
                rankBusy={aiBusy === `rank:${n.id}`}
                canRank={nodes.some((c) => c.parent === n.id && c.kind === "variation")}
                onClick={(e) => onNodeClick(e, n.id)}
                onVariations={(e) => {
                  e.stopPropagation();
                  runVariations(n.id);
                }}
                onRank={(e) => {
                  e.stopPropagation();
                  runRank(n.id);
                }}
                onDragStart={handleNodeDragStart}
              />
            ))}
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
    </div>
  );
}
