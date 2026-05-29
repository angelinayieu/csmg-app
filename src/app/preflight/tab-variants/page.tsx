// Preflight comparison harness for the top HomeTabNav redesigns.
// Renders a baseline replica of the current nav next to four candidate
// directions. Each is interactive (click to switch the active tab) so
// the motion reads. Public route. SAFE TO DELETE once chosen.

"use client";

import { useState } from "react";
import { LayoutGrid, FlaskConical, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { TAB_VARIANTS, type TabItem } from "./tab-variants";

const TABS: TabItem[] = [
  { label: "Objective Canvas", icon: LayoutGrid },
  { label: "Synergy", icon: Sparkles },
  { label: "Strategy Lab", icon: FlaskConical },
];

// Faithful static replica of the current production nav (no routing),
// shown as the baseline to compare against.
function BaselineNav({ active }: { active: number }) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full p-1 backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)",
      }}
    >
      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const on = i === active;
        return (
          <span
            key={tab.label}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold"
            style={{
              background: on ? "rgba(15,23,42,0.92)" : "transparent",
              color: on ? "white" : "rgba(15,23,42,0.62)",
            }}
          >
            <Icon className="h-3 w-3" strokeWidth={on ? 2 : 1.75} />
            {tab.label}
          </span>
        );
      })}
    </div>
  );
}

function Row({
  name,
  blurb,
  children,
}: {
  name: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-4 rounded-3xl px-6 py-7"
      style={{
        background: "rgba(255,255,255,0.45)",
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: "0 10px 30px -20px rgba(11,18,40,0.25)",
      }}
    >
      <div className="flex flex-col gap-1">
        <span
          className="text-[12.5px] font-bold tracking-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {name}
        </span>
        <span
          className="text-[11px] font-light leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          {blurb}
        </span>
      </div>
      <div className="flex min-h-[60px] items-center justify-center">{children}</div>
    </div>
  );
}

export default function TabVariantsPreviewPage() {
  // Each variant keeps its own active index so clicking one doesn't move
  // the others — lets the user play with each in isolation.
  const [activeByKey, setActiveByKey] = useState<Record<string, number>>({});
  const get = (k: string) => activeByKey[k] ?? 0;
  const set = (k: string) => (i: number) =>
    setActiveByKey((prev) => ({ ...prev, [k]: i }));

  return (
    <div
      style={{
        background:
          "radial-gradient(1100px 500px at 50% -10%, #e7ecf4 0%, #eef1f6 50%, #e9ebf0 100%)",
        minHeight: "100vh",
      }}
      className="px-6 py-10"
    >
      <div className="mx-auto max-w-3xl">
        <div
          className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Preflight · Top nav redesigns
        </div>
        <p
          className="mb-7 text-[13px] leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          Four candidate directions for the top tab nav, plus the current
          baseline. Each is live — click the tabs to feel the motion. Tell me
          the letter and I&apos;ll promote it into the real{" "}
          <code className="rounded bg-[rgba(15,23,42,0.06)] px-1">HomeTabNav</code>.
        </p>

        <div className="flex flex-col gap-5">
          <Row
            name="Current (baseline)"
            blurb="Today's production nav — a solid dark pill snaps onto the active tab (no transition)."
          >
            <BaselineNav active={get("baseline")} />
          </Row>

          {TAB_VARIANTS.map(({ key, name, blurb, Component }) => (
            <Row key={key} name={name} blurb={blurb}>
              <Component tabs={TABS} active={get(key)} onSelect={set(key)} />
            </Row>
          ))}
        </div>

        {/* baseline interactivity: small segmented control to drive it */}
        <div className="mt-6 flex items-center gap-2">
          <span
            className="text-[11px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
          >
            Baseline active tab:
          </span>
          {TABS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => set("baseline")(i)}
              className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
              style={{
                background:
                  get("baseline") === i ? "rgba(15,23,42,0.92)" : "rgba(15,23,42,0.06)",
                color: get("baseline") === i ? "white" : appleVibe.text.secondary,
              }}
            >
              {t.label.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
