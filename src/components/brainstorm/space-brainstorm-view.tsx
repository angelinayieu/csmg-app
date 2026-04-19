"use client";

// ── SpaceBrainstormView ──
//
// Space-scoped brainstorm canvas. Same interaction model as the global
// /app/brainstorm but:
//   - Detection is scoped to THIS space only (faster, more focused)
//   - Submit always materializes INTO this space (no destination picker)
//   - Below the dock: a freestyle note zone — any sticky the user drops
//     here is captured as a local scratch that can later be converted to
//     a real entity
//
// Use this when you're deep inside a space and want to brainstorm without
// leaving. The global brainstorm is for cross-space thought capture.

import React, { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FlaskConical,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Plus,
  X,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceData } from "@/contexts/space-data-context";
import { PlaygroundDock } from "@/components/whiteboard/playground-dock";
import { PlaygroundSidePanel, type DetectionResult } from "@/components/whiteboard/playground-side-panel";
import type { Entity } from "@/types";

const DEBOUNCE_MS = 500;
const PANEL_WIDTH = 340;

// Freestyle sticky note — purely local to this session, not persisted.
// Users can drop many and then "Convert to entity" when one feels solid.
interface ScratchNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color: "yellow" | "pink" | "blue" | "green";
}

const STICKY_COLORS: Record<ScratchNote["color"], { bg: string; text: string; border: string }> = {
  yellow: { bg: "#fef3c7", text: "#78350f", border: "#fcd34d" },
  pink: { bg: "#fce7f3", text: "#831843", border: "#f9a8d4" },
  blue: { bg: "#dbeafe", text: "#1e3a8a", border: "#93c5fd" },
  green: { bg: "#d1fae5", text: "#064e3b", border: "#6ee7b7" },
};

