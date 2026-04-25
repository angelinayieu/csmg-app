"use client";

// ── ConnectPanel ──
//
// In-whiteboard slide-in side panel that owns the "connect this
// whiteboard to others" surface — the cross-space tooling that used
// to live at /app/weave and /app/bridges.
//
// Two tabs:
//   - Weave: pick another whiteboard → run /api/weave → show shared
//     variables, contradictions, bridges-saved count. Uses the
//     existing useWeave hook + BridgeDisplay component.
//   - Bridges: list existing persisted bridges (this space → other,
//     or other → this space) so the user can see what's already
//     connected without re-running discovery.
//
// The panel owns its own picker UI (reusable WhiteboardsGrid in
// select mode would be overkill for a docked sidebar; we render a
// compact <select>).

import { useEffect, useMemo, useState } from "react";
import { GitBranch, Network, X, Loader2, ArrowRight } from "lucide-react";
import { useWeave } from "@/lib/hooks/use-weave";
import { BridgeDisplay } from "@/components/weaving/bridge-display";
import { useAppStore } from "@/stores/store-provider";
import type { Space } from "@/types";
import { cn } from "@/lib/utils";

export interface ConnectPanelProps {
  open: boolean;
  onClose: () => void;
  currentSpaceId: string;
  currentSpaceName: string;
}

type Tab = "weave" | "bridges";

export function ConnectPanel({
  open,
  onClose,
  currentSpaceId,
  currentSpaceName,
}: ConnectPanelProps) {
  const [tab, setTab] = useState<Tab>("weave");
  const spaces = useAppStore((s) => s.spaces);

  const otherSpaces = useMemo(
    () => spaces.filter((s) => s.id !== currentSpaceId),
    [spaces, currentSpaceId],
  );

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className={cn(
          "fixed inset-0 z-[55] bg-black/10 backdrop-blur-[1px] transition-opacity",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />

      {/* Panel — right-docked */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-[60] flex h-full w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ borderLeft: "1px solid rgba(0,0,0,0.08)" }}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
              Connect
            </p>
            <h2 className="truncate text-[14px] font-semibold text-gray-900">
              {currentSpaceName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-2 pt-2">
          <TabButton active={tab === "weave"} onClick={() => setTab("weave")} icon={<GitBranch className="h-3.5 w-3.5" />}>
            Weave
          </TabButton>
          <TabButton active={tab === "bridges"} onClick={() => setTab("bridges")} icon={<Network className="h-3.5 w-3.5" />}>
            Bridges
          </TabButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === "weave" ? (
            <WeaveTab
              currentSpaceId={currentSpaceId}
              otherSpaces={otherSpaces}
            />
          ) : (
            <BridgesTab currentSpaceId={currentSpaceId} />
          )}
        </div>
      </aside>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12px] font-semibold transition-colors",
        active
          ? "bg-gray-50 text-gray-900"
          : "text-gray-500 hover:text-gray-800",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Weave tab ──────────────────────────────────────────────────

function WeaveTab({
  currentSpaceId,
  otherSpaces,
}: {
  currentSpaceId: string;
  otherSpaces: Space[];
}) {
  const [pickedId, setPickedId] = useState("");
  const { loading: weaving, error, bridges, contradictions, bridgesSaved, weave } =
    useWeave();

  const canRun = pickedId && !weaving;

  if (otherSpaces.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[12px] text-gray-500">
        Need at least one other whiteboard to weave with this one.
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[12px] leading-relaxed text-gray-600">
        Pick another whiteboard to discover shared variables, cross-domain
        bridges, and contradictions.
      </p>

      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500">
        Other whiteboard
      </label>
      <select
        value={pickedId}
        onChange={(e) => setPickedId(e.target.value)}
        className="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        disabled={weaving}
      >
        <option value="">Select…</option>
        {otherSpaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.space_prefix} — {s.name}
          </option>
        ))}
      </select>

      <button
        onClick={() => canRun && weave(currentSpaceId, pickedId)}
        disabled={!canRun}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40"
      >
        {weaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitBranch className="h-3.5 w-3.5" />
        )}
        {weaving ? "Discovering…" : "Discover bridges"}
      </button>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
          {error}
        </div>
      )}

      {(bridges.length > 0 || contradictions.length > 0) && (
        <div className="mt-4">
          <BridgeDisplay
            bridges={bridges}
            contradictions={contradictions}
            bridgesSaved={bridgesSaved}
          />
        </div>
      )}
    </div>
  );
}

// ── Bridges tab ────────────────────────────────────────────────

interface EnrichedBridge {
  id: string;
  partner_space_id: string;
  partner_space_name: string;
  partner_entity_name: string;
  this_is_source: boolean;
}

function BridgesTab({ currentSpaceId }: { currentSpaceId: string }) {
  const [bridges, setBridges] = useState<EnrichedBridge[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBridges(null);
    setError(null);
    fetch(`/api/spaces/${currentSpaceId}/bridges`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: { bridges?: EnrichedBridge[] }) => {
        if (cancelled) return;
        setBridges(data.bridges ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(typeof err === "string" ? err : "Failed to load bridges");
        setBridges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSpaceId]);

  if (bridges === null) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
        {error}
      </div>
    );
  }

  if (bridges.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-[12px] text-gray-500">
        No bridges yet. Use the Weave tab to discover connections between this
        whiteboard and others.
      </div>
    );
  }

  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        Bridges ({bridges.length})
      </h3>
      <ul className="space-y-1.5">
        {bridges.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-[12px]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-gray-800">
                {b.partner_space_name}
              </p>
              <p className="truncate text-[10.5px] text-gray-500">
                ↔ {b.partner_entity_name}
              </p>
            </div>
            <ArrowRight className="h-3 w-3 flex-shrink-0 text-gray-300" />
          </li>
        ))}
      </ul>
    </section>
  );
}
