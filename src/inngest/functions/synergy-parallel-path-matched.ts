/**
 * Synergy parallel-path matched — Inngest event consumer
 *
 * Triggered by "synergy/parallel-path.matched" (fired from the
 * /api/synergy/parallel-path-requests/[id]/respond endpoint when a
 * user accepts an invitation and the synergy_rooms row is created).
 *
 * Job: email the ORIGINAL REQUESTER that their invitation landed.
 * (The accepter doesn't need an email — they just clicked accept,
 * they're already in the room.)
 *
 * Privacy: the email surfaces only the shared_theme + shared_pillars.
 * The accepter's identity is NEVER revealed by this email — that's
 * gated by the in-room mutual-reveal handshake.
 *
 * Soft-fail discipline: any failure (recipient opted out, missing
 * email, transient send error) is logged but does not retry
 * aggressively. Email is a courtesy, not a correctness guarantee.
 */

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/service";
import { sendParallelPathAcceptedEmail } from "@/lib/email/triggers";

export const synergyParallelPathMatched = inngest.createFunction(
  {
    id: "synergy-parallel-path-matched",
    name: "Synergy · email requester when their parallel-path invite is accepted",
    retries: 1,
    triggers: [{ event: "synergy/parallel-path.matched" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { roomId, requesterId, accepterId, sharedTheme } = event.data as {
      roomId: string;
      requesterId: string;
      accepterId: string;
      sharedTheme: string;
    };

    // Step 1: hydrate shared_pillars from the room row. The event payload
    // carries the theme but not the pillars — we look them up here so the
    // event surface stays narrow.
    const sharedPillars: string[] = await step.run(
      "hydrate-shared-pillars",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = createServiceClient() as any;
        const { data: room } = await db
          .from("synergy_rooms")
          .select("shared_pillars, archived_at")
          .eq("id", roomId)
          .maybeSingle();
        if (!room) return [];
        if (room.archived_at) return []; // room got archived between accept + email
        return (room.shared_pillars ?? []) as string[];
      },
    );

    // Step 2: send the email (soft-fail wrapped inside the trigger)
    await step.run("send-parallel-path-accepted-email", async () => {
      await sendParallelPathAcceptedEmail({
        requester_user_id: requesterId,
        room_id: roomId,
        shared_theme: sharedTheme || "Parallel path",
        shared_pillars: sharedPillars,
      });
      return { sent: true };
    });

    return {
      room_id: roomId,
      requester_id: requesterId,
      accepter_id: accepterId,
      shared_theme: sharedTheme,
      shared_pillars_count: sharedPillars.length,
    };
  },
);
