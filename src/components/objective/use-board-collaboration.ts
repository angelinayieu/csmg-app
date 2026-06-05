"use client";

// ── Live multiplayer for the objective whiteboard ─────────────────
//
// Bridges the tldraw store to a private Supabase Realtime channel
// (`board:{spaceId}`) so participants co-edit in real time with presence
// cursors — Figma/Miro-style — WITHOUT a dedicated WebSocket server
// (we're on Vercel serverless). The durable store of record stays the
// debounced PUT snapshot in `use-objective-board-persistence.ts`; this
// hook layers live deltas on top of it.
//
// Design notes:
//   • Outbound shape edits: a SECOND store.listen filtered to
//     { source: 'user', scope: 'document' } — so applied REMOTE deltas
//     (tagged source:'remote' by mergeRemoteChanges) never re-broadcast.
//   • Inbound deltas applied via store.mergeRemoteChanges (echo guard) +
//     broadcast.self:false (second guard).
//   • Cursors ride a separate high-frequency 'cursor' broadcast and are
//     rendered natively via InstancePresenceRecordType (presence scope —
//     NOT serialized into the saved snapshot).
//   • Single-writer election off the presence roster: owner-if-present
//     else lowest clientId. Everyone computes the same winner; only the
//     winner persists the durable snapshot (see canSave gate).
//
// Mirrors the channel lifecycle of use-realtime-agent-findings.ts.

import { useEffect, useRef, useState } from "react";
import type { Editor, TLRecord } from "tldraw";
import { InstancePresenceRecordType } from "tldraw";
import { createClient } from "@/lib/supabase/client";

type TLRecordId = TLRecord["id"];

export type BoardRole = "owner" | "editor" | "viewer";

export interface BoardIdentity {
  userId: string;
  name: string;
  color: string;
  role: BoardRole;
}

export interface BoardCollaborator {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  role: BoardRole;
}

export interface UseBoardCollaborationResult {
  status: "off" | "connecting" | "live" | "error";
  collaborators: BoardCollaborator[];
  isSaver: boolean;
  selfClientId: string;
}

interface PresenceMeta {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  role: BoardRole;
}

const CURSOR_THROTTLE_MS = 50;
const DELTA_BATCH_MS = 90;

/** Stable, non-colliding palette for cursor colors (hash userId → pick). */
const CURSOR_PALETTE = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#65a30d", "#ea580c", "#4f46e5",
];

export function colorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return CURSOR_PALETTE[Math.abs(h) % CURSOR_PALETTE.length];
}

