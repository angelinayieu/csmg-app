"use client";

// ── SeedMount ──
//
// Headless ORCHESTRATOR for the objective seed. Quality-first: it gets the
// reasoning STARTED and builds the seed once it converges, but it does NOT
// auto-answer the founder's questions — the SeedChat does, with the founder's
// real input (auto-answers produce generic reasoning; the input is the value).
//   1. waits for sharpening (PromptSharpeningMount drives it → internal metadata)
//   2. starts the Crucible + advances RESEARCH-only rounds (the agent self-
//      answers factual questions). It STOPS at the first founder-question and
//      waits — the objective card hints "answer a few questions", which opens
//      the chat.
//   3. polls; the MOMENT the loop converges (via chat), POSTs /seed enrich
//      (assemble internal + web-grounded value engine + distill external).
//
// Idempotent: a `get` short-circuit skips once a seed is ready. Mounted once in
// the objective layout (minimal mode), beside PromptSharpeningMount.

import { useEffect, useRef } from "react";
import { openSeedChat } from "@/lib/objective-canvas/seed/seed-chat-signal";
import { onStartSeedAutoBuild } from "@/lib/objective-canvas/seed/seed-autobuild-signal";

export function SeedMount({ spaceId }: { spaceId: string }) {
  const started = useRef(false);
  const autoRunning = useRef(false);

  useEffect(() => {
    if (!spaceId || started.current) return;
    started.current = true;
    let cancelled = false;
    let builtFor = ""; // guard: only enrich once per convergence

    // Open the chat at most once per browser session for this objective.
    function maybeAutoOpenChat() {
      try {
        const key = `seed-chat-auto:${spaceId}`;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        /* private mode — fall through and open anyway */
      }
      openSeedChat(spaceId);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function post(action: string, route: "seed" | "crucible", body: any = {}): Promise<any> {
      try {
        const r = await fetch(`/api/objective/${spaceId}/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...body }),
          cache: "no-store",
        });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    }

    async function kickoff() {
      const cur = await post("get", "seed");
      if (cancelled || cur?.seed?.status === "ready") return;
      // Let sharpening land first (it drives synthesis_data internal metadata).
      await new Promise((r) => setTimeout(r, 4500));
      if (cancelled) return;
      // Start the Crucible + advance research-only rounds; stop at awaiting_user.
      let state = (await post("start", "crucible"))?.state;
      let guard = 0;
      while (state && state.status === "working" && guard < 8) {
        guard += 1;
        if (cancelled) return;
        state = (await post("continue", "crucible"))?.state;
      }
      // The moment the agent has questions for the founder, surface the chat ONCE
      // (sessionStorage-guarded so we don't reopen it on every visit). The founder
      // shouldn't have to discover the button — the questions ARE the value.
      if (!cancelled && state?.status === "awaiting_user") {
        maybeAutoOpenChat();
      }
      // From here the founder answers via SeedChat; the poller below builds the
      // seed when the loop converges.
    }

    // Poll for convergence (however it converges — chat or research-only) and
    // build the seed exactly once.
    async function poll() {
      if (cancelled) return;
      const r = await post("state", "crucible");
      const status = r?.state?.status;
      if (status === "converged" && builtFor !== "done") {
        builtFor = "done";
        await post("enrich", "seed");
        return; // stop polling
      }
      if (!cancelled) setTimeout(poll, 6000);
    }

    // ── Auto-build ("build it for me") ── on demand, run the loop to the end
    //    WITHOUT the founder: start (if needed) → repeatedly auto_answer (best-
    //    of-N → ranked → picked) until converged → enrich. The card's progress
    //    indicator reflects each round as it advances.
    async function autoBuild() {
      if (autoRunning.current) return;
      autoRunning.current = true;
      try {
        const cur = await post("get", "seed");
        if (cancelled || cur?.seed?.status === "ready") return;
        let s = (await post("state", "crucible"))?.state;
        if (!s || s.status === "error") s = (await post("start", "crucible"))?.state;
        let guard = 0;
        while (!cancelled && s && s.status !== "converged" && guard < 24) {
          guard += 1;
          s = (await post("auto_answer", "crucible"))?.state;
        }
        if (!cancelled) await post("enrich", "seed");
      } finally {
        autoRunning.current = false;
      }
    }
    const offAuto = onStartSeedAutoBuild((id) => {
      if (id === spaceId) void autoBuild();
    });

    void kickoff();
    setTimeout(poll, 9000);
    return () => {
      cancelled = true;
      offAuto();
    };
  }, [spaceId]);

  return null;
}
