"use client";

// ── CanvasWorkspaceRoomPicker (universal-canvas Phase A) ──────────
//
// Floating chrome button + popover that lets the user "bring in" an
// existing artifact as a WorkspaceRoomShape on the canvas. Tabbed
// to support multiple artifact kinds; each new kind adds a tab + a
// list endpoint + an event type the spawner listens for.
//
// Architecture mirrors CanvasAddButtons: this chrome lives OUTSIDE
// the tldraw editor tree. On select, the picker dispatches a
// `canvas-workspace:add-{kind}` window CustomEvent carrying the
// artifact id + cached title. The companion CanvasWorkspaceRoomSpawner
// (inside the tldraw editor tree) listens for those events and calls
// editor.createShape(...) to actually spawn the shape.
//
// Phase A.2 adds the Strategy tab. Twin + Probe tabs ship in Phase
// A.3 and A.4 with the same shape — just new tabs + endpoints + a
// branch in the spawner.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Layers,
  Loader2,
  MessageCircleQuestion,
  Plus,
  TestTube,
  X,
} from "lucide-react";

type PickerTab = "brainstorm" | "strategy" | "twin" | "probe";

interface BrainstormItem {
  id: string;
  title: string;
  updated_at: string;
}

interface StrategyItem {
  id: string;
  statement: string | null;
  session_id: string;
  updated_at: string;
}

const TAB_META: Record<
  PickerTab,
  { label: string; Icon: typeof Layers; available: boolean }
> = {
  brainstorm: { label: "Brainstorm", Icon: Layers, available: true },
  strategy: { label: "Strategy", Icon: FileText, available: true },
  twin: { label: "Twin", Icon: TestTube, available: false },
  probe: { label: "Probe", Icon: MessageCircleQuestion, available: false },
};

export function CanvasWorkspaceRoomPicker() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PickerTab>("brainstorm");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Each tab has its own cached list. We fetch lazily on first open
  // of a tab, then refetch on every full-popover-open so freshly-
  // created artifacts appear without a page reload.
  const [brainstorms, setBrainstorms] = useState<BrainstormItem[] | null>(null);
  const [strategies, setStrategies] = useState<StrategyItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-fetch the active tab whenever the popover opens or the tab
  // switches. Cheap parallel fetches; servers cache RLS so the cost
  // is one DB round-trip per tab per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (activeTab === "brainstorm") {
          const res = await fetch("/api/synergy/sessions", {
            cache: "no-store",
          });
          if (!res.ok) throw new Error("brainstorms");
          const json = (await res.json()) as { sessions: BrainstormItem[] };
          if (!cancelled) setBrainstorms(json.sessions ?? []);
        } else if (activeTab === "strategy") {
          const res = await fetch("/api/synergy/strategies", {
            cache: "no-store",
          });
          if (!res.ok) throw new Error("strategies");
          const json = (await res.json()) as { strategies: StrategyItem[] };
          if (!cancelled) setStrategies(json.strategies ?? []);
        }
      } catch {
        if (!cancelled) {
          if (activeTab === "brainstorm") setBrainstorms([]);
          else if (activeTab === "strategy") setStrategies([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeTab]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleSelectBrainstorm = useCallback((item: BrainstormItem) => {
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-brainstorm", {
        detail: { sessionId: item.id, title: item.title },
      }),
    );
    setOpen(false);
  }, []);

  const handleSelectStrategy = useCallback((item: StrategyItem) => {
    window.dispatchEvent(
      new CustomEvent("canvas-workspace:add-strategy", {
        detail: {
          strategyId: item.id,
          sessionId: item.session_id,
          statement: item.statement ?? "",
        },
      }),
    );
    setOpen(false);
  }, []);

  return (
    <div ref={popoverRef} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm ring-1 ring-black/[0.06] backdrop-blur-md transition hover:bg-white hover:ring-black/[0.1]"
        title="Bring an existing artifact onto the canvas as a room"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        Add room
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-2xl bg-white/95 shadow-lg ring-1 ring-black/[0.08] backdrop-blur-xl"
          style={{
            boxShadow:
              "0 20px 50px -24px rgba(15,23,42,0.2), inset 0 1px 0 rgba(255,255,255,0.7)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.04] px-4 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Add room
            </span>
            <button
              onClick={() => setOpen(false)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/[0.04] hover:text-gray-700"
              title="Close"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-0.5 border-b border-black/[0.04] px-2 pt-2">
            {(Object.keys(TAB_META) as PickerTab[]).map((tab) => {
              const meta = TAB_META[tab];
              const Icon = meta.Icon;
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => meta.available && setActiveTab(tab)}
                  disabled={!meta.available}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition",
                    active
                      ? "bg-gray-100 text-gray-900"
                      : meta.available
                        ? "text-gray-500 hover:bg-black/[0.03] hover:text-gray-900"
                        : "cursor-not-allowed text-gray-300",
                  ].join(" ")}
                  title={
                    meta.available
                      ? `Add ${meta.label.toLowerCase()} room`
                      : `${meta.label} room — coming soon`
                  }
                >
                  <Icon className="h-3 w-3" strokeWidth={1.75} />
                  {meta.label}
                  {!meta.available && (
                    <span className="text-[9px] uppercase tracking-wider text-gray-400">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* List body */}
          <div className="max-h-[340px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            ) : activeTab === "brainstorm" ? (
              <BrainstormList
                items={brainstorms}
                onSelect={handleSelectBrainstorm}
              />
            ) : activeTab === "strategy" ? (
              <StrategyList
                items={strategies}
                onSelect={handleSelectStrategy}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-tab lists ──

function BrainstormList({
  items,
  onSelect,
}: {
  items: BrainstormItem[] | null;
  onSelect: (item: BrainstormItem) => void;
}) {
  if (items === null || items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[12px] text-gray-500">
        No brainstorms yet. Start one from the homepage.
      </div>
    );
  }
  return (
    <ul>
      {items.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => onSelect(s)}
            className="block w-full px-4 py-2.5 text-left transition hover:bg-black/[0.03]"
          >
            <div className="text-[13px] font-medium text-gray-900">
              {s.title || "Untitled brainstorm"}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
              {relativeTime(s.updated_at)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StrategyList({
  items,
  onSelect,
}: {
  items: StrategyItem[] | null;
  onSelect: (item: StrategyItem) => void;
}) {
  if (items === null || items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[12px] text-gray-500">
        No strategies yet. Generate one from a brainstorm or prompt.
      </div>
    );
  }
  return (
    <ul>
      {items.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => onSelect(s)}
            className="block w-full px-4 py-2.5 text-left transition hover:bg-black/[0.03]"
          >
            <div className="line-clamp-2 text-[13px] font-medium text-gray-900">
              {s.statement?.trim() || "Untitled strategy"}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
              {relativeTime(s.updated_at)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