function randomClientId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `c_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function useBoardCollaboration(
  editor: Editor | null,
  spaceId: string,
  opts: {
    /** Spin up only when the board is shared with ≥1 other participant. */
    enabled: boolean;
    /** True once persistence restore has settled — must not start before. */
    ready: boolean;
    identity: BoardIdentity | null;
  },
): UseBoardCollaborationResult {
  const { enabled, ready, identity } = opts;
  const selfClientIdRef = useRef<string>(randomClientId());
  const [status, setStatus] = useState<UseBoardCollaborationResult["status"]>("off");
  const [collaborators, setCollaborators] = useState<BoardCollaborator[]>([]);
  const [isSaver, setIsSaver] = useState(true);

  // Latest identity in a ref so the long-lived effect doesn't re-subscribe
  // on a name/color tweak.
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    if (!editor || !enabled || !ready || !identity) {
      setStatus("off");
      return;
    }

    const self = selfClientIdRef.current;
    const supabase = createClient();
    const channel = supabase.channel(`board:${spaceId}`, {
      config: {
        // Private → realtime.messages RLS gates membership (see migration).
        // self:false → never receive our own broadcasts (echo guard #2).
        broadcast: { self: false },
        presence: { key: self },
        private: true,
      },
    });

    setStatus("connecting");

    // ── Outbound shape deltas (batched/coalesced) ──
    const pendingPuts = new Map<string, TLRecord>();
    const pendingRemoves = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (pendingPuts.size === 0 && pendingRemoves.size === 0) return;
      const puts = [...pendingPuts.values()];
      const removes = [...pendingRemoves];
      pendingPuts.clear();
      pendingRemoves.clear();
      channel.send({
        type: "broadcast",
        event: "delta",
        payload: { from: self, puts, removes },
      });
    };
    const scheduleFlush = () => {
      if (flushTimer == null) flushTimer = setTimeout(flush, DELTA_BATCH_MS);
    };

    const unlistenStore = editor.store.listen(
      (entry) => {
        // Viewers never broadcast edits (belt-and-suspenders alongside the
        // readonly instance state set in whiteboard-base).
        if (identityRef.current?.role === "viewer") return;
        const { added, updated, removed } = entry.changes;
        for (const rec of Object.values(added)) {
          if (rec.typeName === "asset") continue; // never ship base64 blobs
          pendingPuts.set(rec.id, rec as TLRecord);
          pendingRemoves.delete(rec.id);
        }
        for (const pair of Object.values(updated)) {
          const next = pair[1] as TLRecord;
          if (next.typeName === "asset") continue;
          pendingPuts.set(next.id, next);
          pendingRemoves.delete(next.id);
        }
        for (const rec of Object.values(removed)) {
          pendingRemoves.add(rec.id);
          pendingPuts.delete(rec.id);
        }
        scheduleFlush();
      },
      { source: "user", scope: "document" },
    );

    // ── Inbound shape deltas ──
    channel.on("broadcast", { event: "delta" }, ({ payload }) => {
      if (!payload || payload.from === self) return;
      const puts = (payload.puts ?? []) as TLRecord[];
      const removes = (payload.removes ?? []) as TLRecordId[];
      editor.store.mergeRemoteChanges(() => {
        if (puts.length) editor.store.put(puts);
        if (removes.length) {
          const existing = removes.filter((id) => editor.store.has(id));
          if (existing.length) editor.store.remove(existing);
        }
      });
    });

    // ── Cursors (presence-scope records, never persisted) ──
    const upsertRemoteCursor = (p: {
      clientId: string;
      x: number;
      y: number;
      name?: string;
      color?: string;
    }) => {
      const id = InstancePresenceRecordType.createId(p.clientId);
      editor.store.mergeRemoteChanges(() => {
        editor.store.put([
          InstancePresenceRecordType.create({
            id,
            currentPageId: editor.getCurrentPageId(),
            userId: p.clientId,
            userName: p.name ?? "Guest",
            color: p.color ?? "#2563eb",
            cursor: { x: p.x, y: p.y, type: "default", rotation: 0 },
            lastActivityTimestamp: Date.now(),
          }),
        ]);
      });
    };
    const removeRemoteCursor = (clientId: string) => {
      const id = InstancePresenceRecordType.createId(clientId);
      if (!editor.store.has(id)) return;
      editor.store.mergeRemoteChanges(() => editor.store.remove([id]));
    };

    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      if (!payload || payload.clientId === self) return;
      upsertRemoteCursor(payload);
    });

    // Local cursor → throttled broadcast.
    let lastCursorAt = 0;
    const container = editor.getContainer();
    const onPointerMove = () => {
      const now = Date.now();
      if (now - lastCursorAt < CURSOR_THROTTLE_MS) return;
      lastCursorAt = now;
      const pt = editor.inputs.currentPagePoint;
      const id = identityRef.current;
      channel.send({
        type: "broadcast",
        event: "cursor",
        payload: {
          clientId: self,
          x: pt.x,
          y: pt.y,
          name: id?.name ?? "Guest",
          color: id?.color ?? "#2563eb",
        },
      });
    };
    container?.addEventListener("pointermove", onPointerMove);

    // ── Presence roster + saver election ──
    const recomputeFromPresence = () => {
      const state = channel.presenceState() as unknown as Record<
        string,
        PresenceMeta[]
      >;
      const metas: PresenceMeta[] = [];
      for (const key of Object.keys(state)) {
        const entry = state[key]?.[0];
        if (entry) metas.push(entry);
      }
      // Roster excludes self for the avatar stack.
      const others = metas
        .filter((m) => m.clientId !== self)
        .map((m) => ({
          clientId: m.clientId,
          userId: m.userId,
          name: m.name,
          color: m.color,
          role: m.role,
        }));
      setCollaborators(others);

      // Drop cursors for clients no longer present.
      const presentIds = new Set(metas.map((m) => m.clientId));
      for (const id of [...knownCursorClients]) {
        if (!presentIds.has(id)) {
          removeRemoteCursor(id);
          knownCursorClients.delete(id);
        }
      }
      for (const id of presentIds) if (id !== self) knownCursorClients.add(id);

      // Saver election: owner-if-present, else lowest clientId. Empty roster
      // (only self, mid-subscribe) → this client saves.
      const pool = metas.length ? metas : [
        { clientId: self, role: identityRef.current?.role ?? "editor" } as PresenceMeta,
      ];
      const owners = pool.filter((m) => m.role === "owner").map((m) => m.clientId);
      const winner = (owners.length ? owners : pool.map((m) => m.clientId))
        .sort()[0];
      setIsSaver(winner === self);
    };
    const knownCursorClients = new Set<string>();

    channel.on("presence", { event: "sync" }, recomputeFromPresence);
    channel.on("presence", { event: "join" }, recomputeFromPresence);
    channel.on("presence", { event: "leave" }, recomputeFromPresence);

    channel.subscribe((channelStatus) => {
      if (channelStatus === "SUBSCRIBED") {
        const id = identityRef.current;
        void channel.track({
          clientId: self,
          userId: id?.userId ?? self,
          name: id?.name ?? "Guest",
          color: id?.color ?? "#2563eb",
          role: id?.role ?? "editor",
        } satisfies PresenceMeta);
        setStatus("live");
      } else if (
        channelStatus === "CHANNEL_ERROR" ||
        channelStatus === "TIMED_OUT"
      ) {
        setStatus("error");
      }
    });

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      container?.removeEventListener("pointermove", onPointerMove);
      unlistenStore();
      // Sweep any remote cursors we injected so they don't linger.
      for (const id of knownCursorClients) removeRemoteCursor(id);
      void supabase.removeChannel(channel);
      setStatus("off");
      setCollaborators([]);
      setIsSaver(true);
    };
  }, [editor, spaceId, enabled, ready, identity]);

  return {
    status,
    collaborators,
    isSaver,
    selfClientId: selfClientIdRef.current,
  };
}
