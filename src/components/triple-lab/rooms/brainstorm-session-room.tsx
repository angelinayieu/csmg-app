"use client";

// ── BrainstormSessionRoom ──
//
// Renders a snapshot view of one brainstorm_sessions row (Synergy
// track). The room_config carries:
//   - session_id (uuid)
//   - title      (cached at creation time so we have something to show
//                 even before the GET resolves)
//
// On mount we fetch the session + nodes via /api/synergy/sessions/[id]
// and render:
//   - the objective_statement (if any)
//   - up to 8 nodes inline, with kind chips
//   - a "Open full board →" link to /app/synergy/[id] for the source
//
// Refresh is manual (a small ↻ button) — brainstorms are typically
// finished by the time you add them as a room, so background polling
// would be wasteful.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { RoomBodyProps } from "./room-registry";
import { colors } from "../tokens";

interface BrainstormNode {
  id: string;
  kind: string;
  label: string;
  meta: string | null;
}

interface BrainstormSession {
  id: string;
  title: string;
  objective_statement: string | null;
  state: string;
  updated_at: string;
}

const KIND_COLOR: Record<string, string> = {
  core: colors.brand.fg,
  branch: colors.layer.conceptual,
  insight: colors.state.leverage,
  question: colors.layer.external,
  action: colors.state.ok,
  user: colors.layer.internal,
  variation: colors.layer.bridge,
  ranking: colors.state.cycle,
};

export function BrainstormSessionRoom({ roomConfig }: RoomBodyProps) {
  const sessionId =
    typeof roomConfig?.session_id === "string" ? roomConfig.session_id : null;
  const cachedTitle =
    typeof roomConfig?.title === "string" ? roomConfig.title : "Brainstorm";

  const [session, setSession] = useState<BrainstormSession | null>(null);
  const [nodes, setNodes] = useState<BrainstormNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/synergy/sessions/${sessionId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        session: BrainstormSession;
        nodes: BrainstormNode[];
      };
      setSession(json.session ?? null);
      setNodes(json.nodes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!sessionId) {
    return (
      <div className="p-3 text-[12px]" style={{ color: colors.state.risk }}>
        Brainstorm room is missing a session_id. Try removing and re-adding it.
      </div>
    );
  }

  const visibleNodes = nodes.slice(0, 8);
  const overflow = Math.max(0, nodes.length - visibleNodes.length);
  const title = session?.title ?? cachedTitle;
  const objective = session?.objective_statement ?? null;

  return (
    <div className="px-3 py-2.5">
      {/* Header line: title + open-original + refresh */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="truncate text-[12px] font-semibold"
            style={{ color: colors.neutral.fg900 }}
            title={title}
          >
            {title}
          </div>
          {objective ? (
            <div
              className="mt-0.5 line-clamp-2 text-[11px] leading-snug"
              style={{ color: colors.neutral.fg500 }}
            >
              {objective}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded p-1 text-[10px] transition hover:bg-black/5"
            style={{ color: colors.neutral.fg500 }}
            title="Refresh"
            disabled={loading}
          >
            {loading ? "…" : "↻"}
          </button>
          <Link
            href={`/app/synergy/${sessionId}`}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium transition hover:bg-black/5"
            style={{ color: colors.brand.fg }}
            title="Open the full brainstorm board"
          >
            Open →
          </Link>
        </div>
      </div>

      {error ? (
        <div className="text-[11px]" style={{ color: colors.state.risk }}>
          {error}
        </div>
      ) : null}

      {/* Nodes list */}
      {visibleNodes.length === 0 && !loading && !error ? (
        <div className="text-[11px]" style={{ color: colors.neutral.fg400 }}>
          No nodes captured yet in this session.
        </div>
      ) : (
        <ul className="space-y-1">
          {visibleNodes.map((n) => (
            <li
              key={n.id}
              className="flex items-start gap-2 rounded-md px-1.5 py-1 transition hover:bg-black/[0.025]"
            >
              <span
                className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: KIND_COLOR[n.kind] ?? colors.neutral.fg400,
                }}
                title={n.kind}
              />
              <div className="min-w-0">
                <div
                  className="text-[12px] leading-snug"
                  style={{ color: colors.neutral.fg700 }}
                >
                  {n.label}
                </div>
                {n.meta ? (
                  <div
                    className="line-clamp-1 text-[10.5px]"
                    style={{ color: colors.neutral.fg400 }}
                  >
                    {n.meta}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {overflow > 0 ? (
        <div
          className="mt-1.5 text-[10.5px]"
          style={{ color: colors.neutral.fg400 }}
        >
          +{overflow} more — open the board to see all
        </div>
      ) : null}
    </div>
  );
}
