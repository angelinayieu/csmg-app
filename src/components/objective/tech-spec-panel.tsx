"use client";

// ── Tech Spec Panel — floating spec document over the board ──────────
//
// Document-first read-out of a TechSpec (the SpecForge-native spec):
// overview → problem/users/goals → architecture → data model → features →
// build sequence → UI plan → risks/open questions. Modeled on
// agent-build-spec-panel.tsx (same chrome + typography tokens) so the app
// keeps one spec-document look. Copy markdown / Download .md / Close, plus
// a "Build prototype" CTA that hands off to the prototype stage.
//
// Layout: this is a floating glass card, NOT a full-screen overlay. It
// clears the BoardTopRightBar above and the bottom toolbar below so all
// board chrome reads as the same surface. When the Library rail opens it
// pushes the card aside (right edge slides in) — both panels coexist.
// Registers itself in board-panel-signal under "techSpec" so the connector
// "+" handle suppresses while a doc is up (no plus floating over text).

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, X, Wand2 } from "lucide-react";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";
import { setPanel, usePanel } from "@/lib/objective-canvas/board-panel-signal";

const C = {
  ink: "rgba(15,23,42,0.92)",
  inkSoft: "rgba(15,23,42,0.66)",
  inkMuted: "rgba(15,23,42,0.5)",
  inkFaint: "rgba(15,23,42,0.4)",
  rule: "rgba(15,23,42,0.08)",
  accent: "rgba(71,85,105,0.95)",
  accentSoft: "rgba(71,85,105,0.08)",
  accentBorder: "rgba(71,85,105,0.20)",
  paper: "#ffffff",
  bg: "#fafafa",
};
const FONT =
  'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

interface Props {
  spec: TechSpec;
  markdown: string;
  onClose: () => void;
  /** Fires the board-level prototype builder for this spec. */
  onBuildPrototype?: () => void;
  prototypeBusy?: boolean;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: C.accent,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 34 }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: C.inkSoft }}>
      {items.map((it, i) => (
        <li key={i} style={{ marginBottom: 5, lineHeight: 1.5, fontSize: 14.5 }}>
          {it}
        </li>
      ))}
    </ul>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 4 }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            padding: "4px 11px",
            borderRadius: 999,
            background: C.accentSoft,
            border: `1px solid ${C.accentBorder}`,
            color: C.accent,
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

