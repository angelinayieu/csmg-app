// ── RoomPresenceStack — avatar stack in the room header ──
//
// Each member of the room renders as a 28px circular avatar. The ring
// around the avatar carries the live-presence signal:
//
//   active (cursor moved in last ~5s) → hued ring (full intensity)
//   present (joined channel, not moving) → slate ring (mid intensity)
//   offline (not in the channel state) → faint slate ring
//
// A small green dot anchors the bottom-right corner when the user is
// present, pulsing softly when they're active. The whole stack uses
// negative-space overlap (-space-x-1.5) so 3+ avatars cascade like a
// classic Apple Files multi-share indicator.
//
// Members beyond `max` collapse into a "+N" chip — same Apple Mail
// thread participants pattern.

"use client";

import {
  abstractAvatarFor,
  abstractAvatarStyle,
} from "@/lib/synergy/abstract-avatar";

export interface RoomMember {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Props {
  /** Every member of the room (including the local user is OK — we render
   *  them too, since seeing yourself in the stack feels honest). */
  members: RoomMember[];
  /** Set of user_ids currently joined to the realtime presence channel. */
  presentUserIds: Set<string>;
  /** Subset of presentUserIds whose cursor moved recently. */
  activeUserIds?: Set<string>;
  /** Max avatars to render inline before collapsing the rest into "+N". */
  max?: number;
}

export function RoomPresenceStack({
  members,
  presentUserIds,
  activeUserIds,
  max = 3,
}: Props) {
  if (members.length === 0) return null;
  const visible = members.slice(0, max);
  const overflow = Math.max(0, members.length - max);
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((m) => (
        <PresenceAvatar
          key={m.userId}
          userId={m.userId}
          displayName={m.displayName}
          avatarUrl={m.avatarUrl}
          present={presentUserIds.has(m.userId)}
          active={activeUserIds?.has(m.userId) ?? false}
        />
      ))}
      {overflow > 0 && (
        <div
          className="font-numerical relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 font-mono text-[10px] font-semibold tabular-nums text-gray-600"
          style={{
            boxShadow: "0 0 0 1.5px #fff, 0 0 0 2px rgba(15,23,42,0.10)",
          }}
          title={`${overflow} more member${overflow === 1 ? "" : "s"}`}
        >
          +{overflow}
        </div>
      )}
      <style jsx global>{`
        @keyframes synergyPresenceDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.65; }
        }
      `}</style>
    </div>
  );
}

function PresenceAvatar({
  userId,
  displayName,
  avatarUrl,
  present,
  active,
}: {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  present: boolean;
  active: boolean;
}) {
  const av = abstractAvatarFor(userId);
  // Ring color tier: active > present > offline.
  const ringColor = active
    ? `hsl(${av.hue}, 70%, 50%)`
    : present
      ? "rgba(15, 23, 42, 0.55)"
      : "rgba(15, 23, 42, 0.18)";
  const ringWidth = active ? 3 : present ? 2.5 : 2;
  // Base avatar style — reuse the same gradient/initial system used in
  // anon match cards so identity reads consistently across the surface.
  const baseStyle = avatarUrl
    ? {
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: `center/cover no-repeat url(${avatarUrl})`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }
    : abstractAvatarStyle(userId, 28);

  return (
    <div
      className="relative"
      title={displayName ?? "Anon"}
      style={{
        ...baseStyle,
        boxShadow: `0 0 0 1.5px #fff, 0 0 0 ${ringWidth}px ${ringColor}`,
      }}
    >
      {!avatarUrl && (
        <span style={{ letterSpacing: "-0.5px" }}>{av.initials}</span>
      )}
      {present && (
        <span
          className="absolute -bottom-0.5 -right-0.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
          style={{
            boxShadow: "0 0 0 1.5px #fff",
            animation: active
              ? "synergyPresenceDot 1.8s ease-in-out infinite"
              : undefined,
          }}
        />
      )}
    </div>
  );
}
