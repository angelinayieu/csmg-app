export interface IntersectionThresholds {
  embedding_similarity: number;
  name_similarity: number;
  role_similarity: number;
}

function parseThreshold(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function getIntersectionThresholds(): IntersectionThresholds {
  return {
    embedding_similarity: parseThreshold(process.env.PS_EMBEDDING_SIM_THRESHOLD, 0.78),
    name_similarity: parseThreshold(process.env.PS_NAME_SIM_THRESHOLD, 0.45),
    role_similarity: parseThreshold(process.env.PS_ROLE_SIM_THRESHOLD, 0.35),
  };
}
