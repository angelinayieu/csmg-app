"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, HelpCircle, CheckCircle2, FileText } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { TraceGraph } from "./trace-graphs";
import type { SynthesisData } from "@/types/synthesis";
import type {
  CausalChain,
  CalculationTrace,
  BaselineQuestion,
  TraceStep,
  EffectPropagatorResponse,
} from "@/types/causal-chains";
import { formatTimeAgo } from "@/lib/utils/format-time";

interface CalculationTraceViewProps {
  chainId: string;
}

function parseSynthData(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as SynthesisData;
  } catch {
    return null;
  }
}

const SOURCE_COLORS: Record<string, string> = {
  user: "#3b82f6",
  research: "#16a34a",
  model: "#8b5cf6",
  history: "#f59e0b",
};

const STEP_COLORS: Record<string, string> = {
  input: "#3b82f6",
  transform: "#a16207",
  result: "#dc2626",
};

export function CalculationTraceView({ chainId }: CalculationTraceViewProps) {
  const ctx = useSpaceData();
  const router = useRouter();

  const sd = useMemo(() => parseSynthData(ctx.space.synthesis_data), [ctx.space.synthesis_data]);
  const chain: CausalChain | undefined = useMemo(
    () => sd?.causal_chains?.find((c) => c.id === chainId),
    [sd, chainId],
  );
  const trace: CalculationTrace | undefined = useMemo(
    () => sd?.calculation_traces?.[chainId],
    [sd, chainId],
  );
  const savedQuestions: BaselineQuestion[] = useMemo(
    () => sd?.baseline_questions?.[chainId] ?? [],
    [sd, chainId],
  );

  const [questions, setQuestions] = useState<BaselineQuestion[]>(savedQuestions);
  const [needsBaseline, setNeedsBaseline] = useState(
    savedQuestions.some((q) => q.answer === undefined),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestions(savedQuestions);
    setNeedsBaseline(
      savedQuestions.length > 0 && savedQuestions.some((q) => q.answer === undefined),
    );
  }, [savedQuestions]);

  const runTrace = useCallback(
    async (answers?: BaselineQuestion[]) => {
      setRunning(true);
      setError(null);
      try {
        const res = await fetch("/api/causal-chains/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId: ctx.space.id,
            chainId,
            answers,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error ?? "Trace failed");
        }
        const data = (await res.json()) as EffectPropagatorResponse;
        if (data.status === "needs_baseline") {
          setQuestions(data.questions ?? []);
          setNeedsBaseline(true);
        } else {
          setNeedsBaseline(false);
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [ctx.space.id, chainId, router],
  );

  // Auto-run trace on first load if chain exists but trace doesn't
  useEffect(() => {
    if (chain && !trace && !running && !error && questions.length === 0) {
      runTrace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, trace]);

  if (!chain) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-500">
        Chain not found.{" "}
        <button
          onClick={() => router.push(`/app/space/${ctx.space.id}/causal-chains`)}
          className="ml-2 underline"
        >
          Back to chains
        </button>
      </div>
    );
  }

  if (needsBaseline && questions.length > 0 && !trace) {
    return (
      <BaselineQuestionFlow
        chain={chain}
        questions={questions}
        onSubmit={(answers) => {
          setQuestions(answers);
          runTrace(answers);
        }}
        onBack={() => router.push(`/app/space/${ctx.space.id}/causal-chains`)}
        submitting={running}
      />
    );
  }

  return (
    <div
      className="h-full overflow-y-auto p-6"
      style={{
        background: "#fafbfc",
        backgroundImage:
          "radial-gradient(circle, rgba(15,23,42,0.04) 0.6px, transparent 0.6px)",
        backgroundSize: "14px 14px",
      }}
    >
      <div className="max-w-[1180px] mx-auto">
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background: "#fff",
            border: "0.5px solid rgba(15,23,42,0.1)",
            boxShadow:
              "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px rgba(15,23,42,0.06)",
          }}
        >
          {/* Topbar */}
          <div
            className="px-5 py-2.5 border-b flex items-center gap-2.5 flex-wrap text-[11.5px]"
            style={{ background: "#fbfcfd", borderColor: "rgba(15,23,42,0.08)" }}
          >
            <button
              onClick={() => router.push(`/app/space/${ctx.space.id}/causal-chains`)}
              className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-md text-[11px] font-bold text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              style={{ border: "0.5px solid rgba(15,23,42,0.1)" }}
            >
              <ChevronLeft className="w-2.5 h-2.5" />
              Causal chains
            </button>
            <div className="flex items-center gap-1.5 text-gray-400 flex-wrap">
              <Chip>
                {String(chain.rank).padStart(2, "0")} — {chain.name}
              </Chip>
              <span className="text-gray-300">→</span>
              <Chip accent>
                {chain.stages[2].title.length > 20
                  ? chain.stages[2].title.slice(0, 18) + "…"
                  : chain.stages[2].title}
              </Chip>
              <span className="text-gray-300">→</span>
              <Chip>{chain.stages[5].title}</Chip>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2.5 text-[10.5px] text-gray-400">
              {trace ? (
                <span
                  className="inline-flex items-center gap-1.5 font-bold"
                  style={{ color: "#16a34a" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "#22c55e", animation: "pulse 2s ease-in-out infinite" }}
                  />
                  live
                </span>
              ) : running ? (
                <span className="text-gray-500">computing…</span>
              ) : (
                <span>no trace yet</span>
              )}
              {trace && <span>generated {formatTimeAgo(trace.generated_at)}</span>}
            </div>
          </div>

          {/* Hero */}
          <div
            className="px-6 py-5 border-b grid gap-6 items-center"
            style={{
              gridTemplateColumns: "1fr auto",
              background: "linear-gradient(180deg, rgba(220,38,38,0.025) 0%, #fff 100%)",
              borderColor: "rgba(15,23,42,0.06)",
            }}
          >
            <div>
              <div
                className="inline-flex items-center gap-1.5 mb-2 uppercase font-bold"
                style={{ color: "#dc2626", fontSize: 10, letterSpacing: "0.6px" }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "#dc2626", boxShadow: "0 0 0 3px rgba(220,38,38,0.18)" }}
                />
                How this number was computed
              </div>
              <div
                className="font-bold"
                style={{ fontSize: 18, letterSpacing: "-0.4px", lineHeight: 1.3 }}
              >
                Where does the{" "}
                <span style={{ color: "#dc2626" }} className="tabular-nums">
                  {trace?.final_display ?? "–"} {trace?.final_unit ?? ""}
                </span>{" "}
                contribution to &ldquo;{chain.stages[5].title}&rdquo; come from?
              </div>
              <div className="flex gap-2.5 mt-2.5 text-[11px] text-gray-500 flex-wrap items-center">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold"
                  style={{
                    background: "#eff6ff",
                    border: "0.5px solid rgba(59,130,246,0.25)",
                    color: "#1d4ed8",
                    fontSize: "10.5px",
                  }}
                >
                  <span
                    className="w-[5px] h-[5px] rounded-full"
                    style={{ background: "#3b82f6" }}
                  />
                  {trace?.agent_name ?? "ATLAS-04"}
                </span>
                <span className="text-gray-300">/</span>
                <span>{trace?.method_label ?? "Bayesian effect propagation v3.2"}</span>
                {trace && (
                  <>
                    <span className="text-gray-300">/</span>
                    <span className="tabular-nums">{trace.steps.length} steps traced</span>
                    <span className="text-gray-300">/</span>
                    <span className="tabular-nums">
                      {trace.alternatives_considered.length} alternatives rejected
                    </span>
                  </>
                )}
              </div>
            </div>
            <div
              className="p-3.5 rounded-[10px] text-right"
              style={{
                background: "#fff",
                border: "0.5px solid rgba(220,38,38,0.2)",
                minWidth: 170,
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}
            >
              <div
                className="font-bold uppercase mb-1"
                style={{ fontSize: 9.5, color: "#94a3b8", letterSpacing: "0.5px" }}
              >
                Final result
              </div>
              <div
                className="font-bold tabular-nums"
                style={{ fontSize: 28, color: "#dc2626", letterSpacing: "-1px", lineHeight: 1 }}
              >
                {trace?.final_display ?? "?"}
                <span style={{ fontSize: 13, color: "#94a3b8", marginLeft: 1 }}>
                  {trace?.final_unit ?? ""}
                </span>
              </div>
              {trace && (
                <div style={{ fontSize: "10.5px", color: "#64748b", marginTop: 5 }}>
                  CI{" "}
                  <span className="tabular-nums font-bold text-gray-900">
                    [{trace.ci_lower.toFixed(1)}, {trace.ci_upper.toFixed(1)}]
                  </span>{" "}
                  · conf{" "}
                  <span className="tabular-nums font-bold text-gray-900">
                    {Math.round(trace.confidence * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mx-6 my-4 px-4 py-2 rounded-lg text-[12px]"
              style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}
            >
              {error}{" "}
              <button onClick={() => runTrace()} className="underline ml-2 font-medium">
                Retry
              </button>
            </div>
          )}

          {/* Pipeline */}
          {trace && (
            <div className="px-6 py-5 border-b" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
              <SectionHeader num={1} title="Calculation pipeline" sub={`${trace.steps.length} traceable steps`} />
              <div
                className="flex flex-col rounded-[10px] overflow-hidden"
                style={{ border: "0.5px solid rgba(15,23,42,0.08)", background: "#fff" }}
              >
                {trace.steps.map((step, i) => (
                  <StepRow key={i} step={step} isLast={i === trace.steps.length - 1} />
                ))}
              </div>

              {/* Formula strip */}
              <div
                className="mt-3 px-3.5 py-2.5 rounded-[8px] flex items-center gap-3.5 flex-wrap"
                style={{
                  background: "#fbfcfd",
                  border: "0.5px dashed rgba(15,23,42,0.15)",
                }}
              >
                <div
                  className="font-bold uppercase"
                  style={{ fontSize: 9.5, color: "#94a3b8", letterSpacing: "0.5px" }}
                >
                  Compact
                </div>
                <div className="flex-1 tabular-nums" style={{ fontSize: 12, lineHeight: 1.7 }}>
                  {renderFormula(trace.formula_compact, trace.steps, trace.final_display ?? "")}
                </div>
              </div>
            </div>
          )}

          {/* Sensitivity */}
          {trace && (
            <div className="px-6 py-5 border-b" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
              <SectionHeader
                num={2}
                title="Confidence and sensitivity"
                sub="Posterior bounds · tornado analysis"
              />
              <div className="grid grid-cols-2 gap-3">
                <div
                  className="p-3.5 rounded-[10px]"
                  style={{ background: "#fbfcfd", border: "0.5px solid rgba(15,23,42,0.08)" }}
                >
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: 9.5, color: "#94a3b8", letterSpacing: "0.5px" }}
                  >
                    Posterior · 95% credible
                  </div>
                  <div
                    className="font-bold tabular-nums mt-1"
                    style={{ fontSize: 18, letterSpacing: "-0.4px" }}
                  >
                    {trace.final_display} ± {((trace.ci_upper - trace.ci_lower) / 2).toFixed(1)}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 4 }}>
                      {trace.final_unit}
                    </span>
                  </div>
                </div>
                <div
                  className="p-3.5 rounded-[10px]"
                  style={{ background: "#fbfcfd", border: "0.5px solid rgba(15,23,42,0.08)" }}
                >
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: 9.5, color: "#94a3b8", letterSpacing: "0.5px" }}
                  >
                    Sensitivity · what if
                  </div>
                  {trace.sensitivity.length === 0 && (
                    <div className="text-[11px] text-gray-400 mt-2">No perturbations computed.</div>
                  )}
                  {trace.sensitivity.map((s, i) => (
                    <div
                      key={i}
                      className="py-1.5"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 80px 50px",
                        gap: 10,
                        alignItems: "center",
                        fontSize: 11,
                        borderBottom:
                          i < trace.sensitivity.length - 1
                            ? "0.5px solid rgba(15,23,42,0.05)"
                            : undefined,
                      }}
                    >
                      <span className="text-gray-700 font-medium">{s.perturbation}</span>
                      <SensBar direction={s.direction} delta={s.delta_from_base} />
                      <span
                        className="tabular-nums font-bold text-right"
                        style={{
                          color: s.direction === "worse" ? "#dc2626" : s.direction === "better" ? "#16a34a" : "#64748b",
                          fontSize: 11.5,
                        }}
                      >
                        {s.result_display}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Agent narrative */}
          {trace && trace.narrative && (
            <div className="px-6 py-5 border-b" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
              <SectionHeader num={3} title="Agent reasoning" sub="Why these inputs · alternatives" />
              <div
                className="px-4 py-3 rounded-r-[8px]"
                style={{
                  background: "#fbfcfd",
                  borderLeft: "2px solid #3b82f6",
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold"
                    style={{
                      background: "#eff6ff",
                      border: "0.5px solid rgba(59,130,246,0.25)",
                      color: "#1d4ed8",
                      fontSize: "10.5px",
                    }}
                  >
                    <span
                      className="w-[5px] h-[5px] rounded-full"
                      style={{ background: "#3b82f6" }}
                    />
                    {trace.agent_name}
                  </span>
                  <span className="text-[10px] text-gray-400 font-semibold ml-auto">
                    {trace.alternatives_considered.length} alternatives considered
                  </span>
                </div>
                <div className="text-[11.5px] text-gray-800 leading-[1.6]">
                  {trace.narrative}
                </div>
                {trace.alternatives_considered.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-1.5">
                    {trace.alternatives_considered.map((alt, i) => (
                      <div key={i} className="text-[11px] text-gray-600">
                        <span className="font-semibold text-gray-800">✗ {alt.name}:</span>{" "}
                        {alt.rejected_reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div
            className="px-6 py-3 flex items-center justify-between flex-wrap gap-2.5"
            style={{ background: "#fbfcfd", borderTop: "0.5px solid rgba(15,23,42,0.08)" }}
          >
            <div className="text-[10.5px] text-gray-400 font-semibold flex items-center gap-2">
              <span>
                Baseline source:{" "}
                <span className="text-gray-700 font-bold">
                  {trace?.baseline_source ?? "—"}
                </span>
              </span>
              <span className="text-gray-300">/</span>
              <span>Recomputed on baseline change</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <ActionBtn onClick={() => runTrace()} kind="secondary" disabled={running}>
                <RefreshCw className={`w-2.5 h-2.5 ${running ? "animate-spin" : ""}`} />
                Recompute
              </ActionBtn>
              <ActionBtn
                kind="question"
                onClick={() => {
                  setQuestions([]);
                  setNeedsBaseline(false);
                  runTrace();
                }}
              >
                <HelpCircle className="w-2.5 h-2.5" />
                Re-ask baseline
              </ActionBtn>
              <ActionBtn kind="primary" onClick={() => router.push(`/app/space/${ctx.space.id}/strategy`)}>
                <CheckCircle2 className="w-2.5 h-2.5" />
                Back to strategy
              </ActionBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── BaselineQuestionFlow ──

function BaselineQuestionFlow({
  chain,
  questions,
  onSubmit,
  onBack,
  submitting,
}: {
  chain: CausalChain;
  questions: BaselineQuestion[];
  onSubmit: (answers: BaselineQuestion[]) => void;
  onBack: () => void;
  submitting: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, number | string | boolean>>(() => {
    const m: Record<string, number | string | boolean> = {};
    for (const q of questions) {
      if (q.answer !== undefined) m[q.id] = q.answer;
    }
    return m;
  });

  const allAnswered = questions.every(
    (q) => !q.required || (answers[q.id] !== undefined && answers[q.id] !== ""),
  );

  const handleSubmit = () => {
    onSubmit(
      questions.map((q) => ({
        ...q,
        answer: answers[q.id] ?? q.default_estimate,
        answered_at: new Date().toISOString(),
      })),
    );
  };

  const skipAll = () => {
    onSubmit(
      questions.map((q) => ({
        ...q,
        answer: q.default_estimate,
        answered_at: new Date().toISOString(),
      })),
    );
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "#fafbfc" }}>
      <div className="max-w-[680px] mx-auto">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold text-gray-600 hover:text-gray-900 mb-4"
        >
          <ChevronLeft className="w-3 h-3" />
          Back to chains
        </button>

        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background: "#fff",
            border: "0.5px solid rgba(15,23,42,0.1)",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px rgba(15,23,42,0.06)",
          }}
        >
          <div className="p-6 border-b" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
            <div
              className="inline-flex items-center gap-1.5 mb-2 uppercase font-bold"
              style={{ color: "var(--accent-600, #4F46E5)", fontSize: 10, letterSpacing: "0.6px" }}
            >
              <HelpCircle className="w-3 h-3" />
              A few baseline questions
            </div>
            <h2 className="font-bold text-gray-900" style={{ fontSize: 18, letterSpacing: "-0.4px" }}>
              Help ATLAS-04 ground the calculation for &ldquo;{chain.name}&rdquo;
            </h2>
            <p className="text-[12.5px] text-gray-600 mt-1.5">
              Every question has a best-guess default you can use. The more accurate your answers,
              the tighter your confidence interval.
            </p>
          </div>

          <div className="divide-y divide-gray-100">
            {questions.map((q, i) => (
              <div key={q.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-[11px] mt-0.5"
                    style={{
                      background: "var(--accent-50, #EEF2FF)",
                      color: "var(--accent-700, #3730A3)",
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-semibold text-gray-900 mb-1"
                      style={{ fontSize: 14, letterSpacing: "-0.2px" }}
                    >
                      {q.question}
                    </div>
                    <div className="text-[11.5px] text-gray-500 mb-3 italic">{q.why}</div>

                    {q.type === "numeric" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder={q.placeholder ?? String(q.default_estimate ?? "")}
                          min={q.min}
                          max={q.max}
                          value={(answers[q.id] as number | undefined) ?? ""}
                          onChange={(e) =>
                            setAnswers((a) => ({
                              ...a,
                              [q.id]: e.target.value === "" ? "" : Number(e.target.value),
                            }))
                          }
                          className="px-3 py-2 rounded-lg text-[13px] tabular-nums"
                          style={{
                            border: "1px solid #d1d5db",
                            width: 140,
                            outline: "none",
                          }}
                        />
                        {q.unit && <span className="text-[12px] text-gray-600">{q.unit}</span>}
                        <span className="text-[11px] text-gray-400 ml-2">
                          default: {q.default_estimate} {q.unit ?? ""}
                        </span>
                      </div>
                    )}

                    {q.type === "choice" && q.choices && (
                      <div className="flex flex-wrap gap-1.5">
                        {q.choices.map((choice) => {
                          const selected = answers[q.id] === choice;
                          return (
                            <button
                              key={choice}
                              onClick={() => setAnswers((a) => ({ ...a, [q.id]: choice }))}
                              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                              style={{
                                background: selected ? "var(--accent-600, #4F46E5)" : "#f3f4f6",
                                color: selected ? "#fff" : "#374151",
                                border: selected ? "1px solid var(--accent-700, #3730A3)" : "1px solid #e5e7eb",
                              }}
                            >
                              {choice}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {q.type === "yes_no" && (
                      <div className="flex gap-1.5">
                        {["Yes", "No"].map((v) => {
                          const boolVal = v === "Yes";
                          const selected = answers[q.id] === boolVal;
                          return (
                            <button
                              key={v}
                              onClick={() =>
                                setAnswers((a) => ({ ...a, [q.id]: boolVal }))
                              }
                              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold"
                              style={{
                                background: selected ? "var(--accent-600, #4F46E5)" : "#f3f4f6",
                                color: selected ? "#fff" : "#374151",
                              }}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {q.type === "short_text" && (
                      <input
                        type="text"
                        placeholder={q.placeholder ?? String(q.default_estimate ?? "")}
                        value={(answers[q.id] as string | undefined) ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        className="px-3 py-2 rounded-lg text-[13px] w-full"
                        style={{ border: "1px solid #d1d5db", outline: "none", maxWidth: 420 }}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            className="px-5 py-4 flex items-center justify-between gap-2.5 flex-wrap"
            style={{ background: "#fbfcfd", borderTop: "0.5px solid rgba(15,23,42,0.08)" }}
          >
            <button
              onClick={skipAll}
              className="text-[12px] font-semibold text-gray-600 hover:text-gray-900"
            >
              Skip all (use defaults)
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !allAnswered}
              className="px-5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--accent-600, #4F46E5)" }}
            >
              {submitting ? "Computing…" : `Compute trace (${Object.keys(answers).length}/${questions.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function SectionHeader({ num, title, sub }: { num: number; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <div
        className="w-[22px] h-[22px] rounded-md flex items-center justify-center font-bold"
        style={{
          background: "#eff6ff",
          color: "#3b82f6",
          fontSize: 11,
        }}
      >
        {num}
      </div>
      <div>
        <div
          className="font-bold text-gray-900"
          style={{ fontSize: 13, letterSpacing: "-0.2px" }}
        >
          {title}
        </div>
        <div className="font-semibold text-gray-400" style={{ fontSize: "10.5px" }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, isLast }: { step: TraceStep; isLast: boolean }) {
  const sourceColor = SOURCE_COLORS[step.source.kind] ?? "#64748b";
  const kindColor = STEP_COLORS[step.kind] ?? "#64748b";

  return (
    <div
      className="grid items-center py-3.5 px-4 relative"
      style={{
        gridTemplateColumns: "24px 1fr 96px 70px",
        gap: 14,
        background: "#fff",
        borderTop: isLast ? "0.5px solid rgba(15,23,42,0.06)" : "none",
      }}
    >
      <div
        className="w-[22px] h-[22px] rounded-full flex items-center justify-center font-bold text-[10px]"
        style={{
          background: step.kind === "result" ? "#fef2f2" : step.kind === "transform" ? "#fffbeb" : "#eff6ff",
          color: kindColor,
          border: `1.5px solid ${step.kind === "result" ? "rgba(220,38,38,0.4)" : step.kind === "transform" ? "rgba(245,158,11,0.4)" : "rgba(59,130,246,0.4)"}`,
        }}
      >
        {step.num}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="font-bold text-gray-900"
            style={{ fontSize: 12.5, letterSpacing: "-0.1px" }}
          >
            {step.name}
          </span>
          <span
            className="uppercase font-bold tracking-wider px-1.5 rounded-sm"
            style={{
              fontSize: 9,
              background:
                step.kind === "result" ? "#fee2e2" : step.kind === "transform" ? "#fef3c7" : "#dbeafe",
              color: kindColor,
              padding: "1.5px 6px",
              letterSpacing: "0.4px",
            }}
          >
            {step.kind}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.45, marginBottom: 6 }}>
          {step.description}
        </div>
        <a
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md"
          style={{
            fontSize: "10.5px",
            color: "#64748b",
            background: "#f8fafc",
            border: "0.5px solid rgba(15,23,42,0.08)",
            fontWeight: 600,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: sourceColor }}
          />
          {step.source.label}
          <span className="inline-flex items-center gap-[1.5px] ml-1" style={{ color: sourceColor }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <i
                key={n}
                className="inline-block"
                style={{
                  width: 3,
                  height: 6,
                  background: "currentColor",
                  borderRadius: 1,
                  opacity: n <= step.source.reliability ? 1 : 0.35,
                }}
              />
            ))}
          </span>
        </a>
      </div>
      <div className="flex items-center justify-center px-1">
        <div style={{ height: 32 }}>
          <TraceGraph graph={step.graph} color={sourceColor} />
          <div
            className="text-center uppercase font-bold"
            style={{ fontSize: 8.5, color: "#cbd5e1", letterSpacing: "0.4px", marginTop: 2 }}
          >
            {step.graph.primitive.replace("_", " ")}
          </div>
        </div>
      </div>
      <div
        className="tabular-nums text-right"
        style={{
          fontSize: step.is_factor ? 14 : step.kind === "result" ? 16 : 15,
          fontWeight: 700,
          letterSpacing: "-0.4px",
          color: step.is_factor ? "#a16207" : step.kind === "result" ? "#dc2626" : "#0f172a",
        }}
      >
        {step.value_display}
        {step.value_unit && (
          <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 1 }}>
            {step.value_unit}
          </span>
        )}
      </div>
    </div>
  );
}

function SensBar({ direction, delta }: { direction: string; delta: number }) {
  const width = Math.min(50, Math.abs(delta) * 8);
  return (
    <div
      className="relative h-2 rounded overflow-hidden"
      style={{ background: "#f1f5f9" }}
    >
      {direction === "worse" && (
        <div
          className="absolute top-0 h-full rounded"
          style={{ width: `${width}%`, right: "50%", background: "#dc2626" }}
        />
      )}
      {direction === "better" && (
        <div
          className="absolute top-0 h-full rounded"
          style={{ width: `${width}%`, left: "50%", background: "#16a34a" }}
        />
      )}
      <div
        className="absolute"
        style={{ left: "50%", top: -1, width: 1, height: 10, background: "#94a3b8" }}
      />
    </div>
  );
}

function Chip({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-semibold"
      style={{
        fontSize: "10.5px",
        background: accent ? "var(--accent-50, #EFF6FF)" : "#fff",
        border: `0.5px solid ${accent ? "var(--accent-100, rgba(59,130,246,0.25))" : "rgba(15,23,42,0.08)"}`,
        color: accent ? "var(--accent-700, #1d4ed8)" : "#475569",
      }}
    >
      {children}
    </span>
  );
}

function ActionBtn({
  kind,
  children,
  onClick,
  disabled,
}: {
  kind: "primary" | "secondary" | "question";
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-bold cursor-pointer transition-all";
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "#0f172a",
      border: "0.5px solid #0f172a",
      color: "#fff",
    },
    secondary: {
      background: "#fff",
      border: "0.5px solid rgba(15,23,42,0.12)",
      color: "#475569",
    },
    question: {
      background: "#fffbeb",
      border: "0.5px solid rgba(245,158,11,0.3)",
      color: "#a16207",
    },
  };
  return (
    <button onClick={onClick} disabled={disabled} className={base} style={styles[kind]}>
      {children}
    </button>
  );
}

function renderFormula(
  formula: string,
  steps: TraceStep[],
  resultDisplay: string,
): React.ReactNode {
  // Replace {{input:N}}, {{factor:N}}, {{result}} tokens
  const parts: React.ReactNode[] = [];
  const regex = /\{\{(input|factor|result)(?::(\d+))?\}\}/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(formula)) !== null) {
    if (m.index > lastIdx) {
      parts.push(formula.slice(lastIdx, m.index));
    }
    const kind = m[1];
    const num = m[2] ? Number(m[2]) : undefined;
    const step = num ? steps.find((s) => s.num === num) : undefined;
    const display =
      kind === "result"
        ? resultDisplay
        : step?.value_display ?? `{${kind}${num ? ":" + num : ""}}`;
    const bg =
      kind === "input" ? "#dbeafe" : kind === "factor" ? "#fef3c7" : "#fee2e2";
    const color =
      kind === "input" ? "#1d4ed8" : kind === "factor" ? "#a16207" : "#b91c1c";
    parts.push(
      <span
        key={key++}
        className="inline-block mx-0.5 rounded font-bold"
        style={{
          padding: "1.5px 6px",
          background: bg,
          color,
          fontSize: 11.5,
        }}
      >
        {display}
      </span>,
    );
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < formula.length) parts.push(formula.slice(lastIdx));
  return parts;
}

// formatTimeAgo is now imported from the shared util below.
