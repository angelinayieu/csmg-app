"use client";

// ── Twin Detail Client — the tabbed shell ──────────────────────────
//
// Frosted-glass panel with 4 tabs:
//   1. Overview  — narrator + 3 hero metrics + coach card
//   2. System    — Workflow / Layers / Mechanisms view modes
//   3. Outcomes  — pain metrics + fidelity strip + prediction history
//   4. Operating — embeds existing OperatingTwinShell (gated)
//
// Uses the design tokens in globals.css (--glass-float-bg, --shadow-float,
// --blur-float, --ease-out-quart, --dur-normal) so it inherits the
// Vision-Pro-adjacent surface language without hand-rolling values.
//
// Parallax tilt + scene backdrop match the rest of the synergy track.

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MoveRight } from "lucide-react";
import { SynergySceneBackground } from "@/components/synergy/synergy-scene-background";
import { useParallax } from "@/hooks/synergy/use-parallax";
import { TwinPageHeader } from "./parts/twin-page-header";
import { TwinOverviewTab } from "./tabs/twin-overview-tab";
import { TwinSystemTab } from "./tabs/twin-system-tab";
import { TwinOutcomesTab } from "./tabs/twin-outcomes-tab";
import { TwinOperatingTab } from "./tabs/twin-operating-tab";
import { TwinActionDispatcher } from "./parts/twin-action-dispatcher";
import { useTwinPageBundleRealtime } from "./hooks/use-twin-page-bundle-realtime";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

export type TwinTabKey = "overview" | "system" | "outcomes" | "operating";

interface Props {
  spaceId: string;
  initialBundle: TwinPageBundle | null;
  initialCached: boolean;
  initialCachedAt: string | null;
  initialTab?: TwinTabKey;
}

export function TwinDetailClient({
  spaceId,
  initialBundle,
  initialCached,
  initialCachedAt,
  initialTab,
}: Props) {
  const [bundle, setBundle] = useState<TwinPageBundle | null>(initialBundle);
  const [activeTab, setActiveTab] = useState<TwinTabKey>(initialTab ?? "overview");
  const panelRef = useRef<HTMLElement>(null);

  // Pointer parallax on the panel — same hook the strategy doc uses.
  // Auto-disables for prefers-reduced-motion + touch devices.
  useParallax(panelRef, { maxTiltDeg: 0.4 });

  // W3 — subscribes to Supabase realtime channels for the 5 tables
  // that drive this page. Bundle refetches on a 300ms-debounced
  // trailing edge. lastEventAt lets the header flash a "live" pulse.
  const { lastEventAt } = useTwinPageBundleRealtime(spaceId, (next) =>
    setBundle(next),
  );

  // Bundle invalidation helper — actions call this after mutating
  // server state so the page reflects the change. Bypasses the
  // 5-min TTL by cache:no-store.
  const refetchBundle = async () => {
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/twin-page-bundle`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { bundle: TwinPageBundle };
      setBundle(json.bundle);
    } catch {
      /* non-fatal */
    }
  };

  // ── Empty / error state ──────────────────────────────────────────
  if (!bundle) {
    return (
      <>
        <SynergySceneBackground preset="mist" customUrl={null} />
        <div className="mx-auto max-w-3xl px-6 py-16">
          <Link
            href={`/app/space/${spaceId}`}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-gray-600 transition hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to space
          </Link>
          <article
            className="mt-6 rounded-3xl p-10"
            style={{
              background: "var(--glass-card-bg)",
              boxShadow: "var(--shadow-card)",
              backdropFilter: "blur(var(--blur-card))",
              WebkitBackdropFilter: "blur(var(--blur-card))",
            }}
          >
            <h1 className="font-display-tight text-[28px] font-semibold tracking-tight text-gray-900">
              Couldn&apos;t load this twin
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-gray-600">
              The twin page bundle didn&apos;t fetch. The space might not
              exist, you might not have access, or the synthesis pipeline
              may not have run yet.
            </p>
            <Link
              href={`/app/space/${spaceId}/whiteboard`}
              className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-gray-700"
            >
              Open the space whiteboard
              <MoveRight className="h-3.5 w-3.5" />
            </Link>
          </article>
        </div>
      </>
    );
  }

  // ── Normal render ─────────────────────────────────────────────────
  return (
    <TwinActionDispatcher
      spaceId={spaceId}
      onBundleInvalidated={refetchBundle}
    >
      <SynergySceneBackground preset="mist" customUrl={null} />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <article
          ref={panelRef}
          className="relative overflow-hidden rounded-3xl"
          style={{
            background: "var(--glass-float-bg)",
            boxShadow: "var(--shadow-float)",
            backdropFilter: "blur(var(--blur-float))",
            WebkitBackdropFilter: "blur(var(--blur-float))",
          }}
        >
          {/* Top-edge highlight — visionOS "light from above" cue */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: "var(--glass-highlight)" }}
          />

          <TwinPageHeader
            spaceId={spaceId}
            bundle={bundle}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            cached={initialCached}
            cachedAt={initialCachedAt}
            lastEventAt={lastEventAt}
          />

          <div className="px-8 pb-10 pt-6">
            {activeTab === "overview" && (
              <TwinOverviewTab spaceId={spaceId} bundle={bundle} setBundle={setBundle} />
            )}
            {activeTab === "system" && (
              <TwinSystemTab spaceId={spaceId} bundle={bundle} />
            )}
            {activeTab === "outcomes" && (
              <TwinOutcomesTab spaceId={spaceId} bundle={bundle} setBundle={setBundle} />
            )}
            {activeTab === "operating" && (
              <TwinOperatingTab
                spaceId={spaceId}
                bundle={bundle}
                lastEventAt={lastEventAt}
              />
            )}
          </div>
        </article>
      </div>
    </TwinActionDispatcher>
  );
}
