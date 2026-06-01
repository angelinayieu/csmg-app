"use client";

// ── Pre-Room Spine ─────────────────────────────────────────────────
//
// The decision surface that sits directly under the core objective,
// BEFORE the user enters any room. It makes the v1 → v2 model legible
// in one bar:
//
//   • v1 skeleton = the rooms + features auto-generated on approval
//     (RoomFillRunner, mounted in the header). This bar reflects that
//     state in its lead line — leads with the result, not the process.
//   • "Generate tech spec" = compile the v1 build spec from everything
//     generated so far. Reuses the SAME path the Strategy Brief uses
//     (POST /api/brainstorm/space/[id]/agent-spec → AgentBuildSpecPanel);
//     it was buried two layers down in the brief, surfaced here as a
//     primary action.
//   • "Deepen → v2" = run the across-rooms optimization pass
//     (CanvasAutopilotRunner — the existing engine, untouched). The
//     codebase already calls its deep mechanism-spec output "v2"
//     (canvas-autopilot-runner.tsx ~L1275), so framing autopilot as the
//     deepen/v2 path matches existing terminology rather than inventing
//     a parallel concept.
//
// Slice 1 of the objective-gen consolidation: surface the spine + the
// two forward actions, reusing existing engines. The situation-model
// centerpiece + the version/complexity timeline land in later slices.

import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, Layers } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { AgentBuildSpecPanel } from "@/components/objective/agent-build-spec-panel";
import type { AgentBuildSpec } from "@/lib/objective-canvas/compile-agent-build-spec";
import { CanvasAutopilotRunner } from "@/components/objective/canvas-autopilot-runner";

interface PreRoomSpineProps {
  spaceId: string;
  /** Rooms whose internal content has been generated — the targets the
   *  deepen pass can optimize. Empty until the v1 skeleton fills. */
  generatedRooms: { id: string; title: string }[];
  /** Total sub-objectives (generated or not) — drives the v1 state line. */
  totalRooms: number;
  /** Called when a deepen run completes — parent refreshes the canvas. */
  onDeepenComplete: () => void;
}

