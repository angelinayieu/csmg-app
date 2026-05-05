"use client";

// ── Interventions list ──
//
// Extracted from the deleted `/app/space/[id]/interventions` route so the
// Strategy drawer can mount the same grouping UI as a tab. Keeps the
// `#intervention-<uuid>` hash-anchor focus behavior that widget links
// depend on.

import { motion } from "framer-motion";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInterventions } from "@/lib/hooks/use-interventions";
import { useApps, type AppView } from "@/lib/hooks/use-apps";
import type { Intervention, InterventionStatus } from "@/types/intervention";
import { LIBRARY_ASSET_MIME } from "@/components/canvas/library/types";
import { appAssetClass } from "@/components/canvas/library/classes/apps";

const EASE = [0.22, 1, 0.36, 1] as const;

const STATUS_ORDER: InterventionStatus[] = [
  "active",
  "proposed",
  "completed",
  "superseded",
  "abandoned",
];

export function InterventionsList({ spaceId }: { spaceId: string }) {
  const { interventions, loading, error } = useInterventions({ spaceId });
  const { apps } = useApps(spaceId);

  const grouped = useMemo(() => {
    const byApp = new Map<string, Map<InterventionStatus, Intervention[]>>();
    const unassigned = new Map<InterventionStatus, Intervention[]>();
    for (const iv of interventions) {
      const bucket = iv.app_id
        ? byApp.get(iv.app_id) ?? new Map<InterventionStatus, Intervention[]>()
        : unassigned;
      const list = bucket.get(iv.status) ?? [];
      list.push(iv);
      bucket.set(iv.status, list);
      if (iv.app_id) byApp.set(iv.app_id, bucket);
    }
    return { byApp, unassigned };
  }, [interventions]);

  const appById = useMemo(() => {
    const m = new Map<string, AppView>();
    for (const a of apps) m.set(a.id, a);
    return m;
  }, [apps]);

  const focusedId = useHashTarget();
  const focusedRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focusedId && focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="mx-auto w-full max-w-5xl px-4 py-4"
    >
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Interventions
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)]">
            Execution plan
          </h1>
          <p className="mt-1 max-w-xl text-[12.5px] leading-[1.5] text-[color:var(--muted-fg,#48484a)]">
            Every intervention the strategy materialized, grouped by the app it
            serves.
          </p>
        </div>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {interventions.length}{" "}
          {interventions.length === 1 ? "intervention" : "interventions"}
        </span>
      </header>

      {loading ? (
        <p className="text-[13px] text-[color:var(--muted-fg,#86868b)]">Loading…</p>
      ) : error ? (
        <p className="text-[13px] text-[color:var(--muted-fg,#48484a)]">
          Couldn&apos;t load interventions: {error}
        </p>
      ) : interventions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {[...grouped.byApp.entries()].map(([appId, statusMap]) => {
            const app = appById.get(appId);
            return (
              <AppGroup
                key={appId}
                appId={appId}
                app={app}
                appName={app?.name ?? "App"}
                appType={app?.app_type ?? "dashboard"}
                spaceId={spaceId}
                statusMap={statusMap}
                focusedId={focusedId}
                focusedRowRef={focusedRowRef}
              />
            );
          })}
          {grouped.unassigned.size > 0 ? (
            <AppGroup
              appId={null}
              app={undefined}
              appName="Unclustered interventions"
              appType={null}
              spaceId={spaceId}
              statusMap={grouped.unassigned}
              focusedId={focusedId}
              focusedRowRef={focusedRowRef}
            />
          ) : null}
        </div>
      )}
    </motion.div>
  );
}

