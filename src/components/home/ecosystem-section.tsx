"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Globe, RefreshCw, Hexagon, BarChart3, Wrench, Cloud, Network, X, Search, Plus, User } from "lucide-react";
import Link from "next/link";
import type { Space } from "@/types";
import { FeatureTile } from "./feature-tile";

// Match sidebar avatar gradients
const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #4fa3ff, #0051ff)",
  "linear-gradient(145deg, #6a7cff, #3c44d9)",
  "linear-gradient(145deg, #2d8cff, #003bc4)",
  "linear-gradient(145deg, #8b9dff, #5562e6)",
  "linear-gradient(145deg, #5fbaff, #1a7aff)",
];
function getAvatarGradient(letter: string) {
  const idx = letter.charCodeAt(0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

// Close overlay on Escape
function useEscapeKey(onEscape: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onEscape, active]);
}

const features = [
  {
    icon: Globe,
    title: "Knowledge Graph Analysis",
    description: "Decompose concepts into structured graphs",
    delay: "delay-600",
    side: "left" as const,
  },
  {
    icon: RefreshCw,
    title: "Real-Time Research",
    description: "AI-powered web intelligence",
    delay: "delay-700",
    side: "right" as const,
  },
  {
    icon: Hexagon,
    title: "Deep-Logic Reasoning",
    description: "Multi-step constructive thinking",
    delay: "delay-800",
    side: "left" as const,
  },
  {
    icon: BarChart3,
    title: "Strategic Synthesis",
    description: "Leverage points & action plans",
    delay: "delay-900",
    side: "right" as const,
  },
  {
    icon: Wrench,
    title: "Cross-Space Weaving",
    description: "Bridge entities across spaces",
    delay: "delay-1000",
    side: "left" as const,
  },
  {
    icon: Cloud,
    title: "Native Integrations",
    description: "Connect external data sources",
    delay: "delay-1100",
    side: "right" as const,
  },
];

interface EcosystemSectionProps {
  spaces: Space[];
}

