"use client";

// ── UserRoomsStack ──
//
// Renders the user-added rooms for a single column above its default
// panel. Owns:
//   - the room shells (collapse/delete via room-shell.tsx)
//   - the "+ Add room" CTA + AddRoomModal at the top
//   - dispatching the registered body renderer for each kind
//
// Composes with triple-lab.tsx's existing column layout — the stack
// is given a column slot at mount and reads the matching rooms slice
// from useLabRooms. Nothing in this file knows about the default
// panels; they're sibling children of the column container.

import { useCallback, useState } from "react";
import type { LabRoomRow } from "@/app/api/spaces/[id]/lab-rooms/route";
import { AddRoomButton } from "./add-room-button";
import { AddRoomModal } from "./add-room-modal";
import { RoomShell } from "./room-shell";
import { getRoomMeta, type ColumnSlot } from "./room-registry";
import { colors } from "../tokens";

interface UserRoomsStackProps {
  spaceId: string;
  slot: ColumnSlot;
  rooms: LabRoomRow[];
  onCreate: (
    slot: ColumnSlot,
    kind: string,
     
    roomConfig: Record<string, any>,
  ) => Promise<LabRoomRow | null>;
  onPatch: (
    roomId: string,
    patch: {
      collapsed?: boolean;
      position?: number;
       
      room_config?: Record<string, any>;
    },
  ) => Promise<unknown>;
  onDelete: (roomId: string) => Promise<boolean>;
}

export function UserRoomsStack({
  spaceId,
  slot,
  rooms,
  onCreate,
  onPatch,
  onDelete,
}: UserRoomsStackProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleModalCreate = useCallback(
     
    async (kind: string, roomConfig: Record<string, any>) => {
      const room = await onCreate(slot, kind, roomConfig);
      if (!room) {
        throw new Error("Failed to create room.");
      }
    },
    [onCreate, slot],
  );

  return (
    <div className="space-y-2 px-2.5 pt-2.5">
      {rooms.map((room) => {
        const meta = getRoomMeta(room.kind);
        if (!meta) {
          // Unknown kind — render an error-style shell so the user can
          // remove the orphan row rather than silently dropping it.
          return (
            <div
              key={room.id}
              className="rounded-lg border p-3 text-[11.5px]"
              style={{
                borderColor: colors.state.risk,
                color: colors.state.risk,
                background: colors.state.riskSoft,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span>Unknown room kind: {room.kind}</span>
                <button
                  type="button"
                  onClick={() => void onDelete(room.id)}
                  className="rounded px-2 py-0.5 text-[10px] transition hover:bg-black/5"
                  style={{ color: colors.state.risk }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        }
        const Body = meta.Body;
        return (
          <RoomShell
            key={room.id}
            glyph={meta.glyph}
            label={meta.label}
            collapsed={room.collapsed}
            onToggleCollapsed={() =>
              void onPatch(room.id, { collapsed: !room.collapsed })
            }
            onDelete={() => void onDelete(room.id)}
          >
            <Body
              spaceId={spaceId}
              roomId={room.id}
              roomConfig={room.room_config ?? {}}
              onRequestDelete={() => void onDelete(room.id)}
            />
          </RoomShell>
        );
      })}

      <AddRoomButton onClick={() => setModalOpen(true)} />

      <AddRoomModal
        isOpen={modalOpen}
        slot={slot}
        onClose={() => setModalOpen(false)}
        onCreate={handleModalCreate}
      />
    </div>
  );
}