function AppGroup({
  appId,
  app,
  appName,
  appType,
  spaceId,
  statusMap,
  focusedId,
  focusedRowRef,
}: {
  appId: string | null;
  app: AppView | undefined;
  appName: string;
  appType: string | null;
  spaceId: string;
  statusMap: Map<InterventionStatus, Intervention[]>;
  focusedId: string | null;
  focusedRowRef: React.MutableRefObject<HTMLLIElement | null>;
}) {
  const totalCount = [...statusMap.values()].reduce((n, arr) => n + arr.length, 0);

  const appRef = useRef(app);
  appRef.current = app;

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const currentApp = appRef.current;
      if (!currentApp || !appId) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = "copy";
      const payload = appAssetClass.toDragPayload(currentApp, { spaceId });
      e.dataTransfer.setData(LIBRARY_ASSET_MIME, JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", appName);
    },
    [appId, spaceId, appName],
  );

  return (
    <section
      draggable={Boolean(app && appId)}
      onDragStart={handleDragStart}
      className="glass-card rounded-[18px] px-5 py-4"
      title={app && appId ? "Drag to pin this app on the canvas" : undefined}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {app && appId && (
            <GripVertical className="h-3.5 w-3.5 flex-shrink-0 cursor-grab text-gray-300 hover:text-gray-500 active:cursor-grabbing" />
          )}
          {appId ? (
            <Link
              href={`/app/space/${spaceId}/app/${appId}`}
              className="text-[15px] font-semibold tracking-[-0.005em] text-[color:var(--fg,#1d1d1f)] hover:underline decoration-[color:var(--fg,#1d1d1f)]/30 underline-offset-4"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            >
              {appName}
            </Link>
          ) : (
            <span className="text-[15px] font-semibold tracking-[-0.005em] text-[color:var(--muted-fg,#48484a)]">
              {appName}
            </span>
          )}
          {appType ? (
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
              {appType}
            </span>
          ) : null}
        </div>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {totalCount} {totalCount === 1 ? "step" : "steps"}
        </span>
      </div>

      <div className="space-y-4">
        {STATUS_ORDER.filter((s) => statusMap.has(s)).map((status) => (
          <div key={status}>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#86868b)]">
              {status}
            </div>
            <ul className="space-y-1.5">
              {statusMap.get(status)!.map((iv) => (
                <InterventionRow
                  key={iv.id}
                  iv={iv}
                  focused={iv.id === focusedId}
                  innerRef={iv.id === focusedId ? focusedRowRef : undefined}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function InterventionRow({
  iv,
  focused,
  innerRef,
}: {
  iv: Intervention;
  focused: boolean;
  innerRef?: React.MutableRefObject<HTMLLIElement | null>;
}) {
  const accent =
    iv.status === "completed"
      ? "#30D158"
      : iv.impact === "high"
        ? "#0A84FF"
        : undefined;

  return (
    <li
      ref={innerRef}
      id={`intervention-${iv.id}`}
      className={`flex items-start gap-3 rounded-lg bg-white/40 px-3 py-2.5 ring-1 transition-colors ${
        focused
          ? "ring-[color:rgb(var(--accent-rgb))]/50 bg-white/70 shadow-sm"
          : "ring-white/50"
      }`}
    >
      {accent ? (
        <span
          className="mt-1 h-[6px] w-[6px] shrink-0 rounded-full"
          style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
        />
      ) : (
        <span className="mt-1 h-[6px] w-[6px] shrink-0 rounded-full bg-black/10" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
            {iv.title}
          </span>
          {iv.timeframe ? (
            <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--muted-fg,#6b7280)]">
              {iv.timeframe.replace("_", " ")}
            </span>
          ) : null}
          {iv.effort && iv.impact ? (
            <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
              effort <span className="font-medium">{iv.effort}</span> · impact{" "}
              <span className="font-medium">{iv.impact}</span>
            </span>
          ) : null}
        </div>
        {iv.description ? (
          <p className="mt-1 line-clamp-2 text-[12px] text-[color:var(--muted-fg,#48484a)]">
            {iv.description}
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {iv.target_entity_code ? (
            <span className="font-mono">{iv.target_entity_code}</span>
          ) : null}
          {iv.metric_name ? <span>metric: {iv.metric_name}</span> : null}
        </div>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="glass-card flex flex-col items-center justify-center rounded-[18px] px-8 py-12 text-center">
      <h2 className="text-[14px] font-semibold tracking-[-0.005em] text-[color:var(--fg,#1d1d1f)]">
        No interventions yet
      </h2>
      <p className="mt-1 max-w-md text-[12.5px] leading-[1.5] text-[color:var(--muted-fg,#6b7280)]">
        Interventions are materialized from your strategy. Run strategy-refresh
        to populate them.
      </p>
    </div>
  );
}

function useHashTarget(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const handler = () =>
      setId(typeof window !== "undefined" ? parseHash(window.location.hash) : null);
    handler();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return id;
}

function parseHash(hash: string): string | null {
  const m = /#intervention-(.+)$/.exec(hash);
  return m ? m[1] : null;
}
