"use client";

// ── AddRoomModal ──
//
// Two-step picker:
//   Step 1: choose a room kind (only kinds whose allowedColumns
//           include the target slot are shown)
//   Step 2: when the kind has a source picker (e.g.
//           brainstorm_session), pick the source row
//           — kinds with source="none" skip to immediate create
//
// On submit we call `onCreate(kind, room_config)` and the parent
// closes the modal. The parent owns the actual mutation via
// useLabRooms.createRoom().

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ROOM_REGISTRY,
  roomsAllowedInColumn,
  type ColumnSlot,
  type RoomMeta,
} from "./room-registry";
import { colors } from "../tokens";

interface BrainstormSessionRow {
  id: string;
  title: string;
  objective_statement: string | null;
  state: string;
  updated_at: string;
  node_count?: number;
}

interface AddRoomModalProps {
  isOpen: boolean;
  slot: ColumnSlot;
  onClose: () => void;
  onCreate: (
    kind: string,
     
    roomConfig: Record<string, any>,
  ) => Promise<void> | void;
}

export function AddRoomModal({
  isOpen,
  slot,
  onClose,
  onCreate,
}: AddRoomModalProps) {
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BrainstormSessionRow[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const availableKinds = useMemo<RoomMeta[]>(
    () => roomsAllowedInColumn(slot),
    [slot],
  );

  const selectedMeta = selectedKind
    ? (ROOM_REGISTRY[selectedKind] ?? null)
    : null;

  // Reset state on open/close
  useEffect(() => {
    if (!isOpen) {
      setSelectedKind(null);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // When user selects a brainstorm_session kind, lazy-load sessions
  useEffect(() => {
    if (!isOpen) return;
    if (selectedMeta?.source !== "brainstorm_session") return;
    if (sessions !== null) return;

    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(null);
    fetch("/api/synergy/sessions", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ sessions: BrainstormSessionRow[] }>;
      })
      .then((json) => {
        if (!cancelled) setSessions(json.sessions ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setSessionsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedMeta, sessions]);

  const handleCreate = useCallback(
    async (
      kind: string,
       
      roomConfig: Record<string, any>,
    ) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        await onCreate(kind, roomConfig);
        onClose();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [onCreate, onClose],
  );

  if (!isOpen) return null;

  const slotLabel =
    slot === "left" ? "Left column" : slot === "middle" ? "Middle column" : "Right column";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: colors.neutral.scrim }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-white"
        style={{
          borderColor: colors.neutral.borderInput,
          boxShadow: colors.neutral.cardShadowFloating,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: colors.neutral.borderSoft }}
        >
          <div>
            <div
              className="text-[10px] font-semibold uppercase"
              style={{
                color: colors.brand.fg,
                letterSpacing: "0.18em",
              }}
            >
              {slotLabel}
            </div>
            <div
              className="mt-0.5 text-[14px] font-semibold"
              style={{ color: colors.neutral.fg900 }}
            >
              {selectedMeta ? `Add: ${selectedMeta.label}` : "Add a room"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[12px] transition hover:bg-black/5"
            style={{ color: colors.neutral.fg500 }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {!selectedMeta ? (
            // Step 1: kind picker
            <div className="space-y-2">
              {availableKinds.length === 0 ? (
                <div
                  className="rounded-md border border-dashed p-3 text-center text-[12px]"
                  style={{
                    borderColor: colors.neutral.borderInput,
                    color: colors.neutral.fg500,
                  }}
                >
                  No room kinds available in this column yet.
                </div>
              ) : (
                availableKinds.map((meta) => (
                  <button
                    key={meta.kind}
                    type="button"
                    onClick={() => {
                      // Kinds without a source picker create immediately
                      if (meta.source === "none") {
                        void handleCreate(meta.kind, { ...meta.defaultConfig });
                      } else {
                        setSelectedKind(meta.kind);
                      }
                    }}
                    className="group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:border-[color:var(--brand)]"
                    style={{
                      borderColor: colors.neutral.borderFaint,
                      background: colors.neutral.panelBgLightest,
                      // @ts-expect-error CSS custom prop
                      "--brand": colors.brand.fg,
                    }}
                  >
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[16px]"
                      style={{
                        background: colors.brand.bgChip,
                        color: colors.brand.fg,
                      }}
                    >
                      {meta.glyph}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: colors.neutral.fg900 }}
                      >
                        {meta.label}
                      </div>
                      <div
                        className="mt-0.5 text-[11.5px] leading-snug"
                        style={{ color: colors.neutral.fg500 }}
                      >
                        {meta.description}
                      </div>
                    </div>
                    <span
                      className="shrink-0 self-center text-[12px] opacity-0 transition group-hover:opacity-100"
                      style={{ color: colors.brand.fg }}
                    >
                      →
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : selectedMeta.source === "brainstorm_session" ? (
            // Step 2: brainstorm session picker
            <div>
              {sessionsLoading ? (
                <div
                  className="py-6 text-center text-[12px]"
                  style={{ color: colors.neutral.fg500 }}
                >
                  Loading your brainstorm sessions…
                </div>
              ) : sessionsError ? (
                <div
                  className="rounded-md border border-dashed p-3 text-center text-[12px]"
                  style={{
                    borderColor: colors.state.risk,
                    color: colors.state.risk,
                  }}
                >
                  {sessionsError}
                </div>
              ) : !sessions || sessions.length === 0 ? (
                <div
                  className="rounded-md border border-dashed p-4 text-center text-[12px]"
                  style={{
                    borderColor: colors.neutral.borderInput,
                    color: colors.neutral.fg500,
                  }}
                >
                  No brainstorm sessions yet. Start a Brainstorm Speedrun first
                  — it shows up here once you have nodes captured.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          void handleCreate(selectedMeta.kind, {
                            session_id: s.id,
                            title: s.title,
                          })
                        }
                        className="group flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition hover:border-[color:var(--brand)] disabled:opacity-50"
                        style={{
                          borderColor: colors.neutral.borderFaint,
                          background: colors.neutral.panelBgLightest,
                          // @ts-expect-error CSS custom prop
                          "--brand": colors.brand.fg,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-[12.5px] font-semibold"
                            style={{ color: colors.neutral.fg900 }}
                          >
                            {s.title || "Untitled brainstorm"}
                          </div>
                          {s.objective_statement ? (
                            <div
                              className="mt-0.5 line-clamp-1 text-[11px]"
                              style={{ color: colors.neutral.fg500 }}
                            >
                              {s.objective_statement}
                            </div>
                          ) : null}
                          <div
                            className="mt-1 flex items-center gap-2 text-[10px]"
                            style={{ color: colors.neutral.fg400 }}
                          >
                            <span>{s.node_count ?? 0} nodes</span>
                            <span>·</span>
                            <span>{s.state}</span>
                            <span>·</span>
                            <span>
                              {new Date(s.updated_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <span
                          className="shrink-0 self-center text-[12px] opacity-0 transition group-hover:opacity-100"
                          style={{ color: colors.brand.fg }}
                        >
                          +
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedKind(null)}
                  className="rounded px-2 py-1 text-[11px] transition hover:bg-black/5"
                  style={{ color: colors.neutral.fg500 }}
                >
                  ← Back
                </button>
              </div>
            </div>
          ) : null}

          {submitError ? (
            <div
              className="mt-3 rounded-md border p-2 text-[11px]"
              style={{
                borderColor: colors.state.risk,
                color: colors.state.risk,
              }}
            >
              {submitError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
