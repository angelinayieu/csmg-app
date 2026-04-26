"use client";

// ── PendingIntakeRunner ──
//
// Mounted invisibly inside the /app layout. On mount it checks
// sessionStorage for a pending intake stashed by the landing page;
// if present it fires the same endpoint the immersive home would
// have called and routes the user into the resulting space. Renders
// a full-viewport veil so the visual transition from "submit prompt"
// → "land on whiteboard" stays continuous (no flash of HomeShell
// content while bootstrap is in flight).
//
// Why mounted in the layout (not the /app page): the email-confirm
// callback may drop a returning user on any /app/* route, not just
// /app. Mounting at the layer above means we still pick up the
// stash regardless of landing route.
//
// Hardening (post-launch incident):
//   • 401 → retry once after a short delay (Supabase SSR cookie can
//     race against client-side fetches immediately after login).
//   • 402 (no credits) → surface a specific "claim free credits / add
//     a pack" message rather than a generic error.
//   • sessionStorage stays populated until AFTER router.push resolves
//     so a hard reload during the in-flight call recovers the prompt.

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  clearPendingIntake,
  readPendingIntake,
  type PendingIntake,
} from "./pending-intake";

interface Props {
  /**
   * Surface path resolver — passed through from the host route to
   * keep the template→surface mapping single-sourced with the
   * immersive home logic.
   */
  surfaceFor: (defaultSurface: string | undefined) => string;
}

const RETRY_DELAY_MS = 800;

// ── Module-level dedupe set ──────────────────────────────────────────
//
// React StrictMode in dev intentionally mounts → unmounts → re-mounts
// every effect to surface bugs that survive remount. The intake runner
// hits an API that creates a row in `spaces` and a row in
// `pipeline_runs`, so a double-mount creates TWO whiteboards for one
// prompt — and triggers TWO copies of the entire decompose chain
// downstream. The user sees this as "every time I go in, it
// regenerates a duplicate."
//
// `useRef` doesn't survive remount in StrictMode (each fresh mount
// gets a new ref), so we keep the in-flight key on the module itself
// — singleton across all PendingIntakeRunner instances during the
// life of the page. The key is the stash payload + a short-window
// timestamp bucket, so legitimate "same user submits the same prompt
// 10 minutes later" still works.
const inflightIntakeKeys = new Set<string>();

function intakeKey(intake: PendingIntake): string {
  // Bucket by 30s window so a "real" retry within the StrictMode
  // double-mount pattern (~10ms apart) collides, but a deliberate
  // re-submit minutes later does not.
  const bucket = Math.floor(intake.stashedAt / 30_000);
  return `${intake.kind}:${bucket}:${"prompt" in intake ? intake.prompt.slice(0, 80) : ""}:${"templateId" in intake ? intake.templateId : ""}`;
}

type RunError =
  | { kind: "credits"; balance: number; required: number }
  | { kind: "auth" }
  | { kind: "generic"; message: string };

