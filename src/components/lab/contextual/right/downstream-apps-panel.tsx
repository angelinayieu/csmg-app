"use client";

// ── Downstream Apps Panel (L3 / D14) ─────────────────────────────────
//
// "Lab feeds" — surfaces the paired downstream applications the Lab
// run is informing. For the cognitive template's two paired apps:
//
//   🎮 Cognitive Game Development
//      Targets: working memory, attention, executive function
//      [Open Game →]
//
//   📊 Cognitive Measurement
//      Instrument battery:
//        ☑ Digit Span    ☑ N-Back    ☑ Corsi Block
//        ☑ Mental Rot.   ☑ Reading   ☑ FACT-Cog
//      [Open Measurement →]
//
// Right-rail panel mirroring CompositionPanel's visual style. Reads
// from useLabDownstreamApps + matches the cognitive-template seed
// shape (game + measurement entries with dominant_entity_codes).
//
// Instrument selection state is EPHEMERAL in this first pass — clicking
// a checkbox toggles a local Set. Future L3b will persist selections
// to the Subject's experiment_log so a what-if run carries the
// instrument battery into its scoring downstream.

import { useState } from "react";
import Link from "next/link";
import { Gamepad2, BarChart3, ArrowUpRight, FlaskConical, Activity } from "lucide-react";
import {
  useLabDownstreamApps,
  humanizeEntityCode,
  type DownstreamAppRow,
  type ApplicationType,
} from "../../hooks/use-lab-downstream-apps";
import { APPLICATION_TYPE_ACCENT } from "@/components/canvas/hooks/use-space-app-pairs";

// ── Icon + label maps ────────────────────────────────────────────────

const TYPE_ICON: Record<ApplicationType, React.ComponentType<{ className?: string }>> = {
  game: Gamepad2,
  measurement: BarChart3,
  intervention: FlaskConical,
  analysis: Activity,
  educational: Activity,
  clinical: Activity,
  other: Activity,
};

const TYPE_LABEL: Record<ApplicationType, string> = {
  game: "Game",
  measurement: "Measurement",
  intervention: "Intervention",
  analysis: "Analysis",
  educational: "Educational",
  clinical: "Clinical",
  other: "Other",
};

const TYPE_TARGETS_HEADER: Record<ApplicationType, string> = {
  game: "Targets",
  measurement: "Instrument battery",
  intervention: "Levers",
  analysis: "Variables",
  educational: "Topics",
  clinical: "Indications",
  other: "Scope",
};

// ── Panel ────────────────────────────────────────────────────────────

export interface DownstreamAppsPanelProps {
  spaceId: string;
  /** Optional Twin name shown in the header for context. */
  subjectName?: string;
}

