// ── Synergy dashboard hero — experience pills + glass chatbox ──
//
// Lays out:
//   - InterAxis logo + wordmark (top-center)
//   - Time-aware greeting + subtitle
//   - 4 experience pills (Brain Probe · Brainstorm Speedrun ·
//     Precise R&D · Build Digital Twin) — hover for explanation
//   - Glass chatbox with: textarea, voice orb button, integration
//     row (5 inline logos + "•••" popover), submit button
//   - Reasoning settings disclosure
//
// Submit flow:
//   1. Validate prompt length (>= 6 chars)
//   2. If "ask clarifying questions" is on, open the flashcard modal
//      to pull 3 sharpening Qs. The modal returns a refined prompt.
//      The rolling-cube loader appears in-place while we route.
//   3. Forward to the selected experience mode's destination route
//      with the refined prompt as the appropriate query field +
//      `?mode=<id>` for downstream wiring.
//
// The mic still opens the existing voice orb overlay. The voice
// flow bypasses the clarifier — voice users want momentum.

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mic } from "lucide-react";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import { VoiceOrbOverlay } from "@/components/synergy/voice-orb-overlay";
import { DashboardExperiencePills } from "@/components/synergy/dashboard-experience-pills";
import { DashboardIntegrationRow } from "@/components/synergy/dashboard-integration-row";
import { DashboardReasoningDisclosure } from "@/components/synergy/dashboard-reasoning-disclosure";
import {
  DashboardClarifyModal,
  type DashboardClarifyResult,
} from "@/components/synergy/dashboard-clarify-modal";
import {
  EXPERIENCE_MODES,
  type ExperienceMode,
} from "@/types/experience-mode";
import {
  DEFAULT_REASONING_SETTINGS,
  type ReasoningSettings,
} from "@/types/reasoning-settings";
import { toast } from "@/lib/hooks/use-toast";

// Minimum perceptual airtime for the rolling-cube loader. Without
// it, fast bootstraps blink and feel jarring; the modal's loader is
// part of the dashboard's deliberate motion design.
const LOADER_FLOOR_MS = 380;

interface Props {
  greeting: string;
  firstName: string;
}

type SubmitState = null | "clarifying" | "routing";

