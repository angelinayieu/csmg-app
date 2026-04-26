"use client";

// ── Frozen Report page (Phase 3 — VP Project report) ──────────────────
//
// Renders a saved report at /app/space/:id/app/:appId/report/:reportId.
// Fetches the frozen Report row once, hands the payload to
// buildFrozenResolverTable(), and mounts the AppRenderer against the
// frozen app snapshot + frozen manifest.
//
// Widgets don't know they're rendering against a frozen payload — the
// ResolverTable indirection hides it. The only page-level difference is
// that destructive actions are disabled (preview=true) and the header
// shows a "Frozen at ${timestamp}" band.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppRenderer } from "@/components/apps/app-renderer";
import { buildFrozenResolverTable } from "@/lib/apps/frozen-resolver";
import type { App } from "@/types/app";
import type { AppManifest } from "@/types/app-manifest";
import type { Report } from "@/types/report";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function FrozenReportPage() {
  const params = useParams<{ id: string; appId: string; reportId: string }>();
  const router = useRouter();
  const spaceId = params?.id;
  const appId = params?.appId;
  const reportId = params?.reportId;

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!reportId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { report: Report };
        if (cancelled) return;
        setReport(json.report);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  // Build the frozen resolver once per report. The factory memoizes
  // internal compose work (downstream reality, goal tree) across
  // resolve() calls from inside the ResolverTable itself.
  const resolverTable = useMemo(() => {
    if (!report) return {};
    return buildFrozenResolverTable(report.payload);
  }, [report]);

  // Build the App the renderer should consume. Report.payload.app_snapshot
  // carries the full App at freeze time; we swap in the frozen manifest
  // when one was captured so the layout matches the captured state.
  const renderApp = useMemo<App | null>(() => {
    if (!report || !report.payload.app_snapshot) return null;
    const base = report.payload.app_snapshot;
    const frozenManifest = report.manifest as AppManifest | null;
    if (!frozenManifest) return base;
    // Overlay frozen manifest onto the snapshot's config so AppRenderer
    // reads the frozen one out of app.config.manifest.
    return {
      ...base,
      config: {
        ...base.config,
        manifest: frozenManifest,
      },
    };
  }, [report]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-pulse text-[13px] text-[color:var(--muted-fg,#86868b)]">
          Loading report…
        </div>
      </div>
    );
  }

  if (error || !report || !renderApp) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="text-[14px] text-[color:var(--muted-fg,#48484a)]">
          {error ?? "Report not found."}
        </p>
        <button
          onClick={() => router.back()}
          className="mt-4 rounded-full bg-black/5 px-4 py-1.5 text-[12px] font-medium hover:bg-black/10"
        >
          Go back
        </button>
      </div>
    );
  }

  const frozenAt = new Date(report.generated_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="mx-auto w-full max-w-6xl px-6 py-6"
    >
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-[12px] text-[color:var(--muted-fg,#86868b)]">
        <Link
          href={`/app/space/${spaceId}`}
          className="hover:text-[color:var(--fg,#1d1d1f)]"
        >
          Dashboard
        </Link>
        <span>›</span>
        <Link
          href={`/app/space/${spaceId}/app/${appId}`}
          className="hover:text-[color:var(--fg,#1d1d1f)]"
        >
          {renderApp.name}
        </Link>
        <span>›</span>
        <span className="text-[color:var(--fg,#1d1d1f)]">Report</span>
      </div>

      {/* Frozen-at band — sits atop the renderer so the user always
          knows what timestamp the numbers are anchored to. */}
      <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-amber-200/70 bg-gradient-to-r from-amber-50/70 via-white/60 to-amber-50/70 px-4 py-2.5">
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-amber-700">
            Frozen snapshot
          </div>
          <div className="mt-0.5 text-[13px] font-semibold text-gray-900">
            {report.title}
          </div>
          {report.summary && (
            <p className="mt-1 text-[11.5px] leading-snug text-gray-600">
              {report.summary}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-gray-400">
            Generated
          </div>
          <div className="text-[11.5px] font-semibold text-gray-700">
            {frozenAt}
          </div>
          {report.pipeline_version != null && (
            <div className="mt-0.5 text-[9.5px] text-gray-500">
              Pipeline v{report.pipeline_version}
            </div>
          )}
        </div>
      </div>

      {/* Render the frozen app against the frozen resolver. preview=true
          so destructive actions (complete_intervention etc.) are
          suppressed — reports are read-only by design. */}
      <AppRenderer
        app={renderApp}
        resolverTable={resolverTable}
        preview
      />
    </motion.div>
  );
}