export function DownstreamAppsPanel({
  spaceId,
  subjectName,
}: DownstreamAppsPanelProps) {
  const { all, loading } = useLabDownstreamApps(spaceId);

  // First-pass: only render the panel when at least one app exists.
  // Otherwise the right rail stays clean for spaces without
  // downstream apps yet.
  if (loading) {
    return (
      <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Lab feeds
        </div>
        <div className="mt-2 text-[10.5px] text-[#a1a1a6]">Loading apps…</div>
      </div>
    );
  }
  if (all.length === 0) return null;

  return (
    <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Lab feeds
          </span>
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">
          {all.length} {all.length === 1 ? "app" : "apps"}
        </div>
      </div>

      {subjectName && (
        <div className="mb-2.5 text-[10.5px] text-[#86868b]">
          downstream of{" "}
          <span className="font-semibold text-[#1d1d1f]">{subjectName}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {all.map((app) => (
          <DownstreamAppCard key={app.id} spaceId={spaceId} app={app} />
        ))}
      </div>
    </div>
  );
}

// ── App card ─────────────────────────────────────────────────────────

function DownstreamAppCard({
  spaceId,
  app,
}: {
  spaceId: string;
  app: DownstreamAppRow;
}) {
  const appType = app.application_type;
  const accent = appType
    ? APPLICATION_TYPE_ACCENT[appType]
    : APPLICATION_TYPE_ACCENT.other;
  const Icon = appType ? TYPE_ICON[appType] : Activity;
  const typeLabel = appType ? TYPE_LABEL[appType] : "App";
  const targetsHeader = appType ? TYPE_TARGETS_HEADER[appType] : "Scope";

  const targets = app.dominant_entity_codes ?? [];
  // Only measurement apps get checkable rows. Game/other apps render
  // their targets as plain comma-list. This mirrors the seed shape:
  // measurement.dominant_entity_codes = instrument list (toggleable),
  // game.dominant_entity_codes = entity targets (informational).
  const isMeasurement = appType === "measurement";

  return (
    <div
      className="rounded-[10px] border bg-white px-3 py-2.5 transition-shadow hover:shadow-sm"
      style={{ borderColor: `${accent}30` }}
    >
      {/* Header row: icon + name + type chip + open link */}
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px]"
          style={{ background: `${accent}18`, color: accent }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 truncate text-[12.5px] font-semibold text-[#1d1d1f]">
          {app.name}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em]"
          style={{ background: `${accent}1a`, color: accent }}
          title={`application_type: ${appType ?? "unspecified"}`}
        >
          {typeLabel}
        </span>
      </div>

      {/* Tagline / description */}
      {(app.tagline || app.description) && (
        <div className="mb-2 line-clamp-2 text-[11px] text-[#6e6e73]">
          {app.tagline ?? app.description}
        </div>
      )}

      {/* Targets / instrument list */}
      {targets.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#a1a1a6]">
            {targetsHeader}
          </div>
          {isMeasurement ? (
            <InstrumentChecklist instrumentCodes={targets} accent={accent} />
          ) : (
            <div className="flex flex-wrap gap-1">
              {targets.slice(0, 6).map((code) => (
                <span
                  key={code}
                  className="rounded-md bg-[#f8f8fa] px-1.5 py-0.5 text-[10px] text-[#52525b]"
                >
                  {humanizeEntityCode(code)}
                </span>
              ))}
              {targets.length > 6 && (
                <span className="text-[10px] text-[#a1a1a6]">
                  +{targets.length - 6} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pair indicator + open link */}
      <div className="flex items-center justify-between">
        {app.complementary_app_ids.length > 0 ? (
          <span className="text-[10px] text-[#86868b]">
            ↔ paired with {app.complementary_app_ids.length}{" "}
            {app.complementary_app_ids.length === 1 ? "app" : "apps"}
          </span>
        ) : (
          <span />
        )}
        <Link
          href={`/app/space/${spaceId}/app/${app.id}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors"
          style={{ color: accent }}
        >
          Open {typeLabel}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ── Instrument checklist (measurement apps) ──────────────────────────

function InstrumentChecklist({
  instrumentCodes,
  accent,
}: {
  instrumentCodes: string[];
  accent: string;
}) {
  // Default ALL instruments to selected — typical first-run intent for
  // a measurement app is "score the full battery." User can toggle off.
  // Ephemeral state in v1; future v2 persists to Subject experiment.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(instrumentCodes),
  );

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
      {instrumentCodes.map((code) => {
        const isOn = selected.has(code);
        return (
          <button
            key={code}
            type="button"
            onClick={() => toggle(code)}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[10.5px] transition-colors hover:bg-black/[0.03]"
          >
            <span
              className="grid h-[12px] w-[12px] place-items-center rounded-[3px] border"
              style={{
                borderColor: isOn ? accent : "#d2d2d7",
                background: isOn ? accent : "white",
              }}
            >
              {isOn && (
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1.5 4 L3.2 5.7 L6.5 2.3"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span
              className={
                isOn ? "font-medium text-[#1d1d1f]" : "text-[#a1a1a6]"
              }
            >
              {humanizeEntityCode(code)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
