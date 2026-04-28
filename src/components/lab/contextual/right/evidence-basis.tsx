"use client";

// ── Evidence Basis (right rail) ───────────────────────────────────
//
// Citation cards driven by which effects are currently active +
// the subject's archetype baseline. Each card has a colored type
// chip (Baseline / State / Task / Clinical), a title, and a
// citation line. Cards re-render as state changes — moving the
// stress slider above 5 surfaces an anxiety×stress citation only
// for anxiety subjects, etc.

import type { Archetype, Task } from "../lib/types";

export interface EvidenceBasisProps {
  subject: Archetype;
  task: Task;
  state: { sleep: number };
}

interface EvidenceItem {
  type: "Baseline" | "State" | "Task" | "Clinical";
  name: string;
  detail: string;
  color: string;
  bg: string;
}

export function EvidenceBasis({ subject, task, state }: EvidenceBasisProps) {
  const items = buildEvidenceList(subject, task, state);

  return (
    <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
        Evidence Basis
      </div>
      <div className="space-y-1.5">
        {items.map((it, idx) => (
          <div
            key={`${it.type}-${idx}`}
            className="rounded-[6px] border border-black/[0.05] bg-[#fbfbfd] px-3 py-2.5"
            style={{ borderLeftWidth: 3, borderLeftColor: it.color }}
          >
            <span
              className="mb-1 inline-block rounded-[10px] px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.04em]"
              style={{ background: it.bg, color: it.color }}
            >
              {it.type}
            </span>
            <div className="mb-px text-[12px] font-semibold leading-[1.25] text-[#1d1d1f]">
              {it.name}
            </div>
            <div className="text-[10px] leading-[1.35] text-[#6e6e73]">
              {it.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildEvidenceList(
  subject: Archetype,
  task: Task,
  state: { sleep: number },
): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      type: "Baseline",
      name: `${subject.name} profile`,
      detail: subject.source,
      color: "#af52de",
      bg: "#f5e9fa",
    },
  ];

  // Sleep-deficit citation surfaces when sleep < 7h.
  if (state.sleep < 7) {
    items.push({
      type: "State",
      name: "Sleep deprivation effect",
      detail: "Lim & Dinges 2010 meta-analysis: g=-0.5 for WM",
      color: "#ff9500",
      bg: "#fff3e0",
    });
  }

  // Domain expertise citation when subject's expertise matches task.
  if (
    task.domainBoost &&
    subject.expertise &&
    subject.expertise === task.domainBoost
  ) {
    items.push({
      type: "Task",
      name: "Domain expertise transfer",
      detail: "Gobet & Simon 1996 (template theory)",
      color: "#007aff",
      bg: "#e6f1ff",
    });
  }

  // Clinical citations per archetype flag.
  if (subject.flags.includes("adhd")) {
    items.push({
      type: "Clinical",
      name: "ADHD attentional control deficit",
      detail: "Alderson et al. 2013 meta-analysis, d≈0.55",
      color: "#ff375f",
      bg: "#ffe8ec",
    });
  }
  if (subject.flags.includes("anxiety")) {
    items.push({
      type: "Clinical",
      name: "Anxiety × WM under load",
      detail: "Moran 2016 meta-analysis: WM d≈0.35–0.45",
      color: "#ff375f",
      bg: "#ffe8ec",
    });
  }
  if (subject.flags.includes("depression")) {
    items.push({
      type: "Clinical",
      name: "Depression executive deficit",
      detail: "Rock et al. 2014 meta-analysis (MDD cognitive deficits)",
      color: "#ff375f",
      bg: "#ffe8ec",
    });
  }
  if (subject.flags.includes("age_decline")) {
    items.push({
      type: "Clinical",
      name: "Age-related executive decline",
      detail: "Salthouse 2010; Park & Reuter-Lorenz 2009",
      color: "#ff375f",
      bg: "#ffe8ec",
    });
  }

  return items;
}
