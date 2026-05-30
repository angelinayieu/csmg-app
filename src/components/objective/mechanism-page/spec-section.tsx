"use client";

// ── §3 Spec ───────────────────────────────────────────────────────
//
// The fused mechanism spec — what used to be 4 separate tabs
// (Summary, Data flow, Experience, Engineering) is now one section
// with collapsible subsections. Summary stays always-visible because
// it's the headline; the three deeper views open on click.
//
// Reuses the standalone visualizations (MechanismDataflowView,
// MechanismExperienceView) directly — no fork.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MechanismDataflowView } from "@/components/objective/mechanism-dataflow-view";
import { MechanismExperienceView } from "@/components/objective/mechanism-experience-view";
import type { MechanismSpec } from "@/lib/objective-canvas/enrich-mechanism-spec";
import { SectionHeader } from "./section-header";

interface SpecEntity {
  id: string;
  expanded_detail: Record<string, unknown>;
}

interface Props {
  entity: SpecEntity;
}

const EVIDENCE_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  established: {
    label: "Established",
    bg: "rgba(34,197,94,0.12)",
    fg: "rgba(21,128,61,0.95)",
  },
  plausible: {
    label: "Plausible",
    bg: "rgba(59,130,246,0.10)",
    fg: "rgba(37,99,235,0.92)",
  },
  speculative: {
    label: "Speculative",
    bg: "rgba(217,119,6,0.12)",
    fg: "rgba(146,64,14,0.92)",
  },
};

export function SpecSection({ entity }: Props) {
  const ed = entity.expanded_detail as { mechanism_spec?: MechanismSpec | null };
  const spec = ed.mechanism_spec ?? null;

  if (!spec) {
    return (
      <div>
        <SectionHeader
          number="3"
          title="Spec"
          subtitle="The engineering-grade mechanism description."
        />
        <div
          className="rounded-lg border border-dashed px-4 py-8 text-center"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          <p
            className="text-[13.5px] font-light italic"
            style={{ color: "rgba(15,23,42,0.5)" }}
          >
            No spec generated yet. The spec describes how this mechanism
            actually works — active ingredients, runtime flow, experience,
            and engineering detail.
          </p>
          <p
            className="mt-2 text-[12px] font-light"
            style={{ color: "rgba(15,23,42,0.45)" }}
          >
            Generate it from the room drawer, or wait for autopilot to fire
            the speccing stage.
          </p>
        </div>
      </div>
    );
  }

  const evidenceMeta = EVIDENCE_LABEL[spec.research_basis?.evidence_strength];

  return (
    <div>
      <SectionHeader
        number="3"
        title="Spec"
        subtitle="Mechanism of action · ingredients · how it works · how to validate."
        rightSlot={
          <div className="flex items-center gap-2">
            {evidenceMeta && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: evidenceMeta.bg, color: evidenceMeta.fg }}
              >
                {evidenceMeta.label}
              </span>
            )}
            {spec.quality_score && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: "rgba(15,23,42,0.06)",
                  color: "rgba(15,23,42,0.62)",
                }}
                title="Quality gate composite — unweighted mean of 6 axes."
              >
                Q {Math.round(qualityComposite(spec.quality_score) * 100)}
              </span>
            )}
          </div>
        }
      />

      {/* Mechanism of action — always visible */}
      <div className="mb-6">
        <div
          className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Mechanism of action
        </div>
        <p
          className="text-[14px] font-light leading-relaxed"
          style={{ color: "rgba(15,23,42,0.82)" }}
        >
          {spec.mechanism_of_action}
        </p>
        {spec.user_visible_behavior && (
          <p
            className="mt-2 text-[12.5px] font-light italic leading-relaxed"
            style={{ color: "rgba(15,23,42,0.62)" }}
          >
            What the user sees: {spec.user_visible_behavior}
          </p>
        )}
      </div>

      {/* Active ingredients — always visible (compact chip grid) */}
      {Array.isArray(spec.active_ingredients) && spec.active_ingredients.length > 0 && (
        <div className="mb-6">
          <div
            className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: "rgba(15,23,42,0.45)" }}
          >
            Active ingredients · {spec.active_ingredients.length}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {spec.active_ingredients.map((ai, i) => (
              <div
                key={i}
                className="rounded-lg border p-3"
                style={{
                  borderColor: "rgba(15,23,42,0.08)",
                  background: "#ffffff",
                }}
              >
                <div
                  className="text-[13px] font-semibold"
                  style={{ color: "rgba(15,23,42,0.88)" }}
                >
                  {ai.name}
                </div>
                <div
                  className="mt-1 text-[12px] font-light leading-relaxed"
                  style={{ color: "rgba(15,23,42,0.65)" }}
                >
                  {ai.role}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible subsections */}
      {spec.runtime_flow && spec.runtime_flow.length > 0 && (
        <Collapsible
          title="Data flow"
          subtitle={`${spec.runtime_flow.length} runtime step${spec.runtime_flow.length === 1 ? "" : "s"} · components, data, behavior`}
        >
          <div className="mt-3 rounded-lg border" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
            <MechanismDataflowView spec={spec} />
          </div>
        </Collapsible>
      )}

      {spec.design_intent && (
        <Collapsible
          title="Experience"
          subtitle="Visual + interaction design intent for the mechanism's UI."
        >
          <div className="mt-3">
            <MechanismExperienceView spec={spec} />
          </div>
        </Collapsible>
      )}

      <Collapsible
        title="Engineering"
        subtitle="Procedure, components, dosage, fidelity, acceptance — the build-side detail."
      >
        <EngineeringDetail spec={spec} />
      </Collapsible>

      <Collapsible
        title="Research basis"
        subtitle="Evidence strength · validation experiment · citations."
      >
        <ResearchBasis spec={spec} />
      </Collapsible>
    </div>
  );
}

