"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ReasoningDepth = "quick" | "standard" | "deep";

// The pipeline stages the Strategy Lab ACTUALLY runs — every pill below
// maps to a stage that genuinely executes (verified end-to-end). The
// canonical multi-space pipeline also has Scope + Weave, but those only
// apply when analyzing MULTIPLE spaces together; a single-objective run
// has one space, so they're intentionally not shown here (showing them
// would over-promise). Critique + Augment are performed by one call to
// /api/pipeline/critique (it critiques AND persists the augmentations).
const ALL_STAGES: readonly string[] = [
  "decompose",
  "structure",
  "critique",
  "augment",
  "evidence",
  "synthesize",
  "strategy",
];
const STAGE_META: Record<string, { label: string; desc: string }> = {
  decompose: {
    label: "Decompose",
    desc: "Extract entities, relationships & mechanisms from your prompt + papers",
  },
  structure: {
    label: "Structure",
    desc: "Validate into a typed knowledge graph",
  },
  critique: {
    label: "Critique",
    desc: "Find orphans, gaps & weak edges (standard + deep)",
  },
  augment: {
    label: "Augment",
    desc: "Add missing edges & densify the graph (standard + deep)",
  },
  evidence: {
    label: "Evidence",
    desc: "Extract effect sizes from papers → ground edge strengths in measured effects (standard + deep)",
  },
  synthesize: {
    label: "Synthesize",
    desc: "Landscape coverage, leverage points & the strategy engine",
  },
  strategy: {
    label: "Strategy",
    desc: "Ranked strategy variants + twin proposal",
  },
};
// Which stages each depth tier runs. Quick is decompose-only refinement;
// standard & deep add critique + augment. Deep differs from standard by
// extraction DEPTH (25–50 entities vs 15–25), not by adding stages.
const TIER_STAGES: Record<ReasoningDepth, string[]> = {
  quick: ["decompose", "structure", "synthesize", "strategy"],
  standard: [
    "decompose",
    "structure",
    "critique",
    "augment",
    "evidence",
    "synthesize",
    "strategy",
  ],
  deep: [
    "decompose",
    "structure",
    "critique",
    "augment",
    "evidence",
    "synthesize",
    "strategy",
  ],
};

interface UploadedPaper {
  id: string;
  name: string;
  charCount: number;
  status: "uploading" | "parsing" | "ready" | "error";
  error?: string;
}

