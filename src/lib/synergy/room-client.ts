// ── Synergy room — client wrappers + shared types ──
//
// Co-edit room API surface. Lightweight node CRUD that mirrors the
// realtime postgres_changes payloads, so the client can use either
// optimistic updates or pure-realtime sync without translation.

export type RoomNodeKind =
  | "core"
  | "branch"
  | "insight"
  | "question"
  | "action"
  | "variation"
  | "ranking"
  | "plan"
  | "synergy"
  | "anchor";

export interface RoomNode {
  id: string;
  room_id: string;
  author_id: string;
  parent_id: string | null;
  kind: RoomNodeKind;
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
  updated_at: string;
}

export interface RoomComponent {
  id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
}

export interface RoomProfile {
  user_id?: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface SynergyRoomBundle {
  room: {
    id: string;
    user_a: string;
    user_b: string;
    intersection_objective: string | null;
    archived_at: string | null;
    created_at: string;
    i_am: "a" | "b";
  };
  my_component: RoomComponent | null;
  their_component: RoomComponent | null;
  their_profile: RoomProfile | null;
  nodes: RoomNode[];
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function loadRoom(roomId: string): Promise<SynergyRoomBundle> {
  const res = await fetch(`/api/synergy/rooms/${roomId}`);
  return asJson<SynergyRoomBundle>(res);
}

export async function archiveRoom(
  roomId: string,
  archive: boolean,
): Promise<void> {
  const res = await fetch(`/api/synergy/rooms/${roomId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archive }),
  });
  await asJson<{ room: unknown }>(res);
}

export async function createRoomNode(
  roomId: string,
  node: {
    id?: string;
    parent_id?: string | null;
    kind: RoomNodeKind;
    label: string;
    meta?: string | null;
    x: number;
    y: number;
  },
): Promise<RoomNode> {
  const res = await fetch(`/api/synergy/rooms/${roomId}/nodes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(node),
  });
  const json = await asJson<{ node: RoomNode }>(res);
  return json.node;
}

export async function updateRoomNode(
  roomId: string,
  nodeId: string,
  patch: Partial<Pick<RoomNode, "label" | "meta" | "x" | "y" | "parent_id">>,
): Promise<RoomNode> {
  const res = await fetch(`/api/synergy/rooms/${roomId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await asJson<{ node: RoomNode }>(res);
  return json.node;
}

export async function deleteRoomNode(
  roomId: string,
  nodeId: string,
): Promise<void> {
  const res = await fetch(`/api/synergy/rooms/${roomId}/nodes/${nodeId}`, {
    method: "DELETE",
  });
  await asJson<{ ok: true }>(res);
}
