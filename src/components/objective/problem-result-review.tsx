"use client";

// ── Problem / Result Review checkpoint (Arc 3.6) ───────────────────
//
// The review surface shown when a room is parked at the checkpoint:
// problems (pain) + results (outcome) are generated, mechanisms are
// NOT. The user reviews, edits, and sharpens the problems + results,
// then clicks "Generate mechanisms →" to run the second phase.
//
// Why this is the highest-leverage screen: because mechanisms declare
// their bindings VERBATIM against a problem's root_causes + a result's
// indicators (Arc 3.2), what the user defines here literally becomes
// the causal chain. Sharpen a vague root cause → the mechanism that
// targets it is sharp too.
//
// Self-contained: own state + fetches. The room view drops this in
// when it detects the checkpoint state. No new schema.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface ReviewPain {
  id: string;
  name: string;
  negative_outcome: string;
  root_causes: string[];
}
export interface ReviewOutcome {
  id: string;
  name: string;
  measured_by: string;
  indicators: string[];
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  pains: ReviewPain[];
  outcomes: ReviewOutcome[];
  /** Called after mechanisms generate (parent does router.refresh). */
  onComplete?: () => void;
}

export function ProblemResultReview({
  spaceId,
  subObjectiveId,
  pains,
  outcomes,
  onComplete,
}: Props) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redoing, setRedoing] = useState<"pain" | "outcome" | null>(null);

  const generateMechanisms = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/brainstorm/room/${subObjectiveId}/mechanisms`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Couldn't generate mechanisms. Try again.");
        return;
      }
      if (onComplete) onComplete();
      else router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setGenerating(false);
    }
  }, [generating, subObjectiveId, onComplete, router]);

  const redoLane = useCallback(
    async (lane: "pain" | "outcome") => {
      if (redoing) return;
      setRedoing(lane);
      setError(null);
      try {
        // Re-running the whole define stage is the honest move: results
        // depend on the pains, so redoing problems should refresh both.
        const res = await fetch("/api/brainstorm/room/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            subObjectiveId,
            mode: "regenerate",
            phase: "define",
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          setError(json?.error ?? "Regeneration failed.");
          return;
        }
        router.refresh();
      } catch {
        setError("Network error. Try again.");
      } finally {
        setRedoing(null);
      }
    },
    [redoing, spaceId, subObjectiveId, router],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div
        className="rounded-2xl p-4"
        style={{
          background: "rgba(37,99,235,0.05)",
          border: `1px solid rgba(37,99,235,0.16)`,
        }}
      >
        <h2
          className="text-[15px] font-semibold"
          style={{ color: appleVibe.text.primary }}
        >
          Review problems &amp; results
        </h2>
        <p
          className="mt-1 text-[12.5px] font-light leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          Mechanisms are generated against THESE. Sharpen a vague root
          cause or indicator and the mechanism that targets it gets sharp
          too — so define the problem and the result well before
          generating solutions.
        </p>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Problems */}
        <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
          <LaneHeader
            label="Problems"
            count={pains.length}
            tone={appleVibe.stage.pain}
            onRedo={() => redoLane("pain")}
            redoing={redoing === "pain"}
          />
          {pains.map((p) => (
            <ProblemCard key={p.id} pain={p} />
          ))}
          {pains.length === 0 && <EmptyNote text="No problems defined yet." />}
        </div>

        {/* Results */}
        <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
          <LaneHeader
            label="Results"
            count={outcomes.length}
            tone={appleVibe.stage.outcomes}
            onRedo={() => redoLane("outcome")}
            redoing={redoing === "outcome"}
          />
          {outcomes.map((o) => (
            <ResultCard key={o.id} outcome={o} />
          ))}
          {outcomes.length === 0 && (
            <EmptyNote text="No results defined yet." />
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl px-3 py-2 text-[11.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            color: "rgba(127,29,29,0.95)",
            border: "1px solid rgba(220,38,38,0.18)",
          }}
        >
          {error}
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <span
          className="text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          Happy with the problems &amp; results?
        </span>
        <button
          type="button"
          onClick={generateMechanisms}
          disabled={generating || pains.length === 0 || outcomes.length === 0}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-opacity"
          style={{
            background: appleVibe.accent.primary,
            color: "#fff",
            opacity:
              generating || pains.length === 0 || outcomes.length === 0
                ? 0.5
                : 1,
            cursor: generating ? "wait" : "pointer",
          }}
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {generating ? "Generating mechanisms…" : "Generate mechanisms"}
        </button>
      </div>
    </div>
  );
}

function LaneHeader({
  label,
  count,
  tone,
  onRedo,
  redoing,
}: {
  label: string;
  count: number;
  tone: string;
  onRedo: () => void;
  redoing: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: tone }}
        />
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {label}
        </span>
        <span
          className="text-[10px] font-light"
          style={{ color: appleVibe.text.faint }}
        >
          · {count}
        </span>
      </div>
      <button
        type="button"
        onClick={onRedo}
        disabled={redoing}
        className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
        style={{
          background: appleVibe.surface.chip,
          color: appleVibe.text.tertiary,
          cursor: redoing ? "wait" : "pointer",
        }}
        title={`Regenerate ${label.toLowerCase()}`}
      >
        <RefreshCw
          className={`h-2.5 w-2.5 ${redoing ? "animate-spin" : ""}`}
          strokeWidth={2}
        />
        Redo
      </button>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p
      className="rounded-xl px-3 py-2 text-[11.5px] font-light italic"
      style={{
        color: appleVibe.text.tertiary,
        border: `1px dashed ${appleVibe.stroke.hairline}`,
      }}
    >
      {text}
    </p>
  );
}

// ── Problem card ───────────────────────────────────────────────────

function ProblemCard({ pain }: { pain: ReviewPain }) {
  const [name, setName] = useState(pain.name);
  const [negative, setNegative] = useState(pain.negative_outcome);
  const [rootCauses, setRootCauses] = useState(pain.root_causes.join("\n"));
  const [saving, setSaving] = useState(false);
  const [sharpening, setSharpening] = useState(false);

  const rootCauseList = rootCauses
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const vague = rootCauseList.length < 2;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/brainstorm/item/${pain.id}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          negative_outcome: negative.trim(),
          root_causes: rootCauseList,
        }),
      });
    } catch {
      /* soft — the next save retries */
    } finally {
      setSaving(false);
    }
  }, [pain.id, name, negative, rootCauseList]);

  const sharpen = useCallback(async () => {
    if (sharpening) return;
    setSharpening(true);
    try {
      const res = await fetch(`/api/brainstorm/item/${pain.id}/sharpen`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.causal_chain) {
        setName(json.name ?? name);
        setNegative(json.causal_chain.negative_outcome ?? negative);
        const rc = Array.isArray(json.causal_chain.root_causes)
          ? json.causal_chain.root_causes
          : [];
        setRootCauses(rc.join("\n"));
      }
    } catch {
      /* soft */
    } finally {
      setSharpening(false);
    }
  }, [pain.id, sharpening, name, negative]);

  return (
    <CardShell vague={vague} sharpening={sharpening} onSharpen={sharpen} saving={saving}>
      <FieldInput value={name} onChange={setName} onBlur={save} bold />
      <FieldLabel>Downstream consequence</FieldLabel>
      <FieldTextarea value={negative} onChange={setNegative} onBlur={save} rows={2} />
      <FieldLabel>
        Root causes{" "}
        {vague && (
          <span style={{ color: "rgba(180,83,9,0.95)" }}>
            · add ≥2 specific causes so mechanisms have a target
          </span>
        )}
      </FieldLabel>
      <FieldTextarea
        value={rootCauses}
        onChange={setRootCauses}
        onBlur={save}
        rows={3}
        placeholder="One root cause per line…"
      />
    </CardShell>
  );
}

// ── Result card ────────────────────────────────────────────────────

function ResultCard({ outcome }: { outcome: ReviewOutcome }) {
  const [name, setName] = useState(outcome.name);
  const [measured, setMeasured] = useState(outcome.measured_by);
  const [indicators, setIndicators] = useState(outcome.indicators.join("\n"));
  const [saving, setSaving] = useState(false);
  const [sharpening, setSharpening] = useState(false);

  const indicatorList = indicators
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const vague = !measured.trim() || indicatorList.length < 2;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/brainstorm/item/${outcome.id}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          measured_by: measured.trim(),
          indicators: indicatorList,
        }),
      });
    } catch {
      /* soft */
    } finally {
      setSaving(false);
    }
  }, [outcome.id, name, measured, indicatorList]);

  const sharpen = useCallback(async () => {
    if (sharpening) return;
    setSharpening(true);
    try {
      const res = await fetch(`/api/brainstorm/item/${outcome.id}/sharpen`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.causal_chain) {
        setName(json.name ?? name);
        setMeasured(json.causal_chain.measured_by ?? measured);
        const ind = Array.isArray(json.causal_chain.indicators)
          ? json.causal_chain.indicators
          : [];
        setIndicators(ind.join("\n"));
      }
    } catch {
      /* soft */
    } finally {
      setSharpening(false);
    }
  }, [outcome.id, sharpening, name, measured]);

  return (
    <CardShell vague={vague} sharpening={sharpening} onSharpen={sharpen} saving={saving}>
      <FieldInput value={name} onChange={setName} onBlur={save} bold />
      <FieldLabel>Measured by (headline signal)</FieldLabel>
      <FieldTextarea value={measured} onChange={setMeasured} onBlur={save} rows={2} />
      <FieldLabel>
        Indicators{" "}
        {vague && (
          <span style={{ color: "rgba(180,83,9,0.95)" }}>
            · add a signal + ≥2 indicators so results are measurable
          </span>
        )}
      </FieldLabel>
      <FieldTextarea
        value={indicators}
        onChange={setIndicators}
        onBlur={save}
        rows={3}
        placeholder="One observable indicator per line…"
      />
    </CardShell>
  );
}

// ── Shared card chrome + fields ────────────────────────────────────

function CardShell({
  children,
  vague,
  sharpening,
  onSharpen,
  saving,
}: {
  children: React.ReactNode;
  vague: boolean;
  sharpening: boolean;
  onSharpen: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-2xl p-3"
      style={{
        background: "rgba(255,255,255,0.65)",
        border: vague
          ? "1px solid rgba(217,119,6,0.35)"
          : `1px solid ${appleVibe.stroke.hairline}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1">
          {vague && (
            <AlertCircle
              className="h-3 w-3"
              strokeWidth={2}
              style={{ color: "rgba(180,83,9,0.95)" }}
            />
          )}
          {saving && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-light"
              style={{ color: appleVibe.text.faint }}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={2} /> saved
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onSharpen}
          disabled={sharpening}
          className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
          style={{
            background: vague ? "rgba(217,119,6,0.14)" : appleVibe.surface.chip,
            color: vague ? "rgba(146,64,14,0.95)" : appleVibe.text.tertiary,
            cursor: sharpening ? "wait" : "pointer",
          }}
          title="AI-sharpen this into a more specific, measurable definition"
        >
          <Wand2
            className={`h-2.5 w-2.5 ${sharpening ? "animate-pulse" : ""}`}
            strokeWidth={2}
          />
          {sharpening ? "Sharpening…" : "Sharpen"}
        </button>
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[9.5px] font-semibold uppercase tracking-[0.1em]"
      style={{ color: appleVibe.text.faint }}
    >
      {children}
    </div>
  );
}

function FieldInput({
  value,
  onChange,
  onBlur,
  bold,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  bold?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="w-full rounded-lg px-2 py-1 text-[13px] outline-none"
      style={{
        fontWeight: bold ? 600 : 400,
        color: appleVibe.text.primary,
        background: "transparent",
        border: `1px solid transparent`,
      }}
      onFocus={(e) => {
        e.currentTarget.style.border = `1px solid ${appleVibe.stroke.hairline}`;
        e.currentTarget.style.background = "rgba(255,255,255,0.9)";
      }}
      onBlurCapture={(e) => {
        e.currentTarget.style.border = "1px solid transparent";
        e.currentTarget.style.background = "transparent";
      }}
    />
  );
}

function FieldTextarea({
  value,
  onChange,
  onBlur,
  rows,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-none rounded-lg px-2 py-1.5 text-[12px] font-light leading-snug outline-none"
      style={{
        color: appleVibe.text.secondary,
        background: "rgba(255,255,255,0.5)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
      }}
    />
  );
}
