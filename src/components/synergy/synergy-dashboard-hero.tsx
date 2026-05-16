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

  const routeToDestination = async (result: DashboardClarifyResult) => {
    setSubmitState("routing");
    const { destination } = activeMeta;
    const params = new URLSearchParams();
    params.set(destination.promptField, result.refinedPrompt);
    params.set("mode", mode);
    if (reasoning.lenses.length > 0) {
      params.set("lenses", reasoning.lenses.join(","));
    }
    if (reasoning.buildBaselineFirst) params.set("baseline", "1");
    if (!reasoning.showAlternatives) params.set("single", "1");
    if (result.baseline) {
      // The destination can read this hint to pre-fill an objective
      // statement card if it wants — keep payload small.
      params.set("objective", result.baseline.primary_objective.slice(0, 200));
    }
    // Brief delay so the rolling-cube loader is visible long enough
    // to feel intentional; otherwise destinations that render fast
    // produce a jarring blink. 380ms hits the perceptual sweet spot.
    await new Promise((r) => setTimeout(r, 380));
    router.push(`${destination.route}?${params.toString()}`);
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
          user sees the rolling cube + status. */}
      {submitState !== null && (
        <DashboardClarifyModal
          prompt={text.trim()}
          mode={mode}
          busy={submitState === "routing"}
          busyLabel={`Routing to ${activeMeta.label}`}
          onCancel={() => setSubmitState(null)}
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
