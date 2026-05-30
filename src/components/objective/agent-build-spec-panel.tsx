"use client";

// ── Agent Build Spec Panel (P1.2-B, Item 4) ───────────────────────
//
// Full-screen read-out of the compiled AgentBuildSpec, opened from the
// Strategy Brief. Document-first (like the brief): macro → conceptual →
// data → flow → features → design → decisions → sequence. Copy (the
// rendered markdown) + Download .md (the route's ?format=md). The heavy
// rendering lives here so strategy-brief-view.tsx stays a thin edit.
//
// `import type` only for AgentBuildSpec — the compile lib is server-side
// (imports llmJSON); the type is erased so nothing server lands in the
// client bundle.

import { useCallback, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import type { AgentBuildSpec } from "@/lib/objective-canvas/compile-agent-build-spec";

const C = {
  ink: "rgba(15,23,42,0.92)",
  inkSoft: "rgba(15,23,42,0.66)",
  inkMuted: "rgba(15,23,42,0.5)",
  inkFaint: "rgba(15,23,42,0.4)",
  rule: "rgba(15,23,42,0.08)",
  accent: "rgba(76,29,149,0.95)",
  accentSoft: "rgba(124,58,237,0.08)",
  accentBorder: "rgba(124,58,237,0.20)",
  paper: "#ffffff",
  bg: "#fafafa",
};
const FONT =
  'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

interface Props {
  spaceId: string;
  spec: AgentBuildSpec;
  markdown: string;
  stale?: boolean;
  onClose: () => void;
}

export function AgentBuildSpecPanel({
  spaceId,
  spec,
  markdown,
  stale,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard may be blocked
    }
  }, [markdown]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: C.bg, fontFamily: FONT }}
    >
      {/* header */}
      <div
        className="sticky top-0 z-10"
        style={{
          background: "rgba(250,250,250,0.92)",
          borderBottom: `1px solid ${C.rule}`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          className="mx-auto flex items-center justify-between gap-4 px-6 py-3"
          style={{ maxWidth: 940 }}
        >
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: C.inkMuted }}
          >
            Agent Build Spec
            {stale && (
              <span
                className="ml-2 normal-case tracking-normal"
                style={{ color: C.inkFaint }}
              >
                · canvas changed since this was compiled
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Btn onClick={handleCopy}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy markdown"}
            </Btn>
            <a
              href={`/api/brainstorm/space/${spaceId}/agent-spec?format=md`}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
              style={{
                background: C.accentSoft,
                color: C.accent,
                border: `1px solid ${C.accentBorder}`,
              }}
            >
              <Download className="h-3 w-3" />
              Download .md
            </a>
            <Btn onClick={onClose}>
              <X className="h-3 w-3" />
              Close
            </Btn>
          </div>
        </div>
      </div>

      {/* document */}
      <article
        className="mx-auto px-8 pb-32 pt-12"
        style={{
          maxWidth: 720,
          color: C.ink,
          background: C.paper,
          marginTop: 28,
          marginBottom: 64,
          borderRadius: 12,
          boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
        }}
      >
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: C.inkFaint }}
        >
          Agent build spec
        </p>
        <h1
          className="mt-2 text-[26px] font-semibold leading-tight tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          {spec.macro_architecture.distilled_objective ||
            spec.product_summary ||
            spec.problem ||
            "Build spec"}
        </h1>
        {spec.product_summary && (
          <p
            className="mt-4 text-[15px] leading-relaxed"
            style={{ color: C.inkSoft }}
          >
            {spec.product_summary}
          </p>
        )}

        <Sec title="Problem & users">
          <Kv k="Problem" v={spec.problem} />
          <Kv k="Target users" v={spec.target_users} />
        </Sec>

        {(spec.goals.length > 0 || spec.success_metrics.length > 0) && (
          <Sec title="Goals & success metrics">
            {spec.goals.length > 0 && <Bul label="Goals" items={spec.goals} />}
            {spec.success_metrics.length > 0 && (
              <Bul label="Success metrics" items={spec.success_metrics} />
            )}
          </Sec>
        )}

        {spec.non_goals.length > 0 && (
          <Sec title="Non-goals — explicitly NOT building">
            <Bul items={spec.non_goals} />
          </Sec>
        )}

        {spec.tech_constraints.length > 0 && (
          <Sec title="Tech constraints">
            <Bul items={spec.tech_constraints} />
          </Sec>
        )}

        {spec.macro_architecture.layers.length > 0 && (
          <Sec title="Macro architecture — the layered system">
            {spec.macro_architecture.layers.map((l) => (
              <div key={l.id} className="mt-3">
                <p className="text-[13.5px] font-semibold">
                  {l.id} · {l.name}
                  {l.archetype && (
                    <span style={{ color: C.inkMuted }}> ({l.archetype})</span>
                  )}
                </p>
                {l.role && (
                  <p className="text-[13px]" style={{ color: C.inkSoft }}>
                    {l.role}
                  </p>
                )}
                {l.subsystems.length > 0 && (
                  <p className="text-[12.5px]" style={{ color: C.inkSoft }}>
                    <b>Subsystems:</b> {l.subsystems.join(", ")}
                  </p>
                )}
                {l.macro_problems.length > 0 && (
                  <p className="text-[12.5px]" style={{ color: C.inkSoft }}>
                    <b>Problems:</b> {l.macro_problems.join("; ")}
                  </p>
                )}
              </div>
            ))}
          </Sec>
        )}

        {spec.conceptual_model.objects.length > 0 && (
          <Sec title="Conceptual model">
            {spec.conceptual_model.objects.map((o, i) => (
              <p key={i} className="mt-1 text-[13px]" style={{ color: C.inkSoft }}>
                <b style={{ color: C.ink }}>{o.name}</b> — {o.description}
              </p>
            ))}
            {spec.conceptual_model.relationships.length > 0 && (
              <Bul label="Relationships" items={spec.conceptual_model.relationships} />
            )}
          </Sec>
        )}

        {spec.data_model.length > 0 && (
          <Sec title="Data model">
            {spec.data_model.map((d, i) => (
              <p key={i} className="mt-1.5 text-[13px]" style={{ color: C.inkSoft }}>
                <b style={{ color: C.ink }}>{d.entity}</b>
                {d.fields.length > 0 && <> — {d.fields.join(", ")}</>}
                {d.used_by.length > 0 && (
                  <span style={{ color: C.inkMuted }}> · used by {d.used_by.join(", ")}</span>
                )}
              </p>
            ))}
          </Sec>
        )}

        {(spec.data_flow.cross_feature.length > 0 ||
          spec.data_flow.per_feature.length > 0) && (
          <Sec title="Data flow">
            {spec.data_flow.cross_feature.length > 0 && (
              <div className="mb-2">
                <Label>Cross-feature</Label>
                {spec.data_flow.cross_feature.map((f, i) => (
                  <p key={i} className="text-[12.5px]" style={{ color: C.inkSoft }}>
                    {f.from} → {f.to}
                    {f.data && <span style={{ color: C.inkMuted }}> {`{${f.data}}`}</span>}
                    <span style={{ color: C.inkFaint }}> ({f.direction})</span>
                  </p>
                ))}
              </div>
            )}
            {spec.data_flow.per_feature.map((pf, i) => (
              <p key={i} className="mt-1 text-[12.5px]" style={{ color: C.inkSoft }}>
                <b style={{ color: C.ink }}>{pf.feature}:</b>{" "}
                {pf.steps
                  .map(
                    (s) =>
                      `${s.step}${s.component && s.component !== "—" ? ` [${s.component}]` : ""}`,
                  )
                  .join("  →  ")}
              </p>
            ))}
          </Sec>
        )}

        {spec.features.length > 0 && (
          <Sec title="Features">
            {spec.features.map((f, i) => (
              <div key={i} className="mt-4">
                <p className="text-[14px] font-semibold">
                  {i + 1}. {f.name}
                  {f.layer && (
                    <span style={{ color: C.inkMuted }}> — {f.layer}</span>
                  )}
                </p>
                {f.purpose && (
                  <p className="text-[13px]" style={{ color: C.inkSoft }}>
                    {f.purpose}
                  </p>
                )}
                {f.mechanism && (
                  <p className="mt-1 text-[12.5px]" style={{ color: C.inkSoft }}>
                    <b>Mechanism:</b> {f.mechanism}
                  </p>
                )}
                {f.components.length > 0 && (
                  <p className="text-[12.5px]" style={{ color: C.inkSoft }}>
                    <b>Components:</b> {f.components.join(", ")}
                  </p>
                )}
                {f.acceptance_criteria.length > 0 && (
                  <Bul label="Acceptance criteria" items={f.acceptance_criteria} tight />
                )}
                {f.scope_boundaries.length > 0 && (
                  <Bul label="Scope (not doing)" items={f.scope_boundaries} tight />
                )}
              </div>
            ))}
          </Sec>
        )}

        {(spec.design.user_flows.length > 0 ||
          spec.design.component_inventory.length > 0 ||
          spec.design.design_notes) && (
          <Sec title="Design (UI/UX)">
            {spec.design.user_flows.length > 0 && (
              <Bul label="User flows" items={spec.design.user_flows} />
            )}
            {spec.design.component_inventory.length > 0 && (
              <p className="text-[12.5px]" style={{ color: C.inkSoft }}>
                <b>Components:</b> {spec.design.component_inventory.join(", ")}
              </p>
            )}
            {spec.design.design_notes && (
              <p className="mt-1 text-[13px]" style={{ color: C.inkSoft }}>
                {spec.design.design_notes}
              </p>
            )}
          </Sec>
        )}

        {spec.decisions.length > 0 && (
          <Sec title="Decisions">
            {spec.decisions.map((d, i) => (
              <div key={i} className="mt-2">
                <p className="text-[13px] font-semibold">{d.choice}</p>
                {d.context && (
                  <p className="text-[12.5px]" style={{ color: C.inkSoft }}>
                    {d.context}
                  </p>
                )}
                {d.alternatives_rejected.length > 0 && (
                  <p className="text-[12px]" style={{ color: C.inkMuted }}>
                    Rejected: {d.alternatives_rejected.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </Sec>
        )}

        {spec.build_sequence.length > 0 && (
          <Sec title="Build sequence">
            {spec.build_sequence.map((b, i) => (
              <div key={i} className="mt-2">
                <p className="text-[13px] font-semibold">
                  {i + 1}. {b.phase}
                </p>
                {b.rationale && (
                  <p className="text-[12.5px]" style={{ color: C.inkSoft }}>
                    {b.rationale}
                  </p>
                )}
                {b.builds.length > 0 && (
                  <p className="text-[12.5px]" style={{ color: C.inkMuted }}>
                    {b.builds.join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </Sec>
        )}

        {spec.open_questions.length > 0 && (
          <Sec title="Open questions">
            <Bul items={spec.open_questions} />
          </Sec>
        )}
      </article>
    </div>
  );
}

// ── tiny presentational helpers ───────────────────────────────────

function Btn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
      style={{ color: C.inkSoft, border: `1px solid ${C.rule}` }}
    >
      {children}
    </button>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="mt-10"
      style={{ borderTop: `1px solid ${C.rule}`, paddingTop: "1.75rem" }}
    >
      <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10.5px] font-semibold uppercase tracking-[0.12em]"
      style={{ color: C.inkFaint }}
    >
      {children}
    </p>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <p className="text-[13px]" style={{ color: C.inkSoft }}>
      <b style={{ color: C.ink }}>{k}:</b> {v}
    </p>
  );
}

function Bul({
  label,
  items,
  tight,
}: {
  label?: string;
  items: string[];
  tight?: boolean;
}) {
  return (
    <div className={tight ? "mt-1" : "mt-2"}>
      {label && <Label>{label}</Label>}
      <ul className="list-disc pl-5">
        {items.map((it, i) => (
          <li key={i} className="text-[13px] leading-snug" style={{ color: C.inkSoft }}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
