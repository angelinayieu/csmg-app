// ── Strategy-from-prompt client ──
//
// Two visual states:
//   1. Idle: ambient bg + prompt textarea + "Generate strategy" CTA
//   2. Generating: ambient bg + multi-stage crystallization splash
//      (Brainstorming → Distilling → Crystallizing) with shimmer
//      bars; total ~8-25s while the orchestrator endpoint runs.
//
// On success: navigates to /app/synergy/[session_id]/strategy with
// ?fresh=1 so the strategy page can fire its staggered fade-in
// animation (treats it like a just-generated doc).

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Cog,
  FileText,
  Loader2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { toast } from "@/lib/hooks/use-toast";
import { SynergyAmbientBg } from "@/components/synergy/synergy-ambient-bg";
import { SynergyGlassDock } from "@/components/synergy/synergy-glass-dock";

interface Props {
  initialPrompt: string;
}

type Stage = "idle" | "brainstorming" | "distilling" | "crystallizing";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  brainstorming: "Brainstorming the space",
  distilling: "Distilling components",
  crystallizing: "Crystallizing strategy",
};

const STAGE_SUB: Record<Exclude<Stage, "idle">, string> = {
  brainstorming:
    "Synthesizing what a converged whiteboard would look like for this prompt.",
  distilling:
    "Typing upstream needs, downstream outputs, polished products.",
  crystallizing:
    "Drafting statement, plan, risks, hypotheses. Mirroring the synthesized plan.",
};

export function StrategyNewClient({ initialPrompt }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [stage, setStage] = useState<Stage>("idle");

  // Auto-kick if we arrived from the dashboard hero with a prompt
  // pre-filled. The query param signals user intent.
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim().length >= 10) {
      void generate(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async (input: string) => {
    if (stage !== "idle") return;
    const text = input.trim();
    if (text.length < 10) {
      toast.error("Prompt too short", {
        description: "Describe what you're building in at least one sentence.",
      });
      return;
    }
    // Visual cascade: brainstorming → distilling → crystallizing.
    // We DON'T tie the stage progression to backend SSE here — the
    // orchestrator returns one response when everything's done. We
    // run a scripted cascade with reasonable timings so the user
    // sees motion at expected intervals (8s / 12s / 22s).
    setStage("brainstorming");
    const stageTimers: number[] = [];
    stageTimers.push(window.setTimeout(() => setStage("distilling"), 8500));
    stageTimers.push(window.setTimeout(() => setStage("crystallizing"), 17000));

    try {
      const res = await fetch("/api/synergy/strategy-from-prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          partial?: { session_id?: string };
          stage_failed?: string;
        };
        if (body.partial?.session_id) {
          // Partial success — at least the session was created.
          // Send the user there so they can continue manually.
          toast.error(
            `Generation failed at "${body.stage_failed ?? "later stage"}"`,
            {
              description:
                "Your synthesized whiteboard was saved. You can continue manually.",
            },
          );
          router.push(`/app/synergy/${body.partial.session_id}`);
          return;
        }
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as {
        session_id: string;
        strategy_id: string;
        components_count: number;
      };
      toast.success("Strategy ready", {
        description: `Generated from your prompt — ${body.components_count} components published.`,
      });
      router.push(`/app/synergy/${body.session_id}/strategy?fresh=1`);
    } catch (e) {
      toast.error("Strategy generation failed", {
        description: (e as Error).message,
      });
      setStage("idle");
    } finally {
      for (const t of stageTimers) window.clearTimeout(t);
    }
  };

  return (
    <>
      <SynergyAmbientBg />
      <main className="relative z-10 min-h-screen pb-32">
        <div className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
          {/* Back link */}
          <div className="mb-6">
            <Link
              href="/app"
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 backdrop-blur px-3 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400"
            >
              <ArrowLeft className="h-3 w-3" /> Home
            </Link>
          </div>

          {stage === "idle" ? (
            <IdleView prompt={prompt} setPrompt={setPrompt} onGenerate={() => void generate(prompt)} />
          ) : (
            <CrystallizingView stage={stage} prompt={prompt} />
          )}
        </div>
        <SynergyGlassDock />
      </main>
    </>
  );
}

// ── Idle state ──

function IdleView({
  prompt,
  setPrompt,
  onGenerate,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  onGenerate: () => void;
}) {
  return (
    <>
      <div className="text-center">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 shadow-[0_12px_32px_-8px_rgba(99,102,241,0.5)]">
          <FileText className="h-6 w-6 text-white" />
        </div>
        <h1
          className="font-semibold tracking-tight text-gray-900"
          style={{ fontSize: "clamp(32px, 4.5vw, 48px)", letterSpacing: "-0.02em" }}
        >
          Generate a strategy from a prompt
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600">
          Describe what you&apos;re building, exploring, or pursuing. We&apos;ll
          synthesize a converged brainstorm, distill typed components, and
          crystallize a living strategy doc.
        </p>
      </div>

      <div
        className="mt-10 rounded-2xl"
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.6)",
          boxShadow: [
            "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
            "0 1px 2px rgba(15, 23, 42, 0.04)",
            "0 16px 40px -12px rgba(15, 23, 42, 0.12)",
            "0 0 60px -16px rgba(99, 102, 241, 0.35)",
          ].join(", "),
        }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onGenerate();
            }
          }}
          rows={6}
          maxLength={2000}
          placeholder="e.g. Build a triage AI that prioritizes urgent MRI cases for radiologists in academic medical centers. Reduce time-to-diagnosis by 30% in 6 months."
          className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 text-[15px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400"
        />
        <div className="flex items-center justify-between gap-3 border-t border-gray-200/50 px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
            {prompt.trim().length < 10
              ? "needs at least 10 chars"
              : `${prompt.length} / 2000 chars · ⌘+Enter to generate`}
          </span>
          <button
            onClick={onGenerate}
            disabled={prompt.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)] transition hover:scale-[1.02] disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate strategy
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-gray-500">
        Takes ~20-30 seconds. Your synthesized whiteboard and components are
        saved — you can refine everything afterward.
      </p>
    </>
  );
}

