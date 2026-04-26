"use client";

// ── Report button (Phase 3 — VP Project report finalization) ───────────
//
// Triggers freezing the current app/space into an immutable reports row.
// On success navigates to the dedicated report page, where the frozen
// resolver table renders the same widgets against the snapshot.
//
// Lives in the app detail header next to "Open canvas" — that's the
// user-facing "I'm done, capture this" moment the whole pipeline builds
// toward. The component is dumb: one button, one POST, one redirect. No
// LLM work here; summarization (if any) happens server-side.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Report } from "@/types/report";

interface ReportButtonProps {
  spaceId: string;
  /** Optional — when present the report is app-scoped; otherwise space-wide. */
  appId?: string;
  /** Optional title — defaults to app or space name server-side. */
  title?: string;
  /** Visual variant. "hero" for header CTAs, "ghost" for secondary rows. */
  variant?: "hero" | "ghost";
  /** Where to send the user after generation. Defaults to the report page. */
  onGenerated?: (report: Report) => void;
}

export function ReportButton({
  spaceId,
  appId,
  title,
  variant = "hero",
  onGenerated,
}: ReportButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_id: spaceId,
          app_id: appId,
          title,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { report: Report };
      if (onGenerated) {
        onGenerated(json.report);
      } else if (appId) {
        // App-scoped → nested route under the app. Space-scoped reports
        // land at /app/space/:id/report/:reportId (a future page — for
        // now we just surface app-scoped reports).
        router.push(`/app/space/${spaceId}/app/${appId}/report/${json.report.id}`);
      } else {
        router.push(`/app/space/${spaceId}/report/${json.report.id}`);
      }
    } catch (e) {
      console.error("[ReportButton] failed:", e);
      setErr(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setBusy(false);
    }
  };

  const base =
    "inline-flex items-center gap-2 rounded-full text-[12px] font-semibold transition-all disabled:cursor-wait disabled:opacity-70";
  const tone =
    variant === "hero"
      ? "bg-gray-900 px-4 py-2 text-white shadow-md hover:bg-gray-800 hover:scale-[1.02]"
      : "border border-gray-200 bg-white/70 px-3 py-1.5 text-gray-700 hover:border-gray-300 hover:text-gray-900";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={`${base} ${tone}`}
        title="Freeze this app's current state into an immutable report"
      >
        {busy ? (
          <svg
            className="animate-spin"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" fill="none" />
            <path
              d="M7 2 a5 5 0 0 1 5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M3 2h5.5l2.5 2.5V12a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V2.5A.5.5 0 0 1 3 2z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinejoin="round"
            />
            <path d="M5 8h4M5 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
        {busy ? "Freezing…" : "Generate report"}
      </button>
      {err && (
        <span className="text-[10px] font-medium text-rose-600">{err}</span>
      )}
    </div>
  );
}
