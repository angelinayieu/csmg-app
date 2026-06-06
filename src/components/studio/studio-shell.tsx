"use client";

/**
 * StudioShell — the post-auth landing surface at /app.
 *
 * Replaces WelcomeHero + EcosystemSection + GlobalQueryBox with a deliberately
 * minimal, layered composition:
 *
 *   Layer 1 — first glance:
 *     A single question, one universal dropzone, and (if returning) a quiet
 *     row of model tiles. That's all the user sees above the fold.
 *
 *   Layer 2 — hover:
 *     Each model tile reveals its pulse breakdown with one-click deep links.
 *
 *   Layer 3 — ⌘K:
 *     A cross-model command palette opens in place. Power layer for users
 *     who have >5 models.
 *
 *   Layer 4 — scroll:
 *     A complete model index (the legacy space list) lives below the fold
 *     for users who want to see everything, without polluting the first
 *     screen.
 *
 * The shell fetches its pulse data client-side so returning to /app always
 * shows fresh activity, but the initial paint renders from the server-loaded
 * space list — no layout shift.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Command as CommandIcon, Settings, Radar, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Space } from "@/types";
import type { Reaction } from "@/types/reactions";
import type { SpacePulse, StudioPulseResponse } from "@/app/api/spaces/pulse/route";
import { StudioDropzone } from "./studio-dropzone";
import { PulseTile } from "./pulse-tile";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { StudioContinueRow } from "./studio-continue-row";

interface StudioShellProps {
  greetingName: string;
  spaces: Space[];
  recentReactions?: Reaction[];
}

export function StudioShell({
  greetingName,
  spaces,
  recentReactions = [],
}: StudioShellProps) {
  const [pulses, setPulses] = useState<SpacePulse[] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useCommandPaletteShortcut(useCallback(() => setPaletteOpen(true), []));

  // Client-side pulse fetch — keeps first paint fast (server sends the space
  // list), then enriches with activity deltas after hydration.
  useEffect(() => {
    let cancelled = false;
    async function fetchPulse() {
      try {
        const res = await fetch("/api/spaces/pulse");
        if (!res.ok) return;
        const data = (await res.json()) as StudioPulseResponse;
        if (!cancelled) setPulses(data.spaces);
      } catch {
        // non-fatal — tiles degrade to name-only rendering
      }
    }
    fetchPulse();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstRun = spaces.length === 0;

  // Lookup kind by space id so PulseTile can badge ask-kind whiteboards.
  const kindById = useMemo(() => {
    const m = new Map<string, "analysis" | "ask">();
    for (const s of spaces) {
      const k = (s as unknown as { kind?: "analysis" | "ask" }).kind ?? "analysis";
      m.set(s.id, k);
    }
    return m;
  }, [spaces]);

  // When pulse data hasn't arrived yet, render fallback tiles from the
  // server-sent space list so the user never sees an empty frame.
  const tileData: SpacePulse[] = useMemo(() => {
    if (pulses) return pulses;
    return spaces.slice(0, 8).map((s) => ({
      space_id: s.id,
      name: s.name,
      updated_at: s.updated_at,
      entity_count: s.entity_count ?? 0,
      edge_count: s.edge_count ?? 0,
      new_edges_24h: 0,
      new_proposals_pending: 0,
      open_questions: 0,
      unresolved_cycles: 0,
      last_activity_at: s.updated_at,
      pulse: "quiet",
      headline: "Loading activity…",
    }));
  }, [pulses, spaces]);

  const visibleTiles = tileData.slice(0, 6);
  const overflowCount = Math.max(0, tileData.length - visibleTiles.length);

  return (
    <div className="relative -m-6 min-h-screen">
      {/* Soft gradient backdrop — deliberately quiet. No animated ecosystem. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(1200px 600px at 50% -10%, rgba(10,106,238,0.08), transparent 60%), linear-gradient(180deg, #f8fafe 0%, #f3f5f9 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col px-6 py-5">
        {/* Top strip — greeting + utility buttons */}
        <div className="flex items-center">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              Studio
            </span>
            <span className="text-[11px] text-gray-400">·</span>
            <span className="text-[12px] font-medium text-gray-600">
              {greetingName}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 backdrop-blur-sm transition-all hover:border-gray-300 hover:bg-white"
              title="Open command palette"
            >
              <CommandIcon className="h-3 w-3" />
              Command
              <span className="ml-1 rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[9px] font-bold text-gray-500">⌘K</span>
            </button>
            <Link
              href="/app/settings"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white/80 text-gray-500 backdrop-blur-sm transition-all hover:border-gray-300 hover:bg-white hover:text-gray-800"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Above-the-fold: dropzone centered, tiles below */}
        <div className="flex flex-1 flex-col items-center justify-center gap-10 pt-8">
          <StudioDropzone firstRun={firstRun} />

          {/* Phase 42 — Continue row. Most-recent reactions across every
              space the user owns, deep-linked into their labs. Lands
              returning users straight into where they left off. */}
          {recentReactions.length > 0 && (
            <StudioContinueRow
              reactions={recentReactions}
              spaces={spaces}
            />
          )}

          {/* Model row — tight, horizontal, up to 6 tiles */}
          {!firstRun && (
            <div className="w-full max-w-[1040px]">
              <div className="mb-3 flex items-center gap-2">
                <Radar className="h-3 w-3 text-gray-400" />
                <h2 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gray-500">
                  Your models · Pulse
                </h2>
                <div className="h-px flex-1 bg-gray-200/70" />
                {overflowCount > 0 && (
                  <span className="text-[10px] font-medium text-gray-400">
                    +{overflowCount} more below
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleTiles.map((p) => (
                  <PulseTile key={p.space_id} pulse={p} kind={kindById.get(p.space_id)} />
                ))}
              </div>

              {/* Scroll cue */}
              {overflowCount > 0 && (
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={() => {
                      document
                        .getElementById("studio-full-index")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/60 px-3 py-1 text-[10px] font-semibold text-gray-500 backdrop-blur-sm transition-all hover:bg-white hover:text-gray-800"
                  >
                    <ArrowDown className="h-3 w-3" />
                    See all models
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Below-the-fold: full model index */}
        {!firstRun && (
          <section
            id="studio-full-index"
            className="mx-auto mt-24 w-full max-w-[1040px] pb-16"
          >
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-[13px] font-bold text-gray-800">All models</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                {tileData.length}
              </span>
              <div className="h-px flex-1 bg-gray-200/70" />
              <Link
                href="/app/analyze"
                className="text-[11px] font-semibold text-interaxis-600 hover:text-interaxis-700"
              >
                + New model
              </Link>
            </div>

            <div className={cn(
              "grid gap-3",
              "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            )}>
              {tileData.map((p) => (
                <PulseTile key={`all-${p.space_id}`} pulse={p} kind={kindById.get(p.space_id)} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Command palette — portalled via fixed positioning */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        spaces={spaces}
      />
    </div>
  );
}