export function StrategyLabEntryForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [depth, setDepth] = useState<ReasoningDepth>("standard");
  const [papers, setPapers] = useState<UploadedPaper[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    setPapers((prev) => [
      ...prev,
      {
        id: tempId,
        name: file.name,
        charCount: 0,
        status: "uploading",
      },
    ]);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/ingest", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Upload failed (${res.status}): ${body.slice(0, 200)}`,
        );
      }

      const json = (await res.json()) as {
        ingested_file_id: string;
        source_name?: string;
        awaiting_parse?: boolean;
      };

      // Swap tempId for the real ID + update status
      setPapers((prev) =>
        prev.map((p) =>
          p.id === tempId
            ? {
                id: json.ingested_file_id,
                name: json.source_name ?? file.name,
                charCount: 0,
                status: json.awaiting_parse ? "parsing" : "ready",
              }
            : p,
        ),
      );

      // If background parse, poll until ready
      if (json.awaiting_parse) {
        const startedAt = Date.now();
        const POLL_MS = 1500;
        const TIMEOUT_MS = 180_000;
        const tick = async (): Promise<void> => {
          if (Date.now() - startedAt > TIMEOUT_MS) {
            setPapers((prev) =>
              prev.map((p) =>
                p.id === json.ingested_file_id
                  ? { ...p, status: "error", error: "parse timed out" }
                  : p,
              ),
            );
            return;
          }
          try {
            const pr = await fetch(
              `/api/ingest/${json.ingested_file_id}/parse-status`,
            );
            if (pr.ok) {
              const status = (await pr.json()) as {
                status?: string;
                normalized_chars?: number;
                error?: string;
              };
              if (status.status === "ready") {
                setPapers((prev) =>
                  prev.map((p) =>
                    p.id === json.ingested_file_id
                      ? {
                          ...p,
                          status: "ready",
                          charCount: status.normalized_chars ?? 0,
                        }
                      : p,
                  ),
                );
                return;
              }
              if (status.status === "error") {
                setPapers((prev) =>
                  prev.map((p) =>
                    p.id === json.ingested_file_id
                      ? {
                          ...p,
                          status: "error",
                          error: status.error ?? "parse failed",
                        }
                      : p,
                  ),
                );
                return;
              }
            }
          } catch {
            /* network blip — keep polling */
          }
          setTimeout(tick, POLL_MS);
        };
        setTimeout(tick, POLL_MS);
      }
    } catch (err) {
      setPapers((prev) =>
        prev.map((p) =>
          p.id === tempId
            ? {
                ...p,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
              }
            : p,
        ),
      );
    }
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      for (const f of files) {
        void uploadFile(f);
      }
    },
    [uploadFile],
  );

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removePaper = (id: string) => {
    setPapers((prev) => prev.filter((p) => p.id !== id));
  };

  const canSubmit =
    prompt.trim().length >= 4 &&
    !submitting &&
    papers.every((p) => p.status === "ready" || p.status === "error");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const readyIds = papers
        .filter((p) => p.status === "ready")
        .map((p) => p.id);

      const res = await fetch("/api/strategy-lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ingestedFileIds: readyIds,
          reasoningDepth: depth,
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body?.error ?? `Submit failed (${res.status})`);
      }

      const json = (await res.json()) as {
        spaceId: string;
        runId: string;
        redirectTo: string;
      };
      router.push(json.redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const readyCount = papers.filter((p) => p.status === "ready").length;
  const busyCount = papers.filter(
    (p) => p.status === "uploading" || p.status === "parsing",
  ).length;

  // Which pipeline stages light up for the selected depth.
  const activeStages = new Set<string>(TIER_STAGES[depth]);

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-20"
      style={{
        background:
          "radial-gradient(at 20% 0%, rgba(124,58,237,0.06), transparent 50%), radial-gradient(at 80% 100%, rgba(37,99,235,0.05), transparent 50%), #FAFBFC",
      }}
    >
      <div className="w-full max-w-3xl">
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-full text-[10.5px] font-semibold tracking-wide uppercase"
            style={{
              background: "rgba(124,58,237,0.08)",
              color: "rgba(124,58,237,0.85)",
              letterSpacing: "0.05em",
            }}
          >
            <span>Strategy Lab</span>
          </div>
          <h1
            className="text-3xl font-semibold tracking-tight"
            style={{ color: "#0F172A", letterSpacing: "-0.02em" }}
          >
            Generate a strategy from your research
          </h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "rgba(15,23,42,0.55)" }}
          >
            Drop research papers, describe your objective, and watch the
            full chain run — knowledge graph → synthesis → twin proposal.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-5"
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Prompt textarea */}
          <div>
            <label
              className="block text-[11px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "rgba(15,23,42,0.55)", letterSpacing: "0.04em" }}
            >
              Objective
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="e.g. Understanding the effect of exercise on neuroplasticity markers (IGF-I, VEGF, BDNF, hippocampal volume)."
              className="w-full px-4 py-3 rounded-xl text-[14px] leading-relaxed resize-none"
              style={{
                background: "white",
                border: "1px solid rgba(15,23,42,0.08)",
                color: "#0F172A",
                boxShadow:
                  "0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 2px rgba(11,18,40,0.04)",
                outline: "none",
              }}
            />
          </div>

          {/* Paper drop zone */}
          <div>
            <label
              className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "rgba(15,23,42,0.55)", letterSpacing: "0.04em" }}
            >
              <span>Research papers (optional)</span>
              <span style={{ color: "rgba(15,23,42,0.4)" }}>
                {readyCount} ready · {busyCount} processing
              </span>
            </label>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-6 rounded-xl text-[13px] transition-all"
              style={{
                background: dragActive
                  ? "rgba(124,58,237,0.06)"
                  : "rgba(255,255,255,0.6)",
                border: dragActive
                  ? "1.5px dashed rgba(124,58,237,0.55)"
                  : "1.5px dashed rgba(15,23,42,0.12)",
                color: dragActive
                  ? "rgba(124,58,237,0.9)"
                  : "rgba(15,23,42,0.55)",
              }}
            >
              {dragActive
                ? "Drop to upload"
                : "Click to upload or drag PDFs / DOCX / text files here"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {papers.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {papers.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-[12.5px]"
                    style={{
                      background: "rgba(15,23,42,0.025)",
                      border: "1px solid rgba(15,23,42,0.05)",
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          background:
                            p.status === "ready"
                              ? "#16A34A"
                              : p.status === "error"
                                ? "#DC2626"
                                : "#D97706",
                        }}
                      />
                      <span
                        className="truncate"
                        style={{ color: "#0F172A" }}
                      >
                        {p.name}
                      </span>
                      <span
                        className="flex-shrink-0"
                        style={{ color: "rgba(15,23,42,0.4)" }}
                      >
                        {p.status === "uploading" && "uploading…"}
                        {p.status === "parsing" && "parsing…"}
                        {p.status === "ready" &&
                          p.charCount > 0 &&
                          `${(p.charCount / 1000).toFixed(1)}k chars`}
                        {p.status === "error" && (p.error ?? "failed")}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePaper(p.id)}
                      className="text-[11px] px-1.5 py-0.5 rounded transition-colors"
                      style={{ color: "rgba(15,23,42,0.45)" }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Depth selector */}
          <div>
            <label
              className="block text-[11px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "rgba(15,23,42,0.55)", letterSpacing: "0.04em" }}
            >
              Reasoning depth
            </label>
            <div className="flex gap-2">
              {(["quick", "standard", "deep"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepth(d)}
                  className="flex-1 px-3 py-2 rounded-lg text-[12.5px] font-medium capitalize transition-all"
                  style={{
                    background:
                      depth === d ? "rgba(15,23,42,0.92)" : "white",
                    color:
                      depth === d ? "white" : "rgba(15,23,42,0.55)",
                    border:
                      depth === d
                        ? "1px solid rgba(15,23,42,0.92)"
                        : "1px solid rgba(15,23,42,0.08)",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Pipeline stage pills — light up by depth */}
          <div>
            <label
              className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "rgba(15,23,42,0.55)", letterSpacing: "0.04em" }}
            >
              <span>Pipeline stages</span>
              <span style={{ color: "rgba(15,23,42,0.4)" }}>
                {activeStages.size} of {ALL_STAGES.length} active
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-y-2">
              {ALL_STAGES.map((stage, i) => {
                const active = activeStages.has(stage);
                const meta = STAGE_META[stage] ?? {
                  label: stage,
                  desc: "",
                };
                const nextActive =
                  i < ALL_STAGES.length - 1 &&
                  active &&
                  activeStages.has(ALL_STAGES[i + 1]);
                return (
                  <div key={stage} className="flex items-center">
                    <span
                      title={meta.desc}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
                      style={{
                        background: active
                          ? "rgba(124,58,237,0.1)"
                          : "rgba(15,23,42,0.03)",
                        color: active
                          ? "rgba(124,58,237,0.95)"
                          : "rgba(15,23,42,0.32)",
                        border: active
                          ? "1px solid rgba(124,58,237,0.32)"
                          : "1px solid rgba(15,23,42,0.06)",
                        transition:
                          "background 0.3s ease, color 0.3s ease, border-color 0.3s ease",
                      }}
                    >
                      {meta.label}
                    </span>
                    {i < ALL_STAGES.length - 1 && (
                      <span
                        className="mx-1"
                        style={{
                          width: 10,
                          height: 1.5,
                          borderRadius: 1,
                          background: nextActive
                            ? "rgba(124,58,237,0.35)"
                            : "rgba(15,23,42,0.1)",
                          transition: "background 0.3s ease",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <p
              className="mt-2 text-[11px]"
              style={{ color: "rgba(15,23,42,0.45)" }}
            >
              {depth === "quick"
                ? "Fast single-pass graph — decompose only, lowest cost."
                : depth === "standard"
                  ? "Adds critique + augment + evidence grounding (effect sizes from your papers pooled into edge strengths)."
                  : "Same stages as standard, but deeper extraction (25–50 entities, denser edges) — richest & slowest, may retry."}
            </p>
          </div>

          {error && (
            <div
              className="px-4 py-3 rounded-lg text-[12.5px]"
              style={{
                background: "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.18)",
                color: "rgba(185,28,28,0.95)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full px-5 py-3.5 rounded-xl text-[14px] font-semibold transition-all"
            style={{
              background: canSubmit
                ? "linear-gradient(180deg, #1E293B 0%, #0F172A 100%)"
                : "rgba(15,23,42,0.25)",
              color: "white",
              cursor: canSubmit ? "pointer" : "not-allowed",
              boxShadow: canSubmit
                ? "0 1px 0 rgba(255,255,255,0.15) inset, 0 8px 20px -8px rgba(11,18,40,0.35)"
                : "none",
            }}
          >
            {submitting
              ? "Starting…"
              : busyCount > 0
                ? `Waiting for ${busyCount} paper${busyCount === 1 ? "" : "s"}…`
                : "Generate Strategy"}
          </button>
        </form>
      </div>
    </div>
  );
}