export function PendingIntakeRunner({ surfaceFor }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const startPathRef = useRef<string | null>(null);
  const [running, setRunning] = useState<PendingIntake | null>(null);
  const [error, setError] = useState<RunError | null>(null);

  // Tear the veil down once the router has actually moved off the
  // route we started on. PendingIntakeRunner is mounted in the
  // shared /app layout, so it stays alive across the router.push to
  // /app/space/{id}/whiteboard — without this clear, the veil
  // (z-100, full-viewport) covers the whiteboard forever and the
  // user is stuck on "Bootstrapping your whiteboard…".
  useEffect(() => {
    if (!running) return;
    if (startPathRef.current && pathname !== startPathRef.current) {
      setRunning(null);
    }
  }, [pathname, running]);

  useEffect(() => {
    const intake = readPendingIntake();
    if (!intake) return;

    // StrictMode dev double-mount guard. See `inflightIntakeKeys`
    // comment above. The very first mount of an intake claims the
    // key and proceeds; the second mount reads the same intake from
    // sessionStorage but bails because the key is claimed.
    const key = intakeKey(intake);
    if (inflightIntakeKeys.has(key)) {
      // Surface the splash so the user still sees "we're working on
      // it" — the OTHER mount is doing the real fetch.
      startPathRef.current = pathname;
      setRunning(intake);
      return;
    }
    inflightIntakeKeys.add(key);

    startPathRef.current = pathname;
    setRunning(intake);

    let cancelled = false;

    const callApi = async (
      path: string,
      body: unknown,
      attempt = 0,
    ): Promise<{ res: Response; json: Record<string, unknown> }> => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      // Auth race — Supabase SSR cookie may not be wired into the
      // browser fetch context for the first ~500ms after a fresh
      // login. One retry covers it; failing twice is a real auth
      // problem.
      if (res.status === 401 && attempt < 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return callApi(path, body, attempt + 1);
      }
      return { res, json };
    };

    const run = async () => {
      try {
        if (intake.kind === "create") {
          const { res, json } = await callApi("/api/intake/bootstrap", {
            text: intake.prompt,
            reasoningDepth: intake.depth,
          });

          if (res.status === 402) {
            setError({
              kind: "credits",
              balance: typeof json.balance === "number" ? json.balance : 0,
              required: typeof json.required === "number" ? json.required : 0,
            });
            return;
          }
          if (res.status === 401) {
            setError({ kind: "auth" });
            return;
          }
          if (!res.ok || typeof json.spaceId !== "string") {
            throw new Error(
              (json.error as string) ?? `Bootstrap failed (${res.status})`,
            );
          }
          const dest =
            typeof json.runId === "string" && json.runId.length > 0
              ? `/app/space/${json.spaceId}/whiteboard?run=${json.runId}`
              : `/app/space/${json.spaceId}/whiteboard`;
          if (!cancelled) {
            clearPendingIntake();
            router.push(dest);
            // The destination route owns its own bootstrap splash
            // (WhiteboardBootstrapSplash). Drop our veil now so the
            // user isn't staring at "Bootstrapping…" while Next.js
            // compiles the destination route in dev (can take 15-20s
            // because router.push doesn't resolve until SSR finishes).
            // The pathname-watch effect above is a no-op once running
            // is null.
            setRunning(null);
          }
          return;
        }

        if (intake.kind === "ask") {
          const { res, json } = await callApi("/api/ask/start", {
            query: intake.prompt,
          });

          if (res.status === 402) {
            setError({
              kind: "credits",
              balance: typeof json.balance === "number" ? json.balance : 0,
              required: typeof json.required === "number" ? json.required : 0,
            });
            return;
          }
          if (res.status === 401) {
            setError({ kind: "auth" });
            return;
          }
          if (!res.ok || typeof json.spaceId !== "string") {
            throw new Error(
              (json.error as string) ?? `Ask failed (${res.status})`,
            );
          }
          if (!cancelled) {
            clearPendingIntake();
            router.push(`/app/space/${json.spaceId}`);
            setRunning(null);
          }
          return;
        }

        if (intake.kind === "template") {
          const { res, json } = await callApi("/api/use-cases/create", {
            template_id: intake.templateId,
          });

          if (res.status === 401) {
            setError({ kind: "auth" });
            return;
          }
          const space = json.space as { id?: string } | undefined;
          if (!res.ok || !space?.id) {
            throw new Error(
              (json.error as string) ??
                `Template create failed (${res.status})`,
            );
          }
          const surface = surfaceFor(
            typeof json.default_surface === "string"
              ? json.default_surface
              : undefined,
          );
          if (!cancelled) {
            clearPendingIntake();
            router.push(`/app/space/${space.id}${surface}`);
            setRunning(null);
          }
          return;
        }
      } catch (err) {
        console.error("[PendingIntakeRunner] failed:", err);
        if (!cancelled) {
          setError({
            kind: "generic",
            message: err instanceof Error ? err.message : "Could not resume",
          });
          setRunning(null);
        }
      } finally {
        // Always release the inflight key so a deliberate retry
        // (refresh + same prompt) can re-fire.
        inflightIntakeKeys.delete(key);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // pathname intentionally excluded — we only want to fire the
    // intake once on mount; the cleanup-on-navigate effect above
    // handles teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, surfaceFor]);

  if (!running && !error) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-md"
      style={{ background: "rgba(255,255,255,0.55)" }}
      role="status"
      aria-live="polite"
    >
      <div
        className="flex max-w-sm flex-col items-center gap-3 rounded-2xl px-6 py-5 text-center"
        style={{
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 24px 60px -24px rgba(15,23,42,0.22)",
        }}
      >
        {/* Loading state — the bootstrap is in flight */}
        {running && !error && (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-slate-700" />
            <div className="text-[13px] font-semibold text-slate-900">
              Picking up where you left off…
            </div>
            <div className="text-[11px] text-slate-500">
              {running.kind === "template"
                ? "Spinning up your template."
                : running.kind === "ask"
                  ? "Searching across your whiteboards."
                  : "Bootstrapping your whiteboard."}
            </div>
          </>
        )}

        {/* Out of credits — direct, actionable */}
        {error?.kind === "credits" && (
          <>
            <div className="text-[13px] font-semibold text-slate-900">
              Almost there — you need credits to run this
            </div>
            <div className="text-[11.5px] leading-relaxed text-slate-500">
              You have <strong>{error.balance}</strong> credits;{" "}
              <strong>{error.required}</strong> are needed for this depth. New
              accounts can claim a free starter pack.
            </div>
            <div className="mt-1 flex items-center gap-2">
              <a
                href="/app/settings/credits"
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-[12px] font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Add credits <ArrowRight className="h-3 w-3" />
              </a>
              <button
                onClick={() => {
                  clearPendingIntake();
                  setError(null);
                  setRunning(null);
                }}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-900"
              >
                Dismiss
              </button>
            </div>
          </>
        )}

        {/* Auth race — rare, recoverable */}
        {error?.kind === "auth" && (
          <>
            <div className="text-[13px] font-semibold text-slate-900">
              Couldn't verify your session
            </div>
            <div className="text-[11.5px] text-slate-500">
              Refresh the page and we'll try again — your prompt is saved.
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-1 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white"
            >
              Refresh
            </button>
          </>
        )}

        {/* Generic error — last resort */}
        {error?.kind === "generic" && (
          <>
            <div className="text-[13px] font-semibold text-slate-900">
              Couldn't resume your prompt
            </div>
            <div className="text-[11px] text-slate-500">{error.message}</div>
            <button
              onClick={() => {
                clearPendingIntake();
                setError(null);
              }}
              className="mt-1 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
