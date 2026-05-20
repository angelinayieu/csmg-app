"use client";

// ── CanvasWorkspaceTemplatePicker (universal-canvas Phase C, Step 5) ──
//
// Workspace-only chrome that turns the four "experience mode" pills
// from the homepage hero into templates the user can launch directly
// from inside their workspace canvas — no homepage round-trip.
//
// The thesis collapsed here: the 4 mode pills (brain_probe,
// brainstorm_speed, precise_rd, digital_twin) ARE templates. Today
// they're scattered across two surfaces (homepage + workspace) with
// the workspace requiring users to leave it to start fresh work.
// This picker gives the workspace its own "Start new" entry that
// runs the same API flows and spawns the resulting artifact as a
// room ON THIS CANVAS instead of forcing a redirect dance.
//
// Behavior per template:
//   brain_probe       → POST /api/intake/bootstrap (skipPipeline=true)
//                       → spawn space room → fullscreen iframe
//   brainstorm_speed  → POST /api/synergy/sessions
//                       → spawn brainstorm room → fullscreen iframe
//                         with autopilot=1
//   precise_rd        → POST /api/intake/bootstrap (full pipeline)
//                       → spawn space room → fullscreen iframe with
//                         ?run=<runId>
//   digital_twin      → same flow as precise_rd; twin reveal
//                       cinematic fires once synthesis completes
//
// Sibling to CanvasWorkspaceRoomPicker — top-right of the canvas.
// "Add room" pins an EXISTING artifact; "Start new" creates one.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  FastForward,
  FlaskConical,
  Layers3,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import {
  EXPERIENCE_MODES,
  type ExperienceMode,
  type ExperienceModeMeta,
} from "@/types/experience-mode";

const ICONS = {
  Brain,
  FastForward,
  FlaskConical,
  Layers3,
} as const;

type LaunchState = null | "creating" | "error";