// ── Crystallizing state ──

function CrystallizingView({
  stage,
  prompt,
}: {
  stage: Exclude<Stage, "idle">;
  prompt: string;
}) {
  const stageOrder: Array<Exclude<Stage, "idle">> = [
    "brainstorming",
    "distilling",
    "crystallizing",
  ];
  const currentIdx = stageOrder.indexOf(stage);

  return (
    <div
      className="rounded-3xl p-10 text-center"
      style={{
        background: "rgba(255, 255, 255, 0.78)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.6)",
        boxShadow: [
          "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
          "0 16px 40px -12px rgba(15, 23, 42, 0.15)",
          "0 0 80px -16px rgba(99, 102, 241, 0.4)",
        ].join(", "),
      }}
    >
      {/* Pulsing orb */}
      <div className="relative mx-auto mb-6 inline-block">
        <div
          className="absolute inset-0 -m-8 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(99, 102, 241, 0.4), transparent 60%)",
            animation: "strategyOrbPulse 2.2s ease-in-out infinite",
          }}
        />
        <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 shadow-lg">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
      </div>

      <h2
        className="font-semibold tracking-tight text-gray-900"
        style={{ fontSize: "clamp(24px, 3.5vw, 32px)", letterSpacing: "-0.02em" }}
      >
        {STAGE_LABEL[stage]}…
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-gray-600">
        {STAGE_SUB[stage]}
      </p>

      {/* Stage cascade */}
      <ol className="mt-8 inline-flex flex-col items-start gap-2 text-left">
        {stageOrder.map((s, i) => {
          const isCurrent = s === stage;
          const isDone = i < currentIdx;
          const isFuture = i > currentIdx;
          return (
            <li key={s} className="flex items-center gap-2">
              {isDone ? (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : isCurrent ? (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
                  <Loader2 className="h-3 w-3 animate-spin" />
                </span>
              ) : (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400">
                  <Cog className="h-3 w-3" />
                </span>
              )}
              <span
                className={
                  isFuture
                    ? "text-[12px] text-gray-400"
                    : isCurrent
                      ? "text-[12px] font-semibold text-indigo-700"
                      : "text-[12px] text-gray-700"
                }
              >
                {STAGE_LABEL[s]}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Shimmer bars */}
      <div className="mt-8 space-y-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-2.5 overflow-hidden rounded bg-gray-100"
            style={{
              animation: `strategyShimmerBar 1.8s ease-in-out infinite`,
              animationDelay: `${i * 0.18}s`,
              background:
                "linear-gradient(90deg, rgba(243,244,246,0.6) 0%, rgba(199, 210, 254, 0.95) 50%, rgba(243,244,246,0.6) 100%)",
              backgroundSize: "200% 100%",
            }}
          />
        ))}
      </div>

      {/* Echo of the prompt */}
      <div className="mt-8 rounded-xl border border-gray-200/60 bg-white/60 px-4 py-3 text-left">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
          Your prompt
        </div>
        <p className="line-clamp-3 text-[12px] leading-relaxed text-gray-800">
          {prompt}
        </p>
      </div>

      <style jsx>{`
        @keyframes strategyOrbPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.18); }
        }
        @keyframes strategyShimmerBar {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
