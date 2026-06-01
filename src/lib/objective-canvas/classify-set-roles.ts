// ── Classify Set Roles ─────────────────────────────────────────────
//
// Auto-classify (LLM) the features under ONE sub-objective into:
//   • complementary — distinct features that COORDINATE and ship TOGETHER
//     to satisfy the sub-objective (each adds a different capability).
//   • variation     — an ALTERNATIVE way to do the same job as a sibling;
//     you'd pick ONE, not ship both. Alternatives of each other share a
//     `group` key so the UI can fold them into a "pick one" cluster
//     ("See more = variations within the same layer").
//
// This is the user's "complementary set vs. variation" axis, decided
// "auto via LLM". Pure-ish: one llmJSON call + a deterministic fallback
// (everything complementary — the safe default that hides nothing).
// Storage lives on entities.expanded_detail (the classify-sets route
// merges the result in); no migration.

import { llmJSON } from "@/lib/llm";

export type SetRole = "complementary" | "variation";

export interface FeatureInput {
  id: string;
  name: string;
  summary?: string | null;
}

export interface SetRoleResult {
  id: string;
  set_role: SetRole;
  /** Variation cluster key — features that are alternatives OF EACH OTHER
   *  share it. null for complementary features. */
  group: string | null;
}

/** Deterministic fallback — treat everything as complementary so nothing
 *  is hidden as a "variation" when the LLM is unavailable. */
function allComplementary(features: FeatureInput[]): SetRoleResult[] {
  return features.map((f) => ({ id: f.id, set_role: "complementary", group: null }));
}

const SYSTEM = `You classify the features proposed under ONE sub-objective into a complementary set vs. variations.

Definitions:
- "complementary": distinct features that COORDINATE and ship TOGETHER — each contributes a different capability toward the sub-objective.
- "variation": an ALTERNATIVE way to accomplish the SAME job as another feature — you would pick ONE of them, not ship both.

Rules:
- Features that are alternatives OF EACH OTHER must share the same "group" key (a short slug, e.g. "ranking" or "consent-ui"). Complementary features have "group": null.
- A group only makes sense with 2+ members. Lone features are complementary.
- Echo every feature id exactly once.

Return JSON only: { "items": [ { "id": string, "set_role": "complementary" | "variation", "group": string | null } ] }`;

export async function classifySetRoles(
  objective: string,
  subObjectiveTitle: string,
  features: FeatureInput[],
): Promise<SetRoleResult[]> {
  // 0–1 features can't have variations.
  if (features.length <= 1) return allComplementary(features);

  const list = features
    .map(
      (f, i) =>
        `${i + 1}. [${f.id}] ${f.name}${f.summary ? ` — ${f.summary}` : ""}`,
    )
    .join("\n");
  const user = `Objective: ${objective}\nSub-objective: ${subObjectiveTitle}\n\nFeatures:\n${list}\n\nClassify each feature. JSON only.`;

  return llmJSON<SetRoleResult[]>({
    system: SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: 1500,
    fallback: allComplementary(features),
    validator: (data) => {
      const items = (data as { items?: unknown })?.items;
      if (!Array.isArray(items)) throw new Error("set-roles: no items array");
      const known = new Set(features.map((f) => f.id));
      const seen = new Set<string>();
      const out: SetRoleResult[] = [];
      for (const raw of items) {
        const r = raw as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : "";
        if (!known.has(id) || seen.has(id)) continue;
        seen.add(id);
        const role: SetRole =
          r.set_role === "variation" ? "variation" : "complementary";
        const group =
          role === "variation" &&
          typeof r.group === "string" &&
          r.group.trim().length > 0
            ? r.group.trim()
            : null;
        out.push({ id, set_role: role, group });
      }
      // Cover any feature the model dropped (default complementary).
      for (const f of features) {
        if (!seen.has(f.id)) out.push({ id: f.id, set_role: "complementary", group: null });
      }
      // A "group" with only one member isn't a real alternative-set —
      // demote those lone variations back to complementary.
      const groupCounts = new Map<string, number>();
      for (const o of out) if (o.group) groupCounts.set(o.group, (groupCounts.get(o.group) ?? 0) + 1);
      return out.map((o) =>
        o.group && (groupCounts.get(o.group) ?? 0) < 2
          ? { ...o, set_role: "complementary", group: null }
          : o,
      );
    },
  });
}