export function SynergyDashboardHero({ greeting, firstName }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ExperienceMode>("brain_probe");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasoning, setReasoning] = useState<ReasoningSettings>({
    ...DEFAULT_REASONING_SETTINGS,
    // Dashboard default: clarifier ON so submits funnel through the
    // sharpening modal. Power users can turn it off in the panel.
    askClarifyingQuestions: true,
  });
  const [submitState, setSubmitState] = useState<SubmitState>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeMeta =
    EXPERIENCE_MODES.find((m) => m.id === mode) ?? EXPERIENCE_MODES[0];

  const handleSubmit = () => {
    if (submitState) return;
    const trimmed = text.trim();
    if (trimmed.length < 6) {
      toast.info("Tell us a bit more first", {
        description: "Six characters minimum — even a phrase is enough.",
      });
      inputRef.current?.focus();
      return;
    }
    if (reasoning.askClarifyingQuestions) {
      setSubmitState("clarifying");
    } else {
      void routeToDestination({
        refinedPrompt: trimmed,
        baseline: null,
        answers: [],
      });
    }
  };

  const cancelInFlight = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitState(null);
    setRouteError(null);
  };

  // Universal-canvas Phase C: every pill submission routes via the
  // user's workspace, with the new artifact materialized as a room
  // there. The previous flow (direct land-in-new-space) is preserved
  // ONLY for brain_probe, which is intentionally lightweight — a fast
  // empty thinking-canvas with no workspace overhead.
  //
  // Flow per pill:
  //   brain_probe       → create space → land in new space's whiteboard (legacy)
  //   brainstorm_speed  → create brainstorm session → land in workspace,
  //                       spawn brainstorm room, fullscreen iframe of
  //                       synergy whiteboard with ?autopilot=1
  //   precise_rd        → create space (pipeline) → land in workspace,
  //                       spawn space room, fullscreen iframe of the new
  //                       space's whiteboard so the user watches the pipeline
  //                       paint while the room sits in workspace
  //   digital_twin      → same as precise_rd; the new space's twin reveal
  //                       cinematic fires inside the iframe
  const routeToDestination = async (result: DashboardClarifyResult) => {
    setSubmitState("routing");
    setRouteError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Brain Probe keeps its lightweight legacy flow — land directly
      // in the new space's whiteboard, no workspace round-trip. This
      // pill is for fast no-commitment thinking; the workspace canvas
      // adds an extra hop that doesn't fit.
      if (mode === "brain_probe") {
        const fetchPromise = fetch("/api/intake/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            text: result.refinedPrompt,
            reasoningDepth: reasoning.depth,
            reasoning_settings: { ...reasoning, experienceMode: mode },
            skipPipeline: true,
            skipPlanGate: true,
            clarifying_qa_pairs: result.answers,
            inferred_baseline: result.baseline,
          }),
        });
        const [res] = await Promise.all([
          fetchPromise,
          new Promise((r) => setTimeout(r, LOADER_FLOOR_MS)),
        ]);
        const raw = await res.text();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(
            (parsed?.error as string | undefined) ??
              `Bootstrap failed (${res.status})`,
          );
        }
        const spaceId = parsed?.spaceId as string | undefined;
        if (!spaceId) throw new Error("Bootstrap did not return a space id");
        abortRef.current = null;
        router.push(`/app/space/${spaceId}/whiteboard`);
        return;
      }

      // For brainstorm_speed / precise_rd / digital_twin: ensure the
      // workspace exists, then create the artifact, then route to the
      // workspace with spawn params so the room materializes there.
      const workspacePromise = fetch("/api/workspace/ensure", {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
      });

      let spawnKind: "brainstorm" | "space";
      let artifactId: string;
      let artifactName: string;
      let artifactRunId: string | null = null;
      let fullscreenQuery: string | null = null;

      if (mode === "brainstorm_speed") {
        // POST /api/synergy/sessions creates the brainstorm row and
        // (if seedText is provided) seeds a core node so the user
        // lands on a non-empty board. Autopilot fires when the
        // synergy page reads ?autopilot=1.
        //
        // clarifying_qa_pairs are persisted to brainstorm_sessions.
        // clarifier_qa so the autopilot round handler can inject
        // them as soft constraints into each round's LLM context
        // (variations / decompose / rank / converge). Without this
        // pass-through, the homepage MCQ work is invisible to the
        // speedrun — answers reach the seed only via the prompt
        // suffix, not as structured slot-typed assertions.
        const sessRes = await fetch("/api/synergy/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            seedText: result.refinedPrompt,
            title: result.refinedPrompt.slice(0, 60),
            clarifying_qa_pairs: result.answers,
          }),
        });
        if (!sessRes.ok) throw new Error("Couldn't create the brainstorm");
        const sessJson = (await sessRes.json()) as {
          id?: string;
          title?: string;
        };
        if (!sessJson.id) throw new Error("No session id returned");
        spawnKind = "brainstorm";
        artifactId = sessJson.id;
        artifactName = sessJson.title ?? result.refinedPrompt.slice(0, 60);
        // Autopilot inside the fullscreen iframe.
        fullscreenQuery = "autopilot=1";
      } else {
        // precise_rd + digital_twin: full intake/bootstrap (pipeline).
        const fetchPromise = fetch("/api/intake/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            text: result.refinedPrompt,
            reasoningDepth: reasoning.depth,
            reasoning_settings: { ...reasoning, experienceMode: mode },
            skipPipeline: false,
            clarifying_qa_pairs: result.answers,
            inferred_baseline: result.baseline,
          }),
        });
        const [res] = await Promise.all([
          fetchPromise,
          new Promise((r) => setTimeout(r, LOADER_FLOOR_MS)),
        ]);
        const raw = await res.text();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(
            (parsed?.error as string | undefined) ??
              `Bootstrap failed (${res.status})`,
          );
        }
        const spaceId = parsed?.spaceId as string | undefined;
        const runId = (parsed?.runId as string | null | undefined) ?? null;
        if (!spaceId) throw new Error("Bootstrap did not return a space id");
        spawnKind = "space";
        artifactId = spaceId;
        artifactName = result.refinedPrompt.slice(0, 60);
        artifactRunId = runId;
        if (runId) fullscreenQuery = `run=${runId}`;
      }

      // Resolve the workspace now (we kicked it off in parallel above).
      const workspaceRes = await workspacePromise;
      if (!workspaceRes.ok) {
        throw new Error("Couldn't open your workspace");
      }
      const workspaceJson = (await workspaceRes.json()) as {
        workspace?: { id: string };
      };
      const workspaceId = workspaceJson.workspace?.id;
      if (!workspaceId) throw new Error("No workspace id");

      const params = new URLSearchParams();
      params.set("spawn", spawnKind);
      params.set("id", artifactId);
      params.set("name", artifactName);
      params.set("fullscreen", "1");
      if (artifactRunId) params.set("runArtifactId", artifactRunId);
      if (fullscreenQuery) params.set("fullscreenQuery", fullscreenQuery);

      abortRef.current = null;
      router.push(`/app/space/${workspaceId}/whiteboard?${params.toString()}`);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      abortRef.current = null;
      const message =
        err instanceof Error ? err.message : "Couldn't start your space";
      console.error("[dashboard-hero] bootstrap failed:", err);
      setRouteError(message);
      // Drop back into the clarifying step so the modal renders the
      // inline error with a Retry. The modal's `routeError` prop
      // unblocks the picker so the user keeps their answers.
      setSubmitState("clarifying");
    }
  };

  return (
    <section className="relative">
      {/* Logo + wordmark */}
      <div className="flex justify-center">
        <div
          className="inline-flex items-center gap-2.5 rounded-full px-3 py-1.5"
          style={{
            background: "rgba(255, 255, 255, 0.55)",
            backdropFilter: "blur(18px) saturate(180%)",
            WebkitBackdropFilter: "blur(18px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.6)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 14px -6px rgba(15,23,42,0.08)",
          }}
        >
          <InterAxisLogo className="h-6 w-6" size={48} />
          <span className="font-display-tight text-[15px] font-semibold tracking-tight text-gray-900">
            InterAxis
          </span>
        </div>
      </div>

      <h1
        className="mt-6 text-center font-semibold tracking-tight text-gray-900"
        style={{ fontSize: "clamp(36px, 5.5vw, 60px)", letterSpacing: "-0.02em" }}
      >
        {greeting}, {firstName}
      </h1>
      <p className="mt-3 text-center text-[18px] leading-snug text-gray-600">
        What are you working through today?
      </p>

      {/* Experience pills */}
      <div className="mt-7">
        <DashboardExperiencePills
          active={mode}
          onChange={setMode}
          disabled={submitState !== null}
        />
      </div>

      {/* Glass chatbox */}
      <div className="mx-auto mt-5 max-w-2xl">
        <div
          className="relative rounded-3xl"
          style={{
            background: "rgba(255, 255, 255, 0.78)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            border: `1px solid ${activeMeta.accent}33`,
            boxShadow: [
              "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
              "0 1px 2px rgba(15, 23, 42, 0.04)",
              "0 18px 44px -14px rgba(15, 23, 42, 0.14)",
              `0 0 70px -22px ${activeMeta.accentSoft}`,
            ].join(", "),
            transition: "border 220ms ease, box-shadow 220ms ease",
          }}
        >
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1400))}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={`Describe what you want to ${activeMeta.id === "digital_twin" ? "model" : "work through"}. ⌘+Enter to begin.`}
            rows={3}
            disabled={submitState !== null}
            className="block w-full resize-none rounded-3xl bg-transparent px-6 pt-5 pb-2 text-[16px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-60"
          />

          {/* Bottom row: integration logos + voice + submit */}
          <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-2">
            <DashboardIntegrationRow />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVoiceOpen(true)}
                disabled={submitState !== null}
                title="Speak — opens the voice orb"
                aria-label="Open voice orb"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-gray-800 disabled:opacity-60"
                style={{ boxShadow: "0 4px 14px -4px rgba(15, 23, 42, 0.25)" }}
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitState !== null || text.trim().length < 6}
                aria-label={`Begin ${activeMeta.label}`}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: `linear-gradient(135deg, ${activeMeta.accent}, ${shade(activeMeta.accent, -16)})`,
                  boxShadow: `0 6px 22px -8px ${activeMeta.accent}90`,
                }}
              >
                Begin
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-gray-500">
          {activeMeta.tagline} ·{" "}
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
            ⌘ + Enter to begin
          </span>
        </p>

        {/* Reasoning settings — collapsed by default */}
        <div className="mt-3 flex justify-center">
          <DashboardReasoningDisclosure
            open={reasoningOpen}
            onToggle={() => setReasoningOpen((v) => !v)}
            settings={reasoning}
            onChange={setReasoning}
            disabled={submitState !== null}
          />
        </div>
      </div>

      {/* Voice orb — bypasses the clarifier; voice users want flow */}
      <VoiceOrbOverlay open={voiceOpen} onClose={() => setVoiceOpen(false)} />

      {/* Clarify-then-route modal. Mounted only while a submit is
          in flight so re-opening with a different prompt remounts
          fresh state. busy=true once we've started routing so the
          user sees the rolling cube + status. routeError surfaces
          bootstrap failures inline so the user can retry without
          losing their refined prompt + MCQ answers. */}
      {submitState !== null && (
        <DashboardClarifyModal
          prompt={text.trim()}
          mode={mode}
          busy={submitState === "routing"}
          busyLabel={`Routing to ${activeMeta.label}`}
          routeError={routeError}
          onCancel={cancelInFlight}
          onContinue={(r) => void routeToDestination(r)}
        />
      )}
    </section>
  );
}

function shade(hex: string, deltaPct: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adj = (v: number) => {
    const next = Math.round(v + (deltaPct * 255) / 100);
    return Math.max(0, Math.min(255, next))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${adj(r)}${adj(g)}${adj(b)}`;
}
