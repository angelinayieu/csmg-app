// ── Synergy client API wrapper ──
//
// Thin fetch wrappers around /api/synergy/* — single place to evolve
// the request/response shape. All functions throw on non-2xx so the
// caller's catch block sees a proper Error.

import type {
  AugmentMode,
  AugmentResponse,
  BrainstormComponent,
  BrainstormNode,
  BrainstormSession,
  BrainstormStroke,
  ClientNode,
  ClientStroke,
  DetectedObjective,
  PromiseScore,
  StrategyBundle,
  SynergyStrategy,
  SynergyStrategyBlock,
} from "./types";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // ignore — fall back to status text
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface SessionSummary {
  id: string;
  title: string;
  state: BrainstormSession["state"];
  objective_statement: string | null;
  created_at: string;
  updated_at: string;
  node_count: number;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/synergy/sessions", { method: "GET" });
  const json = await asJson<{ sessions: SessionSummary[] }>(res);
  return json.sessions;
}

export async function createSession(input: {
  title?: string;
  seedText?: string;
}): Promise<{ session: BrainstormSession; seedNode: BrainstormNode | null }> {
  const res = await fetch("/api/synergy/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res);
}

export async function loadSession(sessionId: string): Promise<{
  session: BrainstormSession;
  nodes: BrainstormNode[];
  strokes: BrainstormStroke[];
}> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}`, { method: "GET" });
  return asJson(res);
}

export async function updateSession(
  sessionId: string,
  updates: Partial<{
    title: string;
    objective_statement: string;
    objective_constraints: string[];
    objective_success_criteria: string[];
    state: BrainstormSession["state"];
  }>,
): Promise<BrainstormSession> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updates),
  });
  const json = await asJson<{ session: BrainstormSession }>(res);
  return json.session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}`, { method: "DELETE" });
  await asJson<{ ok: true }>(res);
}

// Map client-state shape (parent + optional meta) → DB row shape.
export function clientNodeToRow(n: ClientNode): {
  id: string;
  parent_id: string | null;
  kind: ClientNode["kind"];
  label: string;
  meta: string | null;
  x: number;
  y: number;
} {
  return {
    id: n.id,
    parent_id: n.parent ?? null,
    kind: n.kind,
    label: n.label,
    meta: n.meta ?? null,
    x: n.x,
    y: n.y,
  };
}

export function rowToClientNode(r: BrainstormNode): ClientNode {
  return {
    id: r.id,
    parent: r.parent_id,
    kind: r.kind,
    label: r.label,
    meta: r.meta ?? undefined,
    x: r.x,
    y: r.y,
  };
}

export async function saveNodes(
  sessionId: string,
  nodes: ClientNode[],
): Promise<void> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/nodes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nodes: nodes.map(clientNodeToRow) }),
  });
  await asJson<{ ok: true; count: number }>(res);
}

export async function saveStrokes(
  sessionId: string,
  strokes: ClientStroke[],
): Promise<void> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/strokes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ strokes }),
  });
  await asJson<{ ok: true; count: number }>(res);
}

export async function augment(input: {
  transcript: string;
  mode: AugmentMode;
  context?: string;
  precision?: number;
}): Promise<AugmentResponse> {
  const res = await fetch("/api/synergy/augment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res);
}

// ── Phase 3 — processing page wrappers ──

export async function detectObjective(
  sessionId: string,
): Promise<DetectedObjective> {
  const res = await fetch(
    `/api/synergy/sessions/${sessionId}/objective/detect`,
    { method: "POST" },
  );
  const json = await asJson<{ objective: DetectedObjective }>(res);
  return json.objective;
}

export async function extractComponents(
  sessionId: string,
): Promise<BrainstormComponent[]> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/extract`, {
    method: "POST",
  });
  const json = await asJson<{ components: BrainstormComponent[] }>(res);
  return json.components;
}

export async function listComponents(
  sessionId: string,
): Promise<BrainstormComponent[]> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/components`, {
    method: "GET",
  });
  const json = await asJson<{ components: BrainstormComponent[] }>(res);
  return json.components;
}

// Single-component regenerate: re-extracts label/description/private
// context for ONE component without touching its siblings, then
// re-embeds and re-runs the matcher for just this one. Returns the
// updated component row plus the fresh match count.
export async function regenerateComponent(
  componentId: string,
): Promise<{
  component: BrainstormComponent;
  match_count: number;
  candidates_considered: number;
}> {
  const res = await fetch(
    `/api/synergy/components/${componentId}/regenerate`,
    { method: "POST" },
  );
  return asJson(res);
}

// ── Component visibility / inline edit (Phase 4d+1) ──
//
// Owner-only PATCH on a brainstorm_components row. Common case:
// flipping visibility to opt out of matching. The server cascades a
// delete on component_matches when visibility goes to 'private' so
// the component disappears from other users' discover feeds.