function Collapsible({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="mb-4 rounded-xl border"
      style={{
        borderColor: "rgba(15,23,42,0.08)",
        background: open ? "rgba(15,23,42,0.015)" : "#ffffff",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div
            className="text-[13.5px] font-semibold"
            style={{ color: "rgba(15,23,42,0.88)" }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              className="mt-0.5 text-[11.5px] font-light"
              style={{ color: "rgba(15,23,42,0.5)" }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {open ? (
          <ChevronDown
            className="h-4 w-4 shrink-0"
            style={{ color: "rgba(15,23,42,0.5)" }}
          />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0"
            style={{ color: "rgba(15,23,42,0.5)" }}
          />
        )}
      </button>
      {open && (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function EngineeringDetail({ spec }: { spec: MechanismSpec }) {
  return (
    <div className="space-y-4">
      {Array.isArray(spec.how_it_works) && spec.how_it_works.length > 0 && (
        <Block label="Procedure">
          <ol className="space-y-1">
            {spec.how_it_works.map((step, i) => (
              <li
                key={i}
                className="text-[12.5px] font-light leading-relaxed"
                style={{ color: "rgba(15,23,42,0.72)" }}
              >
                {i + 1}. {step}
              </li>
            ))}
          </ol>
        </Block>
      )}

      {Array.isArray(spec.system_components) && spec.system_components.length > 0 && (
        <Block label="System components">
          <ul className="space-y-2">
            {spec.system_components.map((c, i) => (
              <li
                key={i}
                className="text-[12.5px] font-light leading-relaxed"
                style={{ color: "rgba(15,23,42,0.72)" }}
              >
                <span
                  className="font-semibold"
                  style={{ color: "rgba(15,23,42,0.85)" }}
                >
                  {c.name}
                </span>
                {c.category && (
                  <span style={{ color: "rgba(15,23,42,0.45)" }}> · {c.category}</span>
                )}
                {c.detail && <div>{c.detail}</div>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {spec.dosage && <Block label="Dosage">{spec.dosage}</Block>}

      {Array.isArray(spec.fidelity_signals) && spec.fidelity_signals.length > 0 && (
        <Block label="Fidelity signals">
          <BulletList items={spec.fidelity_signals} />
        </Block>
      )}

      {Array.isArray(spec.acceptance_criteria) && spec.acceptance_criteria.length > 0 && (
        <Block label="Acceptance criteria (done conditions)">
          <BulletList items={spec.acceptance_criteria} />
        </Block>
      )}

      {Array.isArray(spec.scope_boundaries) && spec.scope_boundaries.length > 0 && (
        <Block label="Scope boundaries (non-goals)">
          <BulletList items={spec.scope_boundaries} />
        </Block>
      )}

      {Array.isArray(spec.kill_criteria) && spec.kill_criteria.length > 0 && (
        <Block label="Kill criteria">
          <BulletList items={spec.kill_criteria} />
        </Block>
      )}
    </div>
  );
}

function ResearchBasis({ spec }: { spec: MechanismSpec }) {
  const rb = spec.research_basis;
  if (!rb) return null;
  return (
    <div className="space-y-3">
      {rb.evidence_strength && (
        <Block label="Evidence strength">
          <span
            className="text-[13px] font-semibold"
            style={{ color: "rgba(15,23,42,0.85)" }}
          >
            {rb.evidence_strength}
          </span>
        </Block>
      )}
      {rb.basis && (
        <Block label="Basis">
          <p
            className="text-[12.5px] font-light leading-relaxed"
            style={{ color: "rgba(15,23,42,0.72)" }}
          >
            {rb.basis}
          </p>
        </Block>
      )}
      {rb.validation_experiment && (
        <Block label="Validation experiment">
          <p
            className="text-[12.5px] font-light leading-relaxed"
            style={{ color: "rgba(15,23,42,0.72)" }}
          >
            {rb.validation_experiment}
          </p>
        </Block>
      )}
    </div>
  );
}

// Quality composite — unweighted mean of the 6 axes. The type does
// not carry a pre-computed composite (intentionally, so callers can
// pick their own weighting). We mirror the rubric scorer's choice
// here: equal weights, just a readout.
function qualityComposite(q: import("@/lib/objective-canvas/enrich-mechanism-spec").MechanismQualityScore): number {
  return (
    (q.specificity +
      q.technical_depth +
      q.measurability +
      q.ui_connection +
      q.feasibility +
      q.failure_mode_clarity) /
    6
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "rgba(15,23,42,0.45)" }}
      >
        {label}
      </div>
      <div
        className="text-[12.5px] font-light leading-relaxed"
        style={{ color: "rgba(15,23,42,0.72)" }}
      >
        {children}
      </div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((s, i) => (
        <li key={i}>· {s}</li>
      ))}
    </ul>
  );
}
