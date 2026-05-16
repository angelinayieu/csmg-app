// ── Canvas Final Products drawer ──
//
// Surfaces "what you've actually made" on the canvas — the things
// the user can take with them. Slides in from the right when the
// user clicks "Products" on the bottom-right launcher stack.
//
// Three sections:
//   1. Generated Apps — apps materialized from this space's strategies.
//      Each links to its app renderer page.
//   2. Key Entities — top entities by importance ("fundamental" or
//      "critical"). The load-bearing pieces of the knowledge graph.
//   3. Strategy doc (placeholder until Phase 3 ships the
//      synergy_strategies.space_id link — currently the canvas and
//      Synergy schemas are siloed).
//
// This is the surface the user asked about (`where is the tab for
// the final products`). Replaces / complements the legacy
// /app/synergy/[id]/process page which was misnamed and structured
// as a "run AI ops" panel rather than a "view outputs" surface.

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AppWindow,
  ArrowRight,
  Cog,
  FileText,
  Loader2,
  Package,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import type { Entity } from "@/types";

interface AppRow {
  id: string;
  name: string;
  description: string | null;
  app_type: string;
  status: string;
  last_refreshed_at: string | null;
  health_score: number | null;
}

interface Props {
  /** Parent controls visibility by mounting/unmounting the component;
   *  fresh mount on every open guarantees a fresh fetch + clean state
   *  without needing setState inside an effect. */
  onClose: () => void;
  spaceId: string;
}