export function CanvasWorkspaceTemplatePicker() {
  const [open, setOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<ExperienceMode>("precise_rd");
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<LaunchState>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Click-outside dismiss. Mirrors the room picker's behavior so
  // both popovers feel identical.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Focus textarea on open so the user can start typing immediately.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => textareaRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const launch = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || state === "creating") return;
    setState("creating");
    setError(null);
    try {
      if (activeMode === "brainstorm_speed") {
        const res = await fetch("/api/synergy/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            seedText: trimmed,
            title: trimmed.slice(0, 60),
          }),
        });
        if (!res.ok) throw new Error("Couldn't start the brainstorm");
        const json = (await res.json()) as { id?: string; title?: string };
        if (!json.id) throw new Error("No session id returned");
        const title = json.title ?? trimmed.slice(0, 60);
        // Spawn the brainstorm room on this canvas.
        window.dispatchEvent(
          new CustomEvent("canvas-workspace:add-brainstorm", {
            detail: { sessionId: json.id, title },
          }),
        );
        // Open it fullscreen with autopilot=1 — the iframe runs the
        // speedrun rounds while the room persists in the workspace.
        window.dispatchEvent(
          new CustomEvent("canvas-workspace:open-fullscreen", {
            detail: {
              kind: "brainstorm",
              artifactId: json.id,
              title,
              href: `/app/synergy/${json.id}?autopilot=1`,
            },
          }),
        );
      } else {
        // brain_probe / precise_rd / digital_twin all flow through
        // /api/intake/bootstrap; brain_probe sets skipPipeline=true so
        // the lightweight thinking-canvas pattern still applies but
        // the artifact is spawned as a room ON this workspace instead
        // of replacing the user's view.
        const skipPipeline = activeMode === "brain_probe";
        const res = await fetch("/api/intake/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            text: trimmed,
            reasoning_settings: { experienceMode: activeMode },
            skipPipeline,
            skipPlanGate: skipPipeline,
          }),
        });
        if (!res.ok) throw new Error("Couldn't start the space");
        const json = (await res.json()) as {
          spaceId?: string;
          runId?: string | null;
        };
        if (!json.spaceId) throw new Error("Bootstrap did not return a space id");
        const spaceId = json.spaceId;
        const runId = json.runId ?? null;
        const name = trimmed.slice(0, 60);
        window.dispatchEvent(
          new CustomEvent("canvas-workspace:add-space", {
            detail: { spaceId, name },
          }),
        );
        // Open fullscreen so the user sees the pipeline paint inside
        // the iframe; brain_probe simply lands on the empty board.
        const href = runId
          ? `/app/space/${spaceId}/whiteboard?run=${runId}`
          : `/app/space/${spaceId}/whiteboard`;
        window.dispatchEvent(
          new CustomEvent("canvas-workspace:open-fullscreen", {
            detail: { kind: "space", artifactId: spaceId, title: name, href },
          }),
        );
      }
      setState(null);
      setOpen(false);
      setPrompt("");
    } catch (err) {
      console.warn("[workspace-template-picker] launch failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }, [activeMode, prompt, state]);

  return (
    <div ref={popoverRef} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm ring-1 ring-black/[0.06] backdrop-blur-md transition hover:bg-white hover:ring-black/[0.1]"
        title="Start fresh work from a template — same modes as the homepage hero"
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-500" strokeWidth={1.75} />
        Start new
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[420px] overflow-hidden rounded-2xl bg-white/95 shadow-lg ring-1 ring-black/[0.08] backdrop-blur-xl"
          style={{
            boxShadow:
              "0 20px 50px -24px rgba(15,23,42,0.2), inset 0 1px 0 rgba(255,255,255,0.7)",
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.04] px-4 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Start new from template
            </span>
            <button
              onClick={() => setOpen(false)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/[0.04] hover:text-gray-700"
              title="Close"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>

          {/* Template tiles — compact 2x2 grid. Same EXPERIENCE_MODES
              source as the homepage hero so the templates stay in
              lockstep with the pills (taglines, accents, descriptions
              update in one place). */}
          <div className="grid grid-cols-2 gap-2 p-3">
            {EXPERIENCE_MODES.map((m) => {
              const Icon = ICONS[m.icon];
              const active = m.id === activeMode;
              return (
                <button
                  key={m.id}
                  onClick={() => setActiveMode(m.id)}
                  className="group relative flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left transition"
                  style={{
                    background: active
                      ? `linear-gradient(135deg, ${m.accentSoft}, rgba(255, 255, 255, 0.55))`
                      : "rgba(255, 255, 255, 0.6)",
                    borderColor: active
                      ? `${m.accent}55`
                      : "rgba(15, 23, 42, 0.06)",
                    boxShadow: active
                      ? `inset 0 1px 0 rgba(255,255,255,0.75), 0 4px 14px -8px ${m.accent}55`
                      : "inset 0 1px 0 rgba(255,255,255,0.6)",
                  }}
                  title={m.description}
                >
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                    style={{
                      background: active ? m.accent : "rgba(15, 23, 42, 0.06)",
                      color: active ? "white" : "rgb(55, 65, 81)",
                    }}
                  >
                    <Icon className="h-3 w-3" strokeWidth={2} />
                  </span>
                  <span
                    className="text-[12px] font-semibold leading-tight"
                    style={{ color: active ? m.accent : "rgb(31, 41, 55)" }}
                  >
                    {m.label}
                  </span>
                  <span className="text-[10.5px] leading-snug text-gray-500">
                    {m.tagline}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Prompt input + Start button */}
          <div className="border-t border-black/[0.04] p-3">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 1400))}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void launch();
                }
              }}
              placeholder={placeholderFor(
                EXPERIENCE_MODES.find((m) => m.id === activeMode) ?? null,
              )}
              rows={3}
              disabled={state === "creating"}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-[13px] leading-snug text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:opacity-60"
            />
            {error && (
              <p className="mt-2 text-[11px] text-rose-600">{error}</p>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-gray-400">
                ⌘ Enter to launch
              </span>
              <button
                onClick={() => void launch()}
                disabled={!prompt.trim() || state === "creating"}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state === "creating" ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" strokeWidth={2} />
                    Start
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-mode placeholder so the textarea hints at what kind of input
// works best for the active template.
function placeholderFor(mode: ExperienceModeMeta | null): string {
  if (!mode) return "What are you working through?";
  switch (mode.id) {
    case "brain_probe":
      return "Type a question or topic — the probe will ask follow-ups.";
    case "brainstorm_speed":
      return "Describe your goal — autopilot will brainstorm in rounds.";
    case "precise_rd":
      return "Describe the situation or outcome you want to investigate.";
    case "digital_twin":
      return "Describe the system you want to model causally.";
  }
}
