"use client";

import { useCallback, useState } from "react";

export function useCanvasAcceptReject(spaceId: string) {
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);

  const accept = useCallback(
    async (entityId: string, edgeIds: string[]): Promise<boolean> => {
      setPending("accept");
      try {
        const res = await fetch("/api/canvas/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityId, edgeIds }),
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        setPending(null);
      }
    },
    [spaceId],
  );

  const reject = useCallback(
    async (entityId: string, edgeIds: string[]): Promise<boolean> => {
      setPending("reject");
      try {
        const res = await fetch("/api/canvas/reject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityId, edgeIds }),
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        setPending(null);
      }
    },
    [spaceId],
  );

  return { accept, reject, pending };
}