export function EcosystemSection({ spaces }: EcosystemSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const closeOverlay = useCallback(() => {
    setExpanded(false);
    setSearch("");
  }, []);

  useEscapeKey(closeOverlay, expanded);

  // Lock background scroll while overlay is open — prevents the page underneath from shifting.
  useEffect(() => {
    if (!expanded) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [expanded]);

  const filtered = useMemo(() => {
    if (!search.trim()) return spaces;
    const q = search.toLowerCase();
    return spaces.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.space_prefix.toLowerCase().includes(q)
    );
  }, [spaces, search]);

  const leftFeatures = features.filter((f) => f.side === "left");
  const rightFeatures = features.filter((f) => f.side === "right");

  return (
    <>
      <div className="relative mt-6" style={{ display: "grid", gridTemplateColumns: "1fr 180px 1fr", gridTemplateRows: "auto auto auto", gap: "14px 24px", alignItems: "center" }}>
        {/* SVG connector lines */}
        <svg
          className="ecosystem-connectors anim-lines delay-1300 pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 900 400"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent-300)" stopOpacity="0.1" />
              <stop offset="50%" stopColor="var(--accent-600)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--accent-300)" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <path d="M 280 60  Q 380 100 450 200" stroke="url(#lineGrad)" />
          <path d="M 620 60  Q 520 100 450 200" stroke="url(#lineGrad)" />
          <path d="M 280 200 Q 360 200 450 200" stroke="url(#lineGrad)" />
          <path d="M 620 200 Q 540 200 450 200" stroke="url(#lineGrad)" />
          <path d="M 280 340 Q 380 300 450 200" stroke="url(#lineGrad)" />
          <path d="M 620 340 Q 520 300 450 200" stroke="url(#lineGrad)" />
        </svg>

        {/* Left features (rows 1-3, column 1) */}
        {leftFeatures.map((f, i) => {
          const Icon = f.icon;
          return (
            <FeatureTile
              key={f.title}
              Icon={Icon}
              title={f.title}
              description={f.description}
              delay={f.delay}
              gridColumn={1}
              gridRow={i + 1}
            />
          );
        })}

        {/* Right features (rows 1-3, column 3) */}
        {rightFeatures.map((f, i) => {
          const Icon = f.icon;
          return (
            <FeatureTile
              key={f.title}
              Icon={Icon}
              title={f.title}
              description={f.description}
              delay={f.delay}
              gridColumn={3}
              gridRow={i + 1}
            />
          );
        })}

        {/* Hub sphere (center, spanning all 3 rows) */}
        <div
          className="relative grid place-items-center"
          style={{ gridColumn: 2, gridRow: "1 / span 3", minHeight: 180 }}
        >
          {/* Orbiting dots (decorative, rotate around the hub) */}
          <div className="pointer-events-none absolute h-[180px] w-[180px]" style={{ animation: "hub-rotate 18s linear infinite" }}>
            <span className="absolute left-1/2 top-0 -translate-x-1/2 block h-2 w-2 rounded-full bg-interaxis-400 shadow-[0_0_10px_rgba(var(--accent-rgb),0.7)]" />
          </div>
          <div className="pointer-events-none absolute h-[180px] w-[180px]" style={{ animation: "hub-rotate 24s linear infinite reverse" }}>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 block h-1.5 w-1.5 rounded-full bg-interaxis-500 shadow-[0_0_8px_rgba(var(--accent-rgb),0.6)]" />
          </div>
          <div className="pointer-events-none absolute h-[220px] w-[220px]" style={{ animation: "hub-rotate 30s linear infinite" }}>
            <span className="absolute left-0 top-1/2 -translate-y-1/2 block h-1 w-1 rounded-full bg-interaxis-300 shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]" />
          </div>

          <button
            onClick={() => setExpanded(true)}
            className="hub-sphere hub-interactive anim-scale-in delay-500 group"
          >
            <div className="flex flex-col items-center">
              <User className="mb-1 h-6 w-6 text-interaxis-700 transition-transform duration-500 group-hover:scale-110" strokeWidth={1.6} />
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-interaxis-700">
                {spaces.length > 0 ? `${spaces.length} Spaces` : "Your Space"}
              </span>
              <span className="mt-1 text-[8px] font-medium uppercase tracking-[0.2em] text-gray-400 transition-opacity duration-300 group-hover:opacity-0">
                Unified Workspace
              </span>
              <span className="absolute bottom-[18%] text-[8px] font-medium uppercase tracking-[0.2em] text-interaxis-600 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                Click to Explore
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Space tile — matches sidebar avatar style */}
      {/* (declared inline below as SpaceTile) */}

      {/* Expanded overlay — portal */}
      {mounted && expanded && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          {/* Backdrop — soft, frosted, never opaque */}
          <div
            className="absolute inset-0 bg-white/20 backdrop-blur-2xl backdrop-saturate-150 transition-opacity"
            onClick={closeOverlay}
          />

          {/* Modal panel — static (no float animation), Vision Pro frosted glass */}
          <div
            className="anim-rise relative z-10 flex w-full max-w-4xl max-h-[82vh] flex-col overflow-hidden"
            style={{
              borderRadius: 28,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.46) 100%)",
              backdropFilter: "blur(60px) saturate(200%)",
              WebkitBackdropFilter: "blur(60px) saturate(200%)",
              border: "1px solid rgba(255,255,255,0.6)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.85) inset, 0 0 0 1px rgba(var(--accent-rgb), 0.05), 0 30px 80px rgba(15,23,42,0.18), 0 12px 32px rgba(15,23,42,0.10)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-7 pt-6 pb-4">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[17px] font-semibold tracking-tight text-gray-800">
                  Your Spaces
                </h2>
                <span className="text-[12px] font-medium text-gray-400">
                  {spaces.length}
                </span>
              </div>
              <button
                onClick={closeOverlay}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/50 text-gray-500 transition-all hover:bg-white/80 hover:text-gray-700"
                style={{
                  border: "1px solid rgba(255,255,255,0.7)",
                  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                }}
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            {/* Search */}
            <div className="px-7 pb-4">
              <div className="relative">
                <Search
                  className="absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-gray-400"
                  strokeWidth={1.8}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search spaces..."
                  className="w-full rounded-2xl py-2.5 pl-10 pr-4 text-[13.5px] text-gray-700 placeholder-gray-400 outline-none transition-all focus:bg-white/75"
                  style={{
                    background: "rgba(255,255,255,0.5)",
                    border: "1px solid rgba(255,255,255,0.7)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.03)",
                  }}
                  autoFocus
                />
              </div>
            </div>

            {/* Spaces list */}
            <div className="flex-1 overflow-y-auto px-7 pb-5">
              {filtered.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-gray-400">
                  {spaces.length === 0 ? "No spaces yet" : `No spaces match "${search}"`}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {filtered.map((space) => (
                    <SpaceTile key={space.id} space={space} onNavigate={closeOverlay} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-center px-7 py-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.55)" }}
            >
              <Link
                href="/app/new"
                onClick={closeOverlay}
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] font-semibold text-interaxis-700 transition-all hover:bg-white/60"
                style={{
                  background: "rgba(255,255,255,0.45)",
                  border: "1px solid rgba(255,255,255,0.7)",
                }}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Create new analysis
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ─── Space tile — Vision Pro feel, matches sidebar avatars ─── */
function SpaceTile({ space, onNavigate }: { space: Space; onNavigate: () => void }) {
  return (
    <Link
      href={`/app/space/${space.id}`}
      onClick={onNavigate}
      className="group flex items-start gap-3 rounded-2xl p-3.5 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "rgba(255,255,255,0.42)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.65)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 14px rgba(15,23,42,0.05)",
      }}
    >
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] text-[12.5px] font-bold text-white"
        style={{
          background: getAvatarGradient(space.space_prefix),
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.4), 0 4px 10px rgba(0,50,180,0.20)",
        }}
      >
        {space.space_prefix}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[13.5px] font-semibold text-gray-800">
          {space.name}
        </h3>
        {space.description && (
          <p className="mt-0.5 truncate text-[11.5px] text-gray-500">
            {space.description}
          </p>
        )}
        <div className="mt-2 flex gap-3 text-[10.5px] font-medium text-gray-500">
          <span>{space.entity_count} entities</span>
          <span>{space.edge_count} edges</span>
          <span>{space.cycle_count} cycles</span>
        </div>
      </div>
    </Link>
  );
}
