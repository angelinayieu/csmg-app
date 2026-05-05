import type { TraceStep } from "@/types/causal-chains";
import type { ChainEvidenceBundles } from "@/types/evidence-bundles";

export type EvidenceViolationKind =
  | "missing_citation"      // research step with empty evidence_ids
  | "unknown_evidence_id";  // citation references an ID not in the bundle

export interface EvidenceViolation {
  step_num: number;
  step_name: string;
  kind: EvidenceViolationKind;
  message: string;
}

export function validateEvidenceCitations(
  steps: TraceStep[],
  bundles: ChainEvidenceBundles,
): EvidenceViolation[] {
  const validIds = new Set<string>();
  for (const b of bundles.bundles) {
    for (const c of b.citations) validIds.add(c.evidence_id);
  }

  const violations: EvidenceViolation[] = [];
  for (const step of steps) {
    if (step.source?.kind !== "research") continue;
    const ids = step.source.evidence_ids ?? [];
    if (ids.length === 0) {
      violations.push({
        step_num: step.num,
        step_name: step.name,
        kind: "missing_citation",
        message: `Step ${step.num} (${step.name}) is marked source.kind="research" but evidence_ids is empty. Either cite real evidence from the bundle or set kind to "llm_estimate".`,
      });
      continue;
    }
    for (const id of ids) {
      if (!validIds.has(id)) {
        violations.push({
          step_num: step.num,
          step_name: step.name,
          kind: "unknown_evidence_id",
          message: `Step ${step.num} cites evidence_id="${id}" which is not in the supplied bundle. Use only IDs from the bundle.`,
        });
      }
    }
  }
  return violations;
}

export function buildRetryPrompt(
  originalUserPrompt: string,
  violations: EvidenceViolation[],
): string {
  const violationBlock = violations
    .map((v) => `- Step ${v.step_num} (${v.step_name}): ${v.message}`)
    .join("\n");
  return `${originalUserPrompt}

═══ RETRY — EVIDENCE CITATION VIOLATIONS ═══
Your previous output had ${violations.length} citation violation${violations.length === 1 ? "" : "s"}:
${violationBlock}

Regenerate the trace. Every "research" step must cite at least one real evidence_id from the bundle, OR change its kind to "llm_estimate". Do not fabricate citations.`;
}