export function PreRoomSpine({
  spaceId,
  generatedRooms,
  totalRooms,
  onDeepenComplete,
}: PreRoomSpineProps) {
  const [specBusy, setSpecBusy] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [spec, setSpec] = useState<AgentBuildSpec | null>(null);
  const [specMd, setSpecMd] = useState("");
  const [specOpen, setSpecOpen] = useState(false);

  const generatedCount = generatedRooms.length;
  const skeletonReady = totalRooms > 0 && generatedCount >= totalRooms;
  const canDeepen = generatedCount > 0;

  const handleGenerateSpec = useCallback(async () => {
    setSpecBusy(true);
    setSpecError(null);
    try {
      const res = await fetch(`/api/brainstorm/space/${spaceId}/agent-spec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => ({}))) as {
        spec?: AgentBuildSpec;
        markdown?: string;
        error?: string;
      };
      if (!res.ok || !json.spec) {
        setSpecError(json.error ?? "Couldn't compile the build spec.");
        return;
      }
      setSpec(json.spec);
      setSpecMd(json.markdown ?? "");
      setSpecOpen(true);
    } catch (err) {
      setSpecError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSpecBusy(false);
    }
  }, [spaceId]);

  const handleDeepenComplete = useCallback(async () => {
    // Record the iteration: a STRUCTURE snapshot (KG growth) + a TWIN
    // snapshot (exact health value the timeline aligns by time). Both
    // soft-fail and never block the post-deepen refresh. allSettled so one
    // failing doesn't skip the other.
    await Promise.allSettled([
      fetch(`/api/brainstorm/space/${spaceId}/structure-snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "deepen" }),
      }),
      // Twin capture — a deepen is an intervention on the structure, so a
      // fresh health reading belongs here. Idempotent on root_hash.
      fetch(`/api/spaces/${spaceId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "post_intervention" }),
      }),
    ]);
    onDeepenComplete();
  }, [spaceId, onDeepenComplete]);

  // Capture a v1 baseline once the skeleton is ready (before any deepen), so
  // the situation-model timeline has a true starting point and the first
  // deepen shows a real delta. Fires once per mount; server-deduped + soft-fail.
  const baselineFired = useRef(false);
  useEffect(() => {
    if (!skeletonReady || baselineFired.current) return;
    baselineFired.current = true;
    // Baseline: structure snapshot (KG starting point) + twin snapshot
    // (baseline health value), so the first deepen shows a real delta.
    fetch(`/api/brainstorm/space/${spaceId}/structure-snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "auto" }),
    }).catch(() => {});
    fetch(`/api/spaces/${spaceId}/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "user_request" }),
    }).catch(() => {});
  }, [skeletonReady, spaceId]);

  return (
    <>
      {specOpen && spec && (
        <AgentBuildSpecPanel
          spaceId={spaceId}
          spec={spec}
          markdown={specMd}
          onClose={() => setSpecOpen(false)}
        />
      )}

      <div className="mx-auto mt-5 w-full max-w-3xl">
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{
            background: appleVibe.surface.card,
            border: `1px solid ${appleVibe.stroke.soft}`,
            boxShadow: appleVibe.shadow.card,
          }}
        >
          {/* Left — v1 skeleton state. Lead with the result, not the process. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
              style={{
                background: appleVibe.surface.chip,
                border: `1px solid ${appleVibe.stroke.hairline}`,
              }}
              aria-hidden
            >
              <Layers
                className="h-3.5 w-3.5"
                strokeWidth={2}
                style={{ color: appleVibe.text.secondary }}
              />
            </span>
            <div className="min-w-0 leading-tight">
              <div
                className="text-[12.5px] font-semibold"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.01em",
                }}
              >
                {skeletonReady
                  ? `v1 skeleton ready · ${generatedCount} ${generatedCount === 1 ? "room" : "rooms"}`
                  : `Building v1 skeleton · ${generatedCount}/${totalRooms}`}
              </div>
              <div
                className="truncate text-[11px]"
                style={{ color: appleVibe.text.tertiary }}
              >
                {skeletonReady
                  ? "Your objective + features are structured. Ship the spec, or deepen the mechanisms."
                  : "Rooms are generating their pain → mechanism → outcome content…"}
              </div>
            </div>
          </div>

          {/* Right — the two forward actions: use v1, or deepen to v2. */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateSpec}
              disabled={specBusy}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: appleVibe.surface.chip,
                border: `1px solid ${appleVibe.stroke.soft}`,
                color: appleVibe.text.primary,
                boxShadow: appleVibe.shadow.chip,
              }}
              title="Compile the v1 implementation spec from everything generated so far"
            >
              <FileCode2
                className={`h-3.5 w-3.5${specBusy ? " animate-pulse" : ""}`}
                strokeWidth={2}
              />
              {specBusy ? "Compiling…" : "Generate tech spec"}
            </button>

            {/* Deepen → v2 — the across-rooms optimization pass. The
                eyebrow labels the action category; the autopilot pill
                below is the actual control (reused untouched). */}
            {canDeepen ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] sm:inline"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Deepen → v2
                </span>
                <CanvasAutopilotRunner
                  spaceId={spaceId}
                  rooms={generatedRooms}
                  onAllComplete={handleDeepenComplete}
                />
              </div>
            ) : (
              <span
                className="text-[11px] italic"
                style={{ color: appleVibe.text.tertiary }}
              >
                Deepen unlocks once rooms finish building
              </span>
            )}
          </div>
        </div>

        {specError && (
          <div
            className="mt-2 rounded-lg px-3 py-2 text-[11.5px]"
            style={{
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.18)",
              color: "rgba(127,29,29,0.95)",
            }}
            role="alert"
          >
            {specError}
          </div>
        )}
      </div>
    </>
  );
}
