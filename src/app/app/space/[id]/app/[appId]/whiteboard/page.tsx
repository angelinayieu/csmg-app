"use client";

/**
 * Per-App Whiteboard — /app/space/:id/app/:appId/whiteboard
 *
 * For Sprint 2 v1, this is a focused canvas scoped to the App's dominant
 * factors. It reuses the existing WhiteboardOverview component (which reads
 * from SpaceDataProvider) for now, and will be upgraded in Sprint 3 to:
 *   - filter nodes/edges to the App's dominant_entity_ids + downstream reach
 *   - surface the App's interventions as sticky-note overlays
 *   - feed user edits back into `apps.stale_reason = 'whiteboard_edit'`
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { WhiteboardOverview } from "@/components/whiteboard/whiteboard-overview";
import { hydrateApp } from "@/types/app";
import type { App, AppRow } from "@/types/app";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function AppWhiteboardPage() {
  const params = useParams<{ id: string; appId: string }>();
  const spaceId = params?.id;
  const appId = params?.appId;

  const [app, setApp] = useState<App | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!appId) return;
      try {
        const res = await fetch(`/api/apps/${appId}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { app: AppRow };
        if (!cancelled) setApp(hydrateApp(json.app));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Floating header — over the canvas */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2"
      >
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/60 bg-white/55 px-4 py-2 shadow-lg backdrop-blur-2xl">
          <Link
            href={`/app/space/${spaceId}/app/${appId}`}
            className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--muted-fg,#48484a)] hover:text-[color:var(--fg,#1d1d1f)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M7.5 2.5 L4 6 L7.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            Back to app
          </Link>
          <div className="h-4 w-px bg-black/10" />
          <div className="flex items-center gap-2">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{ background: "rgb(var(--accent-rgb))", boxShadow: "0 0 8px rgb(var(--accent-rgb))" }}
            />
            <span className="text-[11px] font-semibold text-[color:var(--fg,#1d1d1f)]">
              {loading ? "Loading canvas…" : app?.name ?? "App whiteboard"}
            </span>
            {app ? (
              <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
                · canvas
              </span>
            ) : null}
          </div>
        </div>
      </motion.div>

      {/* The whiteboard canvas itself */}
      <div className="h-full w-full">
        <WhiteboardOverview />
      </div>
    </div>
  );
}
