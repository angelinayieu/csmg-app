// ── RoomRightRail — unified right-edge panel (Timeline + Chat) ──
//
// One pill collapsed, one panel expanded. Inside the panel a segmented
// control flips between tabs:
//
//   Timeline → activity log fed by synergy_room_events (R2)
//   Chat     → message thread fed by synergy_room_messages (R3)
//
// Designed so future tabs (AI mindmap, outcomes diff) can slot in
// without re-architecting the shell.

"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, MessageSquare, X } from "lucide-react";
import type { RoomEvent } from "@/hooks/synergy/use-room-events";
import type { RoomMessage, RoomMessageKind } from "@/lib/synergy/room-messages";
import { RoomTimelineTab } from "./room-timeline-tab";
import { RoomChatTab } from "./room-chat-tab";

type Tab = "timeline" | "chat";

interface Props {
  // Shared
  myUserId: string;
  theirDisplayName: string | null;
  archived: boolean;
  open: boolean;
  onToggle: () => void;

  // Timeline
  events: RoomEvent[];
  eventsLoading: boolean;

  // Chat
  messages: RoomMessage[];
  messagesLoading: boolean;
  onSendMessage: (
    body: string,
    opts?: { kind?: RoomMessageKind; meta?: Record<string, unknown> },
  ) => Promise<boolean>;
}

const SEEN_KEY = (roomId: string, tab: Tab) =>
  `synergy_room_${tab}_last_seen:${roomId}`;

export function RoomRightRail({
  myUserId,
  theirDisplayName,
  archived,
  open,
  onToggle,
  events,
  eventsLoading,
  messages,
  messagesLoading,
  onSendMessage,
}: Props) {
  const [tab, setTab] = useState<Tab>("chat");

  // ── Unseen tracking (localStorage, per room+tab) ──
  // Stamps the most recent timestamp the user actually saw. When the
  // rail is opened to a given tab, we update that key. When closed,
  // we count items newer than the key.
  const roomKey = events[0]?.room_id ?? messages[0]?.room_id ?? "_";
  const [seenTimeline, setSeenTimeline] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(SEEN_KEY(roomKey, "timeline")) ?? "";
  });
  const [seenChat, setSeenChat] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(SEEN_KEY(roomKey, "chat")) ?? "";
  });

  const newestEventTs = events[events.length - 1]?.created_at ?? "";
  const newestMessageTs = messages[messages.length - 1]?.created_at ?? "";

  const timelineUnseen = useMemo(() => {
    if (!newestEventTs) return 0;
    return events.filter(
      (e) => e.created_at > seenTimeline && e.actor_id !== myUserId,
    ).length;
  }, [events, seenTimeline, newestEventTs, myUserId]);

  const chatUnseen = useMemo(() => {
    if (!newestMessageTs) return 0;
    return messages.filter(
      (m) => m.created_at > seenChat && m.author_id !== myUserId,
    ).length;
  }, [messages, seenChat, newestMessageTs, myUserId]);

  // Mark seen whenever the rail is open on the matching tab.
  useEffect(() => {
    if (!open) return;
    if (tab === "timeline" && newestEventTs && newestEventTs !== seenTimeline) {
      localStorage.setItem(SEEN_KEY(roomKey, "timeline"), newestEventTs);
      setSeenTimeline(newestEventTs);
    }
    if (tab === "chat" && newestMessageTs && newestMessageTs !== seenChat) {
      localStorage.setItem(SEEN_KEY(roomKey, "chat"), newestMessageTs);
      setSeenChat(newestMessageTs);
    }
  }, [
    open,
    tab,
    newestEventTs,
    newestMessageTs,
    seenTimeline,
    seenChat,
    roomKey,
  ]);

  // ── Collapsed pill ──
  if (!open) {
    // Pick the "louder" surface for the pill — whichever has unseen.
    // Chat takes priority because messages are higher-intent than node
    // edits in a co-creation room.
    const showChatHint = chatUnseen > 0;
    const showTimelineHint = !showChatHint && timelineUnseen > 0;
    const PillIcon = showChatHint ? MessageSquare : Activity;
    const pillLabel = showChatHint
      ? `Chat${chatUnseen > 0 ? ` · ${chatUnseen}` : ""}`
      : showTimelineHint
        ? `Activity · ${timelineUnseen}`
        : "Activity";
    return (
      <button
        onClick={() => {
          if (showChatHint) setTab("chat");
          else if (showTimelineHint) setTab("timeline");
          onToggle();
        }}
        className="absolute right-3 top-16 z-20 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-700 shadow-sm backdrop-blur transition hover:border-gray-300"
        title="Open room rail"
      >
        <PillIcon className="h-3 w-3" strokeWidth={1.75} />
        {pillLabel}
        {(chatUnseen > 0 || timelineUnseen > 0) && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gray-900"
            style={{
              animation: "roomRailUnseenPulse 1.6s ease-in-out infinite",
            }}
          />
        )}
        <style jsx>{`
          @keyframes roomRailUnseenPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </button>
    );
  }

  // ── Expanded panel ──
  return (
    <aside
      className="absolute right-3 top-16 bottom-3 z-20 flex w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white/95 backdrop-blur"
      style={{
        boxShadow:
          "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -12px rgba(15,23,42,0.18)",
      }}
    >
      {/* Header — segmented control + close */}
      <header className="flex items-center justify-between gap-2 border-b border-gray-200/70 px-3 py-2.5">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-gray-50 p-0.5 text-[11px] font-medium">
          <TabButton
            active={tab === "timeline"}
            onClick={() => setTab("timeline")}
            icon={Activity}
            label="Timeline"
            unseen={timelineUnseen}
          />
          <TabButton
            active={tab === "chat"}
            onClick={() => setTab("chat")}
            icon={MessageSquare}
            label="Chat"
            unseen={chatUnseen}
          />
        </div>
        <button
          onClick={onToggle}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          title="Collapse"
          aria-label="Collapse rail"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </header>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        {tab === "timeline" ? (
          <RoomTimelineTab
            events={events}
            loading={eventsLoading}
            myUserId={myUserId}
            theirDisplayName={theirDisplayName}
          />
        ) : (
          <RoomChatTab
            messages={messages}
            loading={messagesLoading}
            myUserId={myUserId}
            theirDisplayName={theirDisplayName}
            archived={archived}
            onSend={onSendMessage}
          />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  unseen,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Activity;
  label: string;
  unseen: number;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition",
        active
          ? "bg-gray-900 text-white"
          : "text-gray-600 hover:text-gray-900",
      ].join(" ")}
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {label}
      {!active && unseen > 0 && (
        <span className="font-numerical inline-block min-w-[14px] rounded-full bg-gray-900 px-1 text-center text-[9px] font-semibold tabular-nums text-white">
          {unseen > 99 ? "99+" : unseen}
        </span>
      )}
    </button>
  );
}