export function CanvasFinalProductsDrawer({ onClose, spaceId }: Props) {
  const { entities } = useSpaceData();
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [loadingApps, setLoadingApps] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);

  // Fetch apps on mount. The drawer is unmounted when closed, so this
  // effect always runs on a fresh mount with clean initial state.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/apps?spaceId=${encodeURIComponent(spaceId)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as {
          apps?: AppRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok) throw new Error(json.error ?? `${r.status}`);
        setApps(json.apps ?? []);
        setLoadingApps(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setAppsError(e instanceof Error ? e.message : String(e));
          setLoadingApps(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Key entities = importance "fundamental" or "critical". These
  // are the load-bearing pieces the user shouldn't lose.
  const keyEntities = useMemo<Entity[]>(() => {
    return entities
      .filter(
        (e) =>
          e.importance === "fundamental" || e.importance === "critical",
      )
      .slice(0, 12);
  }, [entities]);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalProducts = (apps?.length ?? 0) + keyEntities.length;

  return (
    <>
      {/* Soft backdrop — clickable to close */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-[70]"
        style={{
          background: "rgba(15, 23, 42, 0.18)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          animation: "finalProductsBackdropIn 200ms ease both",
        }}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Final products"
        className="fixed right-0 top-0 bottom-0 z-[71] flex w-[440px] max-w-[92vw] flex-col"
        style={{
          background: "rgba(255, 255, 255, 0.96)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          borderLeft: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: "0 0 60px -10px rgba(15, 23, 42, 0.18)",
          animation: "finalProductsDrawerIn 280ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-black/[0.06] px-5 py-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-[0_6px_18px_-6px_rgba(99,102,241,0.55)]">
            <Package className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-gray-500">
              Outputs
            </div>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-gray-900">
              Final Products
            </h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
            {totalProducts} total
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── Apps ── */}
          <Section
            label="Generated apps"
            icon={AppWindow}
            count={apps?.length ?? null}
            loading={loadingApps}
          >
            {appsError ? (
              <ErrorRow message={appsError} />
            ) : !loadingApps && (apps?.length ?? 0) === 0 ? (
              <EmptyRow
                icon={AppWindow}
                title="No apps yet"
                body="Apps materialize automatically after a strategy is approved in Precise R&D or Build Digital Twin mode."
              />
            ) : (
              <ul className="space-y-1.5">
                {(apps ?? []).map((a) => (
                  <li key={a.id}>
                    <AppLink app={a} spaceId={spaceId} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Key entities ── */}
          <Section
            label="Key entities"
            icon={Star}
            count={keyEntities.length}
            loading={false}
          >
            {keyEntities.length === 0 ? (
              <EmptyRow
                icon={Star}
                title="No load-bearing entities yet"
                body="Entities marked as 'fundamental' or 'critical' importance show up here. The pipeline tags them during synthesis."
              />
            ) : (
              <ul className="grid grid-cols-1 gap-1.5">
                {keyEntities.map((e) => (
                  <li key={e.id}>
                    <EntityRow entity={e} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Strategy doc placeholder ── */}
          <Section label="Strategy doc" icon={FileText} count={null} loading={false}>
            <EmptyRow
              icon={FileText}
              title="Coming with Phase 3"
              body="Strategy docs (statement, pitch, plan, risks, hypotheses) live in the synergy_strategies table. A space_id back-link lands with the data migration so canvas spaces can surface their own doc here."
              variant="info"
            />
          </Section>
        </div>

        {/* Footer hint */}
        <div className="border-t border-black/[0.06] px-5 py-3">
          <p className="text-[10.5px] leading-relaxed text-gray-500">
            <Sparkles className="mr-1 inline h-2.5 w-2.5 text-indigo-500" />
            Final Products is the consolidation of outputs from across this
            whiteboard&apos;s lifecycle. Replaces the legacy{" "}
            <span className="font-mono text-[10px] text-gray-700">Process</span>{" "}
            page.
          </p>
        </div>
      </aside>

      <style jsx>{`
        @keyframes finalProductsBackdropIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes finalProductsDrawerIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}

// ── Sections + Rows ───────────────────────────────────────────────

function Section({
  label,
  icon: Icon,
  count,
  loading,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number | null;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 last:mb-2">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-gray-500" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-gray-500">
          {label}
        </span>
        {count !== null && !loading && (
          <span className="font-mono text-[9.5px] tabular-nums text-gray-400">
            · {count}
          </span>
        )}
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
        )}
      </div>
      {children}
    </div>
  );
}

function AppLink({ app, spaceId }: { app: AppRow; spaceId: string }) {
  const statusColor =
    app.status === "active"
      ? "text-emerald-700 bg-emerald-50"
      : app.status === "proposed"
        ? "text-amber-700 bg-amber-50"
        : app.status === "approved"
          ? "text-blue-700 bg-blue-50"
          : "text-gray-600 bg-gray-100";
  return (
    <Link
      href={`/app/space/${spaceId}/app/${app.id}`}
      className="group flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition hover:border-indigo-300 hover:shadow-sm"
    >
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
        <AppWindow className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-gray-900 group-hover:text-indigo-700">
            {app.name}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] ${statusColor}`}
          >
            {app.status}
          </span>
        </div>
        {app.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-600">
            {app.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] text-gray-500">
          <span>{app.app_type}</span>
          {app.health_score !== null && (
            <>
              <span>·</span>
              <span>health {Math.round(app.health_score * 100)}%</span>
            </>
          )}
        </div>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
    </Link>
  );
}

function EntityRow({ entity }: { entity: Entity }) {
  const importanceColor =
    entity.importance === "fundamental"
      ? "text-rose-700 bg-rose-50"
      : "text-amber-700 bg-amber-50";
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 transition hover:border-gray-300">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-100">
        <Star className="h-2.5 w-2.5 text-gray-600" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-gray-900">
            {entity.name}
          </span>
          {entity.importance && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] ${importanceColor}`}
            >
              {entity.importance}
            </span>
          )}
        </div>
        {entity.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-600">
            {entity.description}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyRow({
  icon: Icon,
  title,
  body,
  variant = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  variant?: "neutral" | "info";
}) {
  const tint =
    variant === "info"
      ? "border-indigo-200 bg-indigo-50/40"
      : "border-gray-200 bg-gray-50/60";
  return (
    <div className={`rounded-xl border ${tint} px-3 py-3`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-gray-500" />
        <span className="text-[12px] font-semibold text-gray-800">{title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{body}</p>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-3">
      <div className="flex items-center gap-1.5">
        <Cog className="h-3 w-3 text-rose-600" />
        <span className="text-[12px] font-semibold text-rose-700">
          Couldn&apos;t load apps
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-rose-700">{message}</p>
    </div>
  );
}