export function TechSpecPanel({
  spec,
  markdown,
  onClose,
  onBuildPrototype,
  prototypeBusy,
}: Props) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }, [markdown]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${spec.title.replace(/[^\w]+/g, "-").toLowerCase() || "tech-spec"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* download is best-effort */
    }
  }, [markdown, spec.title]);

  const dl = spec.ui_plan.design_language;

  // Tell the rest of the board this panel is up — connector "+" handle hides
  // while it's open so a plus-button never floats over the document.
  const libraryOpen = usePanel("library");
  useEffect(() => {
    setPanel("techSpec", true);
    return () => setPanel("techSpec", false);
  }, []);

  // Float below the top-right bar (top:16, ~36px tall, +20px breathing room)
  // and above the bottom toolbar. When the Library rail (right:16, w:384) is
  // open, slide our right edge to clear it (16 + 384 + 12 gutter = 412).
  // Side margins clear the left BoardNavBar pill as well.
  const TOP_CLEAR = 72;
  const BOTTOM_CLEAR = 72;
  const SIDE_CLEAR = 84;
  const LIBRARY_PUSH = 412;

  return (
    <div
      className="overflow-y-auto"
      style={{
        position: "fixed",
        top: TOP_CLEAR,
        bottom: BOTTOM_CLEAR,
        left: SIDE_CLEAR,
        right: libraryOpen ? LIBRARY_PUSH : SIDE_CLEAR,
        zIndex: 40,
        background: C.bg,
        fontFamily: FONT,
        borderRadius: 18,
        border: `1px solid ${C.rule}`,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.6), 0 30px 70px -22px rgba(11,18,40,0.32)",
        transition:
          "right var(--dur-normal, 0.22s) var(--ease-spring-soft, cubic-bezier(0.32,0.72,0,1))",
      }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10"
        style={{
          background: "rgba(250,250,250,0.92)",
          borderBottom: `1px solid ${C.rule}`,
          backdropFilter: "blur(12px)",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
        }}
      >
        <div
          className="mx-auto flex items-center gap-2 px-6 py-3"
          style={{ maxWidth: 760 }}
        >
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: C.accent,
              letterSpacing: "0.02em",
            }}
          >
            Tech Spec
          </span>
          <div style={{ flex: 1 }} />
          {onBuildPrototype && (
            <button
              type="button"
              onClick={onBuildPrototype}
              disabled={prototypeBusy}
              className="flex items-center gap-1.5 rounded-full"
              style={{
                background: C.accent,
                color: "white",
                padding: "7px 14px",
                fontSize: 12.5,
                fontWeight: 650,
                cursor: prototypeBusy ? "wait" : "pointer",
                opacity: prototypeBusy ? 0.7 : 1,
              }}
            >
              <Wand2 className="h-3.5 w-3.5" strokeWidth={2.4} />
              {prototypeBusy ? "Building…" : "Build prototype"}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-full"
            style={{
              border: `1px solid ${C.rule}`,
              color: C.inkSoft,
              padding: "7px 12px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-full"
            style={{
              border: `1px solid ${C.rule}`,
              color: C.inkSoft,
              padding: "7px 12px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            .md
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-full"
            style={{ border: `1px solid ${C.rule}`, color: C.inkSoft, padding: 7 }}
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* Document */}
      <article
        className="mx-auto px-6 pb-24 pt-8"
        style={{ maxWidth: 760, color: C.ink }}
      >
        <h1 style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.02em" }}>
          {spec.title}
        </h1>
        {spec.overview && (
          <p
            style={{
              marginTop: 12,
              fontSize: 16.5,
              lineHeight: 1.55,
              color: C.inkSoft,
            }}
          >
            {spec.overview}
          </p>
        )}

        {spec.problem && (
          <Section title="Problem">
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: C.inkSoft }}>
              {spec.problem}
            </p>
          </Section>
        )}
        {spec.target_users.length > 0 && (
          <Section title="Target users">
            <Bullets items={spec.target_users} />
          </Section>
        )}
        {spec.goals.length > 0 && (
          <Section title="Goals">
            <Bullets items={spec.goals} />
          </Section>
        )}
        {spec.success_metrics.length > 0 && (
          <Section title="Success metrics">
            <Bullets items={spec.success_metrics} />
          </Section>
        )}
        {spec.non_goals.length > 0 && (
          <Section title="Non-goals">
            <Bullets items={spec.non_goals} />
          </Section>
        )}

        {(spec.architecture.summary ||
          spec.architecture.components.length > 0) && (
          <Section title="Architecture">
            {spec.architecture.summary && (
              <p
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  color: C.inkSoft,
                  marginBottom: 12,
                }}
              >
                {spec.architecture.summary}
              </p>
            )}
            {spec.architecture.layers.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Chips items={spec.architecture.layers} />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {spec.architecture.components.map((c, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${C.rule}`,
                    borderRadius: 12,
                    padding: "10px 13px",
                    background: C.paper,
                  }}
                >
                  <div style={{ fontSize: 14.5, fontWeight: 650 }}>
                    {c.name}
                    {c.tech && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: C.accent,
                        }}
                      >
                        {c.tech}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13.5, color: C.inkSoft, marginTop: 3 }}>
                    {c.responsibility}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {spec.data_model.length > 0 && (
          <Section title="Data model">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {spec.data_model.map((e, i) => (
                <div key={i}>
                  <span style={{ fontSize: 14.5, fontWeight: 650 }}>
                    {e.entity}
                  </span>
                  <span style={{ fontSize: 13.5, color: C.inkSoft }}>
                    {" — "}
                    {e.fields.join(", ")}
                  </span>
                  {e.notes && (
                    <div
                      style={{ fontSize: 12.5, color: C.inkMuted, marginTop: 2 }}
                    >
                      {e.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {spec.integrations.length > 0 && (
          <Section title="Integrations">
            <Chips items={spec.integrations} />
          </Section>
        )}

        {spec.features.length > 0 && (
          <Section title="Features">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {spec.features.map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: 15.5, fontWeight: 700 }}>{f.name}</div>
                  {f.description && (
                    <p
                      style={{
                        fontSize: 14,
                        lineHeight: 1.55,
                        color: C.inkSoft,
                        margin: "4px 0",
                      }}
                    >
                      {f.description}
                    </p>
                  )}
                  {f.components.length > 0 && <Chips items={f.components} />}
                  {f.acceptance_criteria.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Bullets items={f.acceptance_criteria} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {spec.build_phases.length > 0 && (
          <Section title="Build sequence">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {spec.build_phases.map((p, i) => (
                <div
                  key={i}
                  style={{
                    borderLeft: `2px solid ${C.accentBorder}`,
                    paddingLeft: 14,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.phase}</div>
                  {p.goal && (
                    <p style={{ fontSize: 14, color: C.inkSoft, margin: "3px 0" }}>
                      {p.goal}
                    </p>
                  )}
                  {p.depends_on.length > 0 && (
                    <div style={{ fontSize: 12.5, color: C.inkMuted }}>
                      Depends on: {p.depends_on.join(", ")}
                    </div>
                  )}
                  {p.deliverables.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Bullets items={p.deliverables} />
                    </div>
                  )}
                  {p.acceptance_criteria.length > 0 && (
                    <div
                      style={{ marginTop: 6, fontSize: 12.5, color: C.inkMuted }}
                    >
                      Acceptance: {p.acceptance_criteria.join("; ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="UI plan">
          <Chips
            items={[
              dl.hero_pattern,
              dl.glass_tier,
              dl.density,
              dl.motion_intent,
              dl.accent_intent,
            ]}
          />
          {spec.ui_plan.screens.length > 0 && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {spec.ui_plan.screens.map((s, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${C.rule}`,
                    borderRadius: 12,
                    padding: "10px 13px",
                    background: C.paper,
                  }}
                >
                  <div style={{ fontSize: 14.5, fontWeight: 650 }}>{s.name}</div>
                  <div style={{ fontSize: 13.5, color: C.inkSoft, marginTop: 2 }}>
                    {s.purpose}
                  </div>
                  {s.key_components.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Chips items={s.key_components} />
                    </div>
                  )}
                  {s.states.length > 0 && (
                    <div
                      style={{ fontSize: 12, color: C.inkMuted, marginTop: 6 }}
                    >
                      States: {s.states.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {spec.ui_plan.component_inventory.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 4 }}>
                Component inventory
              </div>
              <Chips items={spec.ui_plan.component_inventory} />
            </div>
          )}
          {spec.ui_plan.reduction_log.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 4 }}>
                Reduction log
              </div>
              <Bullets items={spec.ui_plan.reduction_log} />
            </div>
          )}
          {spec.ui_plan.inspiration_cues.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 4 }}>
                From your inspiration
              </div>
              <Bullets items={spec.ui_plan.inspiration_cues} />
            </div>
          )}
        </Section>

        {spec.risks.length > 0 && (
          <Section title="Risks">
            <Bullets items={spec.risks} />
          </Section>
        )}
        {spec.open_questions.length > 0 && (
          <Section title="Open questions">
            <Bullets items={spec.open_questions} />
          </Section>
        )}
      </article>
    </div>
  );
}
