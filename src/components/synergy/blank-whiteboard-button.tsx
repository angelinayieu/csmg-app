"use client";

// Blank whiteboard entry — POSTs /api/intake/bootstrap with
// skipPipeline=true and experience_mode='brainstorm_speed', then
// routes straight to /app/space/[id]/whiteboard. The canvas lands
// empty; the user drops sticky notes, types concepts, draws arrows,
// and uses the existing lasso-summarize / lasso-chat buttons to run
// LLM insight passes over the clusters they select.
//
// Why brainstorm_speed and not brain_probe: brain_probe routes to
// /triple-lab (a different surface). brainstorm_speed lands on the
// InteraxisCanvas which has the mature lasso toolkit. The
// /app/whiteboard/new redirect that forces brainstorm_speed →
// /app/synergy/new with autopilot=1 is bypassed because we POST
// bootstrap directly and route to the canvas ourselves.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";

export function BlankWhiteboardButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/intake/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: "Blank whiteboard",
          reasoningDepth: "quick",
          reasoning_settings: { experienceMode: "brainstorm_speed" },
          skipPipeline: true,
          skipPlanGate: true,
        }),
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        spaceId?: string;
        error?: string;
      };
      if (!res.ok || !parsed.spaceId) {
        throw new Error(parsed.error ?? `Bootstrap failed (${res.status})`);
      }
      router.push(`/app/space/${parsed.spaceId}/whiteboard`);
    } catch (err) {
      setPending(false);
      const message =
        err instanceof Error ? err.message : "Couldn't open a blank whiteboard";
      toast.error("Couldn't open a blank whiteboard", { description: message });
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="group block w-full rounded-3xl border border-white/60 bg-white/60 px-6 py-5 text-left backdrop-blur-xl transition hover:bg-white/80 disabled:cursor-wait disabled:opacity-70"
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.7), 0 8px 22px -10px rgba(15,23,42,0.10)",
      }}
    >
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Sparkles className="h-5 w-5" strokeWidth={1.75} />
          )}
        </div>
        <div className="flex-1">
          <p className="font-display-tight text-[15px] font-semibold tracking-tight text-gray-900">
            Start a blank whiteboard
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">
            Drop in your own concepts, draw connections, then lasso a
            cluster to converge it with AI insights.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-700"
          strokeWidth={1.75}
        />
      </div>
    </button>
  );
}
