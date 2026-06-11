// Trove — client-side types (mirrors of the kg_* rows + API payloads).

export interface TroveCollection {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  hue: number;
  is_agent: boolean;
  agent_persona: string | null;
  agent_enabled_at: string | null;
  created_at: string;
}

export interface TroveNode {
  id: string;
  collection_id: string | null;
  kind: string;
  title: string;
  summary: string | null;
  content?: string | null;
  media_url: string | null;
  source_kind: string;
  source_ref: string | null;
  depth: number;
  causal_role: string | null;
  tags: string[];
  hue: number;
  pinned: boolean;
  created_at: string;
}

export interface TroveEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  label: string | null;
  strength: number;
}

export interface AgentMessage {
  id: string;
  collection_id: string;
  role: "agent" | "user";
  body: string;
  kind: "chat" | "briefing";
  created_at: string;
}

export interface Ghost {
  title: string;
  summary: string;
  kind: string;
  angle: string;
  grounded: boolean;
  hue: number;
  tags: string[];
}

export interface ExploreResult {
  heading: string;
  ghosts: Ghost[];
  grounded: boolean;
}

export interface MapPlanBoard {
  mode: "clusters" | "flow" | "radial";
  title: string;
  groups: Array<{ label: string; hue: number; node_ids: string[] }>;
  sequence: string[];
  links: Array<{ source_id: string; target_id: string; label: string }>;
}

export interface MapPlanResponse {
  reply: string;
  board: MapPlanBoard;
  nodes: TroveNode[];
  error?: string;
}

export interface NodeDetailResponse {
  node: TroveNode & { content: string | null };
  edges: TroveEdge[];
  neighbors: TroveNode[];
  siblings: TroveNode[];
}

export const KIND_EMOJI: Record<string, string> = {
  concept: "🧩",
  idea: "💡",
  insight: "✨",
  question: "❓",
  note: "📝",
  link: "🔗",
  image: "🖼️",
  document: "📄",
};

export const ROLE_LABEL: Record<string, string> = {
  driver: "driver",
  mechanism: "mechanism",
  outcome: "outcome",
  condition: "condition",
  variable: "variable",
  context: "context",
};

/** Soft card gradient from a hue. */
export function hueGradient(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `linear-gradient(140deg, hsl(${h} 72% 93%) 0%, hsl(${(h + 42) % 360} 68% 86%) 100%)`;
}

export function hueInk(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `hsl(${h} 48% 26%)`;
}

export function hueChip(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `hsl(${h} 65% 88%)`;
}

export function relationPhrase(relation: string, label: string | null): string {
  if (label) return label;
  return relation.replace(/_/g, " ");
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