export async function updateComponent(
  componentId: string,
  patch: Partial<{
    visibility: BrainstormComponent["visibility"];
    label_public: string;
    description_public: string;
    description_private: string;
  }>,
): Promise<BrainstormComponent> {
  const res = await fetch(`/api/synergy/components/${componentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await asJson<{ component: BrainstormComponent }>(res);
  return json.component;
}

export async function deleteComponent(componentId: string): Promise<void> {
  const res = await fetch(`/api/synergy/components/${componentId}`, {
    method: "DELETE",
  });
  await asJson<{ ok: true }>(res);
}

export async function scorePromise(
  sessionId: string,
): Promise<PromiseScore[]> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/score`, {
    method: "POST",
  });
  const json = await asJson<{ scores: PromiseScore[] }>(res);
  return json.scores;
}

// ── Phase 3.5d — Strategy Doc wrappers ──

export async function loadStrategy(sessionId: string): Promise<StrategyBundle> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/strategy`, {
    method: "GET",
  });
  return asJson<StrategyBundle>(res);
}

export async function generateStrategy(
  sessionId: string,
): Promise<StrategyBundle> {
  const res = await fetch(
    `/api/synergy/sessions/${sessionId}/strategy/generate`,
    { method: "POST" },
  );
  return asJson<StrategyBundle>(res);
}

// ── Phase 3.5e — Block-level AI ops + inline edits ──

export async function updateStrategyBlock(
  blockId: string,
  patch: { body?: string; meta_patch?: Record<string, unknown> },
): Promise<SynergyStrategyBlock> {
  const res = await fetch(`/api/synergy/strategy-blocks/${blockId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await asJson<{ block: SynergyStrategyBlock }>(res);
  return json.block;
}

export async function expandStrategyBlock(
  blockId: string,
): Promise<SynergyStrategyBlock> {
  const res = await fetch(`/api/synergy/strategy-blocks/${blockId}/expand`, {
    method: "POST",
  });
  const json = await asJson<{ block: SynergyStrategyBlock }>(res);
  return json.block;
}

export async function challengeStrategyBlock(
  blockId: string,
): Promise<SynergyStrategyBlock> {
  const res = await fetch(`/api/synergy/strategy-blocks/${blockId}/challenge`, {
    method: "POST",
  });
  const json = await asJson<{ block: SynergyStrategyBlock }>(res);
  return json.block;
}

export async function findEvidenceForBlock(
  blockId: string,
): Promise<SynergyStrategyBlock[]> {
  const res = await fetch(
    `/api/synergy/strategy-blocks/${blockId}/find-evidence`,
    { method: "POST" },
  );
  const json = await asJson<{ evidence_blocks: SynergyStrategyBlock[] }>(res);
  return json.evidence_blocks;
}

export async function mitigateStrategyBlock(
  blockId: string,
): Promise<SynergyStrategyBlock> {
  const res = await fetch(`/api/synergy/strategy-blocks/${blockId}/mitigate`, {
    method: "POST",
  });
  const json = await asJson<{ block: SynergyStrategyBlock }>(res);
  return json.block;
}

export async function designTestForBlock(
  blockId: string,
): Promise<SynergyStrategyBlock> {
  const res = await fetch(
    `/api/synergy/strategy-blocks/${blockId}/design-test`,
    { method: "POST" },
  );
  const json = await asJson<{ block: SynergyStrategyBlock }>(res);
  return json.block;
}

export async function updateStrategy(
  strategyId: string,
  patch: { statement?: string; pitch?: string },
): Promise<SynergyStrategy> {
  const res = await fetch(`/api/synergy/strategies/${strategyId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await asJson<{ strategy: SynergyStrategy }>(res);
  return json.strategy;
}

// ── Public components feed (Tier-2 2.2) ──

export type PublicComponentKind =
  | "core_idea"
  | "upstream"
  | "downstream"
  | "polished_product";

export interface PublicComponentItem {
  id: string;
  kind: PublicComponentKind;
  subkind: string | null;
  label_public: string;
  description_public: string;
  created_at: string;
  owner: {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface PublicComponentsPage {
  items: PublicComponentItem[];
  next_cursor: string | null;
}

export async function listPublicComponents(opts?: {
  cursor?: string;
  limit?: number;
  kind?: PublicComponentKind;
  q?: string;
}): Promise<PublicComponentsPage> {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await fetch(
    `/api/synergy/marketplace/feed${qs ? "?" + qs : ""}`,
  );
  return asJson<PublicComponentsPage>(res);
}

// ── Share tokens (Tier-2 2.4) ──

export interface StrategyShareToken {
  id: string;
  token: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
}

export async function listStrategyShares(
  strategyId: string,
): Promise<StrategyShareToken[]> {
  const res = await fetch(`/api/synergy/strategies/${strategyId}/share`);
  const json = await asJson<{ shares: StrategyShareToken[] }>(res);
  return json.shares;
}

export async function createStrategyShare(
  strategyId: string,
  opts?: { label?: string; expires_at?: string },
): Promise<StrategyShareToken> {
  const res = await fetch(`/api/synergy/strategies/${strategyId}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  const json = await asJson<{ share: StrategyShareToken }>(res);
  return json.share;
}

export async function revokeStrategyShare(
  strategyId: string,
  tokenId: string,
): Promise<StrategyShareToken> {
  const res = await fetch(
    `/api/synergy/strategies/${strategyId}/share?token_id=${encodeURIComponent(tokenId)}`,
    { method: "DELETE" },
  );
  const json = await asJson<{ share: StrategyShareToken }>(res);
  return json.share;
}
