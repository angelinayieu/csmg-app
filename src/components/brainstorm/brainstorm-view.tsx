"use client";

// ── BrainstormView ──
//
// Freestyle canvas that isn't attached to any space. User types in the dock;
// detection runs cross-space. Submit opens the space picker so the user
// explicitly chooses where the thought should live.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FlaskConical,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlaygroundDock } from "@/components/whiteboard/playground-dock";
import { BrainstormDetectionPanel, type BrainstormDetectionResult } from "./brainstorm-detection-panel";
import { SpacePicker, type PickerSpace } from "./space-picker";

const DEBOUNCE_MS = 500;
const PANEL_WIDTH = 360;

export function BrainstormView() {
  const router = useRouter();
  const [userText, setUserText] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [detection, setDetection] = useState<BrainstormDetectionResult | null>(null);
  const [detectionLoading, setDetectionLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedTargetSpaceId, setSuggestedTargetSpaceId] = useState<string | null>(null);
  const latestQueryRef = useRef<string>("");

  // ── Debounced cross-space detection ──
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
        const res = await fetch("/api/brainstorm/detect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as BrainstormDetectionResult;
        if (latestQueryRef.current !== text) return;
        setDetection(json);
      } catch (err) {
        console.warn("[BrainstormView] Detection failed:", err);
      } finally {
        if (latestQueryRef.current === text) setDetectionLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [userText]);

  // ── Submit flow — opens space picker ──
  const onSubmit = useCallback(() => {
    if (userText.trim().length < 3) return;
    setError(null);
    setPickerOpen(true);
  }, [userText]);

  // ── Space picker actions ──
  const handleCreateNew = useCallback(
    async (name: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/brainstorm/materialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: userText,
            target: { type: "new", name: name || undefined },
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = await res.json() as { space_id: string };
        // Redirect to the new space's whiteboard overview
        router.push(`/app/space/${json.space_id}/whiteboard`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Materialize failed");
        setSubmitting(false);
      }
    },
    [userText, router],
  );

  const handlePickExisting = useCallback(
    async (spaceId: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/brainstorm/materialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: userText,
            target: { type: "existing", space_id: spaceId },
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        router.push(`/app/space/${spaceId}/whiteboard`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Materialize failed");
        setSubmitting(false);
      }
    },
    [userText, router],
  );

  const pickerSpaces: PickerSpace[] = useMemo(() => {
    return (detection?.spaces ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      entity_count: s.entity_count,
    }));
  }, [detection]);

  // ── Compute suggested target from detection — space with most matches ──
  const detectedSuggestedSpaceIds = useMemo(() => {
    if (!detection?.entities_by_space) return [];
    const entries = Object.entries(detection.entities_by_space);
    // Sort spaces by total match count descending; top 2 are suggestions
    entries.sort(([, a], [, b]) => b.length - a.length);
    return entries.slice(0, 2).map(([spaceId]) => spaceId);
  }, [detection]);

  const suggestedIds = useMemo(() => {
    const ids = new Set(detectedSuggestedSpaceIds);
    if (suggestedTargetSpaceId) ids.add(suggestedTargetSpaceId);
    return Array.from(ids);
  }, [detectedSuggestedSpaceIds, suggestedTargetSpaceId]);

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white/85 backdrop-blur-sm px-5 py-3 z-10">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Link href="/app/use-cases" className="inline-flex items-center gap-1 hover:text-gray-700">
            <ArrowLeft className="h-3 w-3" />
            Home
          </Link>
          <span>/</span>
          <span className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <FlaskConical className="h-3 w-3" />
            Brainstorm
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500 italic">cross-space freestyle</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900"
            title={panelOpen ? "Hide detection panel" : "Show detection panel"}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-rose-200 bg-rose-50/70 px-5 py-2 text-[11px] text-rose-800">
          {error}
        </div>
      )}

      {/* Main body */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col bg-gradient-to-br from-slate-50 to-indigo-50/30">
          {/* Empty state / writing area */}
          <div className="flex-1 min-h-0 relative">
            <EmptyBrainstormHint userHasText={userText.length > 0} />
          </div>

          {/* Dock */}
          <PlaygroundDock
            value={userText}
            onChange={setUserText}
            onSubmit={onSubmit}
            deepResearch={deepResearch}
            onToggleDeepResearch={setDeepResearch}
            loading={detectionLoading || submitting}
            placeholder="Type freely. Matches from all your spaces appear on the right. Submit to materialize."
          />
        </div>

        {panelOpen && (
          <div style={{ width: PANEL_WIDTH }} className="flex-shrink-0">
            <BrainstormDetectionPanel
              loading={detectionLoading}
              userText={userText}
              detection={detection}
              onSuggestSpace={setSuggestedTargetSpaceId}
            />
          </div>
        )}
      </div>

      {/* Space picker modal */}
      <SpacePicker
        open={pickerOpen}
        userText={userText}
        spaces={pickerSpaces}
        suggestedSpaceIds={suggestedIds}
        submitting={submitting}
        onCancel={() => setPickerOpen(false)}
        onCreateNew={handleCreateNew}
        onPickExisting={handlePickExisting}
      />
    </div>
  );
}

// ── Empty state ──

function EmptyBrainstormHint({ userHasText }: { userHasText: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-gray-500">
      <div className="relative mb-5">
        <FlaskConical className="h-14 w-14 text-indigo-300" />
        <Network className="h-5 w-5 text-indigo-400 absolute -top-1 -right-1" />
      </div>
      <h2 className="text-xl font-semibold text-gray-800 mb-1">Brainstorm anything</h2>
      <p className="max-w-md text-sm leading-relaxed">
        {userHasText
          ? "Keep going. Matches from all your spaces appear in the panel. When you're ready, submit and pick a destination."
          : "Type a thought, idea, or question in the dock below. As you write, your entire knowledge graph — across all spaces — searches for relevant entities, patterns, and claims."}
      </p>
      <div className="mt-5 flex items-center gap-3 text-[11px] text-gray-400">
        <span>·</span>
        <span>Cross-space search</span>
        <span>·</span>
        <span>Global pattern library</span>
        <span>·</span>
        <span>Explicit destination when you submit</span>
        <span>·</span>
      </div>
    </div>
  );
}