export function SpaceBrainstormView() {
  const ctx = useSpaceData();
  const router = useRouter();

  const [userText, setUserText] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [detectionLoading, setDetectionLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<{ entityName: string; edges: number } | null>(null);
  const latestQueryRef = useRef<string>("");

  // Scratch notes (local-only freestyle area)
  const [notes, setNotes] = useState<ScratchNote[]>([]);

  // ── Debounced detection scoped to this space ──
  useEffect(() => {
    const text = userText.trim();
    latestQueryRef.current = text;

    if (text.length < 3) {
      setDetection(null);
      setDetectionLoading(false);
      return;
    }

    setDetectionLoading(true);
    const handle = setTimeout(async () => {
      if (latestQueryRef.current !== text) return;
      try {
        // Use the space-scoped playground detection endpoint — faster than cross-space
        const res = await fetch("/api/whiteboard/playground/detect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ space_id: ctx.space.id, text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DetectionResult;
        if (latestQueryRef.current !== text) return;
        setDetection(json);
      } catch (err) {
        console.warn("[SpaceBrainstormView] Detection failed:", err);
      } finally {
        if (latestQueryRef.current === text) setDetectionLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [userText, ctx.space.id]);

  // ── Submit — materialize directly into this space ──
  const handleSubmit = useCallback(async () => {
    const text = userText.trim();
    if (text.length < 3 || materializing) return;

    setMaterializing(true);
    setError(null);
    try {
      const res = await fetch("/api/whiteboard/playground/materialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          space_id: ctx.space.id,
          text,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        entity: { name: string };
        predicted_edges: Array<{ id: string }>;
      };
      setSuccessBanner({ entityName: json.entity.name, edges: json.predicted_edges.length });
      setUserText("");
      ctx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Materialize failed");
    } finally {
      setMaterializing(false);
    }
  }, [userText, materializing, ctx]);

  // ── Scratch note actions ──

  const addScratchNote = useCallback((text?: string) => {
    const colors: ScratchNote["color"][] = ["yellow", "pink", "blue", "green"];
    const randomColor = colors[notes.length % colors.length];
    const newNote: ScratchNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      // Rough placement — staggered so new notes don't stack exactly
      x: 40 + (notes.length % 4) * 220,
      y: 40 + Math.floor(notes.length / 4) * 170,
      text: text ?? "",
      color: randomColor,
    };
    setNotes((prev) => [...prev, newNote]);
  }, [notes.length]);

  const updateNote = useCallback((id: string, text: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)));
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const convertNoteToEntity = useCallback(async (note: ScratchNote) => {
    if (note.text.trim().length < 3) return;
    setMaterializing(true);
    try {
      const res = await fetch("/api/whiteboard/playground/materialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ space_id: ctx.space.id, text: note.text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSuccessBanner({ entityName: json.entity.name, edges: json.predicted_edges.length });
      removeNote(note.id);
      ctx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Convert failed");
    } finally {
      setMaterializing(false);
    }
  }, [ctx, removeNote]);

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white/85 backdrop-blur-sm px-5 py-3 z-10">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Link href={`/app/space/${ctx.space.id}/whiteboard`} className="inline-flex items-center gap-1 hover:text-gray-700">
            <ArrowLeft className="h-3 w-3" />
            Whiteboard
          </Link>
          <span>/</span>
          <span className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <FlaskConical className="h-3 w-3" />
            Brainstorm
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500 italic">scoped to this space</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-600">
          <button
            onClick={() => addScratchNote()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            title="Drop a freestyle sticky note on the canvas"
          >
            <StickyNote className="h-3 w-3" />
            Add note
          </button>
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900"
            title={panelOpen ? "Hide detection" : "Show detection"}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
          <Link
            href="/app/brainstorm"
            className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
            title="Cross-space brainstorm — search all your spaces"
          >
            Cross-space →
          </Link>
        </div>
      </div>

      {successBanner && (
        <div className="border-b border-indigo-200 bg-indigo-50/70 px-5 py-2 flex items-center justify-between gap-3 text-[11px] text-indigo-800">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              Created <span className="font-semibold">{successBanner.entityName}</span>
              {successBanner.edges > 0 && (
                <> with <span className="font-semibold">{successBanner.edges}</span> suggested connection{successBanner.edges === 1 ? "" : "s"}</>
              )}
            </span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-indigo-500 hover:text-indigo-800 text-[10px] font-medium">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="border-b border-rose-200 bg-rose-50/70 px-5 py-2 flex items-center justify-between gap-3 text-[11px] text-rose-800">
          <div>{error}</div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-800 text-[10px] font-medium">Dismiss</button>
        </div>
      )}

      {/* Main body */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col bg-gradient-to-br from-slate-50 to-indigo-50/20">
          {/* Freestyle zone — scratch notes */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {notes.length === 0 ? (
              <EmptyScratchHint onAddNote={() => addScratchNote()} />
            ) : (
              <div className="absolute inset-0 overflow-auto p-5">
                <div className="relative w-[2400px] h-[1800px]">
                  {notes.map((note) => (
                    <ScratchNoteCard
                      key={note.id}
                      note={note}
                      onUpdate={(text) => updateNote(note.id, text)}
                      onRemove={() => removeNote(note.id)}
                      onConvert={() => convertNoteToEntity(note)}
                      converting={materializing}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <PlaygroundDock
            value={userText}
            onChange={setUserText}
            onSubmit={handleSubmit}
            deepResearch={deepResearch}
            onToggleDeepResearch={setDeepResearch}
            loading={detectionLoading || materializing}
            placeholder="Think out loud. Matches from this space appear on the right. Submit to materialize as an entity here."
          />
        </div>

        {panelOpen && (
          <div style={{ width: PANEL_WIDTH }} className="flex-shrink-0">
            <PlaygroundSidePanel
              loading={detectionLoading}
              userText={userText}
              detection={detection}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── ScratchNoteCard ──

function ScratchNoteCard({
  note,
  onUpdate,
  onRemove,
  onConvert,
  converting,
}: {
  note: ScratchNote;
  onUpdate: (text: string) => void;
  onRemove: () => void;
  onConvert: () => void;
  converting: boolean;
}) {
  const colors = STICKY_COLORS[note.color];
  return (
    <div
      className="absolute rounded-[3px_3px_14px_3px] shadow-md"
      style={{
        left: note.x,
        top: note.y,
        width: 200,
        minHeight: 140,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        transform: `rotate(${((note.id.charCodeAt(note.id.length - 1) % 5) - 2) * 0.6}deg)`,
      }}
    >
      <div className="flex items-center justify-between gap-1 p-1.5 border-b" style={{ borderColor: colors.border }}>
        <span className="text-[9px] font-bold uppercase tracking-widest opacity-70">Note</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onConvert}
            disabled={converting || note.text.trim().length < 3}
            className="p-0.5 rounded hover:bg-black/5 disabled:opacity-40"
            title="Convert to entity"
          >
            <Sparkles className="h-3 w-3" />
          </button>
          <button onClick={onRemove} className="p-0.5 rounded hover:bg-black/5" title="Remove">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <textarea
        value={note.text}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder="…"
        className="w-full resize-none bg-transparent p-2.5 text-[12px] leading-snug focus:outline-none"
        style={{ minHeight: 100, color: colors.text }}
      />
    </div>
  );
}

// ── Empty state for the freestyle zone ──

function EmptyScratchHint({ onAddNote }: { onAddNote: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-gray-500">
      <Network className="h-10 w-10 text-indigo-300 mb-3" />
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Space brainstorm</h2>
      <p className="max-w-md text-sm leading-relaxed mb-4">
        Type in the dock below — detection searches <span className="font-medium">this space only</span>, so matches are
        immediate. Or drop sticky notes for half-formed thoughts.
      </p>
      <button
        onClick={onAddNote}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-indigo-700 shadow-sm"
      >
        <Plus className="h-3.5 w-3.5" />
        Drop a sticky note
      </button>
      <p className="mt-3 text-[11px] text-gray-400">
        Notes are local — they stay here until you convert one into a real entity.
      </p>
    </div>
  );
}
