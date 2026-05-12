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

export async function scorePromise(
  sessionId: string,
): Promise<PromiseScore[]> {
  const res = await fetch(`/api/synergy/sessions/${sessionId}/score`, {
    method: "POST",
  });
  const json = await asJson<{ scores: PromiseScore[] }>(res);
  return json.scores;
}
