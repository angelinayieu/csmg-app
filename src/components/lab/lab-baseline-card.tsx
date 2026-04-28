"use client";

// ── Lab Baseline Card (Phase 5A) ────────────────────────────────
//
// Top-left subject focus card. Mirrors the photo's "SUBJECT" panel:
//   • Focus icon + subject name
//   • Baseline summary (one-line scope)
//   • Source citation footer (drawn from baseline_snapshot meta or
//     the subject's source_ref)
//   • "Healthy Young Adult / Age 20-35 / K=4.0±0.8" style metric strip
//
// Pure presentation — receives the subject + live conditions + a
// summary of the active modulator state, doesn't mutate. Hidden when
// no subject is in scope.

import type { Subject, SubjectFocusKind } from "@/types/subject";
import { User, FileText, Package, BookOpen, Globe, Network, Database, Atom, CircleDot } from "lucide-react";

const FOCUS_ICON: Record<
  SubjectFocusKind,
  React.ComponentType<{ className?: string }>
> = {
  person: User,
  document: FileText,
  product: Package,
  topic: BookOpen,
  environment: Globe,
  system: Network,
  data: Database,
  reaction: Atom,
  other: CircleDot,
};

interface LabBaselineCardProps {
  subject: Subject;
  /** Lifted live conditions from SpaceLab. Counts non-null entries
   *  for the "N conditions active" footer. */
  conditions: Record<string, number | string | null>;
  /** Optional source citation surfaced in the footer (e.g. the
   *  baseline_snapshot's name or the subject's source_ref). */
  sourceCitation?: string | null;
}

export function LabBaselineCard({
  subject,
  conditions,
  sourceCitation,
}: LabBaselineCardProps) {
  const Icon = FOCUS_ICON[subject.focus_kind] ?? CircleDot;
  const conditionCount = Object.values(conditions).filter(
    (v) => v !== null && v !== undefined && v !== "",
  ).length;

  return (
    <section className="border-b border-white/[0.06] bg-gradient-to-br from-[rgba(20,30,55,0.6)] to-[rgba(10,15,30,0.6)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
              Subject
            </span>
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#a8b8d0]">
              {subject.focus_kind}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-[#9bb5e0]" />
            <h3
              className="truncate text-[14px] font-semibold tracking-tight text-[#e8edf4]"
              title={subject.name}
            >
              {subject.name}
            </h3>
          </div>
          {subject.description && (
            <p
              className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-[#7a8da8]"
              title={subject.description}
            >
              {subject.description}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9.5px] font-semibold text-emerald-300"
            title={`${subject.artifact_state} — drives KG-growth aggression for this twin`}
          >
            {subject.artifact_state.replace(/_/g, " ")}
          </span>
          <span
            className="text-[9.5px] font-mono text-[#a8b8d0]"
            title={`${conditionCount} condition${conditionCount === 1 ? "" : "s"} configured`}
          >
            {conditionCount} condition{conditionCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {sourceCitation && (
        <div
          className="mt-2 truncate border-t border-white/[0.04] pt-2 text-[9.5px] text-[#6a7a95]"
          title={sourceCitation}
        >
          <span className="font-semibold text-[#7a8da8]">Source. </span>
          {sourceCitation}
        </div>
      )}
    </section>
  );
}
