import { llmGenerate } from "@/lib/llm";

export interface RigorIntakeInput {
  text: string;
  objective?: string;
  tier?: "deep" | "comprehensive";
}

export interface RigorClaim {
  claim_text: string;
  claim_type: "assertion" | "prediction" | "assumption" | "finding" | "mechanism";
  confidence: number;
}

export interface ExperimentProposal {
  title: string;
  method: string;
  required_tools: string[];
  predicted_effect: {
    metric: string;
    direction: "up" | "down" | "mixed";
    confidence: number;
  };
  rank_score: number;
}

export interface RigorIntakeOutput {
  rigor_score: number;
  landscape_coverage: {
    digital: number;
    logic: number;
    situational: number;
    baseline: number;
  };
  claims: RigorClaim[];
  proposals: ExperimentProposal[];
  summary: {
    top_gap: string;
    strongest_signal: string;
    recommended_next_action: string;
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function fallbackHeuristic(input: RigorIntakeInput): RigorIntakeOutput {
  const t = input.text.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);

  const hasDigital = /dataset|api|benchmark|paper|source|web|search|evidence|citation/.test(t);
  const hasLogic = /because|therefore|if|then|assume|mechanism|causal|model/.test(t);
  const hasSituational = /context|constraint|team|market|environment|user|situation/.test(t);
  const hasBaseline = /baseline|current|today|existing|as-is|starting point/.test(t);

  const coverage = {
    digital: hasDigital ? 0.75 : 0.35,
    logic: hasLogic ? 0.75 : 0.35,
    situational: hasSituational ? 0.75 : 0.35,
    baseline: hasBaseline ? 0.75 : 0.3,
  };

  const avgCoverage = (coverage.digital + coverage.logic + coverage.situational + coverage.baseline) / 4;
  const complexity = clamp01(Math.min(words.length / 500, 1));
  const rigor = clamp01(avgCoverage * 0.75 + complexity * 0.25);

  const claims: RigorClaim[] = [
    {
      claim_text: "The current objective can be improved through a staged experiment sequence.",
      claim_type: "prediction",
      confidence: clamp01(0.55 + avgCoverage * 0.25),
    },
    {
      claim_text: "Evidence quality is currently uneven across key decision areas.",
      claim_type: "finding",
      confidence: clamp01(0.5 + (1 - avgCoverage) * 0.25),
    },
  ];

  const proposals: ExperimentProposal[] = [
    {
      title: "Fast falsification probe",
      method: "Run a minimal intervention against the highest-impact mechanism and compare against baseline.",
      required_tools: ["time-series tracker", "evidence capture", "deviation logger"],
      predicted_effect: { metric: "primary outcome", direction: "up", confidence: clamp01(0.45 + avgCoverage * 0.2) },
      rank_score: clamp01(0.6 + avgCoverage * 0.2),
    },
    {
      title: "Competing-hypothesis test",
      method: "Test at least two rival mechanisms under similar conditions and rank by effect size.",
      required_tools: ["A/B harness", "causal trace", "error-band scoring"],
      predicted_effect: { metric: "mechanism confidence", direction: "mixed", confidence: clamp01(0.4 + avgCoverage * 0.2) },
      rank_score: clamp01(0.5 + avgCoverage * 0.2),
    },
  ];

  return {
    rigor_score: rigor,
    landscape_coverage: coverage,
    claims,
    proposals,
    summary: {
      top_gap: coverage.baseline < 0.5 ? "baseline" : "digital evidence depth",
      strongest_signal: coverage.logic > 0.7 ? "logic chain present" : "partial structure only",
      recommended_next_action: "Run focused rigor intake before synthesis and lock proposal ranking by evidence quality.",
    },
  };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1].trim()) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function runRigorIntake(input: RigorIntakeInput): Promise<RigorIntakeOutput> {
  const fallback = fallbackHeuristic(input);

  try {
    const system = [
      "You are a rigor-intake analyst.",
      "Return STRICT JSON only.",
      "Score coverage for digital, logic, situational, baseline in [0,1].",
      "Generate 3-8 claims and 2-5 ranked experiment proposals.",
      "Do not include markdown fences."
    ].join(" ");

    const user = [
      `Objective: ${input.objective ?? "(none provided)"}`,
      `Tier: ${input.tier ?? "comprehensive"}`,
      "Input:",
      input.text,
      "Output schema:",
      JSON.stringify({
        rigor_score: 0.0,
        landscape_coverage: { digital: 0, logic: 0, situational: 0, baseline: 0 },
        claims: [{ claim_text: "", claim_type: "assertion", confidence: 0.5 }],
        proposals: [{ title: "", method: "", required_tools: [""], predicted_effect: { metric: "", direction: "up", confidence: 0.5 }, rank_score: 0.5 }],
        summary: { top_gap: "", strongest_signal: "", recommended_next_action: "" }
      })
    ].join("\n\n");

    const raw = await llmGenerate({
      system,
      user,
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 3000,
    });

    const parsed = extractJsonObject(raw);
    if (!parsed) return fallback;

    const lc = (parsed.landscape_coverage ?? {}) as Record<string, unknown>;
    const claimsRaw = Array.isArray(parsed.claims) ? parsed.claims : [];
    const proposalsRaw = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    const summaryRaw = (parsed.summary ?? {}) as Record<string, unknown>;

    const claims: RigorClaim[] = claimsRaw.slice(0, 8).map((c) => {
      const rc = c as Record<string, unknown>;
      const t = String(rc.claim_type ?? "assertion");
      const claimType: RigorClaim["claim_type"] =
        t === "prediction" || t === "assumption" || t === "finding" || t === "mechanism"
          ? t
          : "assertion";
      return {
        claim_text: String(rc.claim_text ?? "").trim(),
        claim_type: claimType,
        confidence: clamp01(Number(rc.confidence ?? 0.5)),
      };
    }).filter((c) => c.claim_text.length > 0);

    const proposals: ExperimentProposal[] = proposalsRaw.slice(0, 5).map((p) => {
      const rp = p as Record<string, unknown>;
      const pe = (rp.predicted_effect ?? {}) as Record<string, unknown>;
      const dirRaw = String(pe.direction ?? "mixed");
      const direction: "up" | "down" | "mixed" =
        dirRaw === "up" || dirRaw === "down" ? dirRaw : "mixed";
      return {
        title: String(rp.title ?? "").trim(),
        method: String(rp.method ?? "").trim(),
        required_tools: Array.isArray(rp.required_tools)
          ? (rp.required_tools as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 8)
          : [],
        predicted_effect: {
          metric: String(pe.metric ?? "outcome"),
          direction,
          confidence: clamp01(Number(pe.confidence ?? 0.5)),
        },
        rank_score: clamp01(Number(rp.rank_score ?? 0.5)),
      };
    }).filter((p) => p.title.length > 0 && p.method.length > 0);

    return {
      rigor_score: clamp01(Number(parsed.rigor_score ?? fallback.rigor_score)),
      landscape_coverage: {
        digital: clamp01(Number(lc.digital ?? fallback.landscape_coverage.digital)),
        logic: clamp01(Number(lc.logic ?? fallback.landscape_coverage.logic)),
        situational: clamp01(Number(lc.situational ?? fallback.landscape_coverage.situational)),
        baseline: clamp01(Number(lc.baseline ?? fallback.landscape_coverage.baseline)),
      },
      claims: claims.length > 0 ? claims : fallback.claims,
      proposals: proposals.length > 0 ? proposals : fallback.proposals,
      summary: {
        top_gap: String(summaryRaw.top_gap ?? fallback.summary.top_gap),
        strongest_signal: String(summaryRaw.strongest_signal ?? fallback.summary.strongest_signal),
        recommended_next_action: String(summaryRaw.recommended_next_action ?? fallback.summary.recommended_next_action),
      },
    };
  } catch {
    return fallback;
  }
}
