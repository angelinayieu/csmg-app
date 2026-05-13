// ── Synergy bell badge ──
//
// Tiny notification indicator for the synergy nav header. Polls
// /api/synergy/notifications/count every 60s when mounted; shows a
// red dot when unseen_incoming > 0. Clicking navigates to the inbox.
//
// Polling is intentionally per-mount (one polling loop per page that
// renders the bell) — we don't lift to a global provider yet because
// only synergy pages need it. If we later want it in the global
// toolbox, lift to a Zustand store keyed on the user id.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getNotificationCount } from "@/lib/synergy/match-client";

const POLL_INTERVAL_MS = 60_000;

interface Props {
  initialCount?: number;
}

export function SynergyBellBadge({ initialCount = 0 }: Props) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const next = await getNotificationCount();
        if (!cancelled) setCount(next);
      } catch {
        // Soft-fail; badge just doesn't update this tick
      }
    };
    void fetchCount();
    const interval = window.setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/app/synergy/requests"
      title={
        count > 0
          ? `${count} new connection ${count === 1 ? "request" : "requests"}`
          : "Connection inbox"
      }
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 px-1 font-mono text-[9px] font-semibold text-white shadow-sm"
          style={{
            animation: "synergyBellPulse 1.8s ease-in-out infinite",
          }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
      <style jsx>{`
        @keyframes synergyBellPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
    </Link>
  );
}
