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

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

type RunError =
  | { kind: "credits"; balance: number; required: number }
  | { kind: "auth" }
  | { kind: "generic"; message: string };

export function PendingIntakeRunner({ surfaceFor }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState<PendingIntake | null>(null);
  const [error, setError] = useState<RunError | null>(null);

  useEffect(() => {
    const intake = readPendingIntake();
    if (!intake) return;
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
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
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
