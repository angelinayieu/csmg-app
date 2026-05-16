// ── Parallel-room client shell (C-2 — writes + realtime) ──
//
// C-1 was a passthrough — server bundle straight to render.
// C-2 owns the columns state so check-in writes (local + remote) can
// mutate them. Three sources of mutation:
//
//   1. Local: CheckinButton click → POST → onSuccess → local insert
//   2. Local: ReflectionEditor save → PATCH → onSaved → local update
//   3. Local: PlanStepRow Undo → DELETE → local remove
//   4. Remote: realtime CDC INSERT/UPDATE/DELETE on plan_step_checkins
//
// All four code paths converge on three reducer-style helpers
// (insertCheckin / updateCheckin / removeCheckin) so behavior is
// identical whether the change originated in this tab or theirs.
//
// Skip-if-mine guard: realtime echoes our own writes back. We dedupe
// by checking if the incoming row's id is already in our state. No-op
// if so — the optimistic local update already handled it.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/hooks/use-toast";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { RoomTopBar } from "./room-top-bar";
import { RoomHeader } from "./room-header";
import { SharedPillarsStrip } from "./shared-pillars-strip";
import { DivergenceCallout } from "./divergence-callout";
import { DivergenceBanner } from "./divergence-banner";
import { DualRailSummary } from "./dual-rail-summary";
import { PlanLedger } from "./plan-ledger";
import { WeeklyDigestLine } from "./weekly-digest-line";
import { archiveRoom } from "@/lib/synergy/archive-client";
import type {
  ParallelRoomBundle,
  ParallelRoomColumn,
  ParallelRoomPlanStep,
} from "@/app/app/synergy/rooms/[id]/parallel-room-bundle";
import type { CheckinRow } from "@/lib/synergy/checkin-client";
import { fetchPeerProfile } from "@/lib/synergy/reveal-client";

interface Props {
  bundle: ParallelRoomBundle;
}

// Step-level checkin shape used inside our columns state (matches the
// bundle shape's `checkin` field).
type StepCheckin = NonNullable<ParallelRoomPlanStep["checkin"]>;

// Convert a CheckinRow (server response shape) into the leaner shape
// stored on each plan step.
function toStepCheckin(row: CheckinRow): StepCheckin {
  return {
    id: row.id,
    marked_complete_at: row.marked_complete_at,
    reflection: row.reflection,
    updated_at: row.updated_at,
  };
}

export function ParallelRoomClient({ bundle }: Props) {
  const router = useRouter();

  // ── Local state ──
  // Stable user IDs so realtime payloads can be sided correctly
  const myUserId = bundle.columns[0].user_id;
  const theirUserId = bundle.columns[1].user_id;

  const [columns, setColumns] = useState<
    [ParallelRoomColumn, ParallelRoomColumn]
  >(bundle.columns);

  // ── Reveal handshake state (C-3) ──
  // Lifted out of the bundle so we can mutate it on local writes
  // (POST/DELETE on the reveal endpoint) and on remote CDC events.
  const [reveal, setReveal] = useState<{
    you_revealed: boolean;
    they_revealed: boolean;
    both_revealed: boolean;
    your_revealed_at: string | null;
  }>(bundle.reveal);
  // Profile data revealed only once BOTH have opted in. Initially from
  // the bundle (populated when both_revealed was true at page load).
  // Mutated by the peer-profile fetch + the realtime DELETE path.
  const [peer, setPeer] = useState<{
    display_name: string | null;
    avatar_url: string | null;
  }>({
    display_name: bundle.their_display_name,
    avatar_url: bundle.their_avatar_url,
  });

  // ── Divergence state (Phase 5 polish) ──
  // Banner visibility derived from (diverged_at !== null) AND
  // (divergence_dismissed_at === null). Local state so the banner can
  // hide optimistically on dismiss without waiting for a server round-trip.
  const [divergence, setDivergence] = useState<{
    diverged_at: string | null;
    dismissed_at: string | null;
  }>({
    diverged_at: bundle.room.diverged_at,
    dismissed_at: bundle.room.divergence_dismissed_at,
  });
  const showDivergenceBanner =
    divergence.diverged_at !== null && divergence.dismissed_at === null;

  // Track which step blocks just got a fresh check-in so the rail
  // can play the bounce animation exactly once. Keyed by step_block_id;
  // value is a timestamp we can use to age out after the animation runs.
  const [recentlyFilled, setRecentlyFilled] = useState<Set<string>>(
    () => new Set(),
  );
  // Toast cooldown so a burst of remote check-ins doesn't spam
  const lastRemoteToastRef = useRef<number>(0);

  const [you, them] = columns;

  // ── Reducer helpers ──
  //
  // Each one is idempotent (calling it twice with the same row is a
  // no-op) so the realtime echo of local writes doesn't double-insert.

  const insertCheckin = useCallback(
    (
      stepBlockId: string,
      userId: string,
      checkin: StepCheckin,
      opts?: { playAnimation?: boolean },
    ) => {
      setColumns((prev) => {
        const [a, b] = prev;
        const which = userId === a.user_id ? 0 : 1;
        const col = prev[which];
        const updatedSteps = col.plan_steps.map((s) =>
          s.block_id === stepBlockId
            ? {
                ...s,
                // Idempotent — if a checkin already exists with the
                // same id, leave it alone. Otherwise replace.
                checkin:
                  s.checkin?.id === checkin.id ? s.checkin : checkin,
              }
            : s,
        );
        const newCol: ParallelRoomColumn = {
          ...col,
          plan_steps: updatedSteps,
          completed: updatedSteps.filter((s) => s.checkin !== null).length,
        };
        return which === 0 ? [newCol, b] : [a, newCol];
      });
      if (opts?.playAnimation !== false) {
        setRecentlyFilled((prev) => {
          const next = new Set(prev);
          next.add(stepBlockId);
          return next;
        });
        // Age out after the animation runs
        setTimeout(() => {
          setRecentlyFilled((prev) => {
            const next = new Set(prev);
            next.delete(stepBlockId);
            return next;
          });
        }, 900);
      }
    },
    [],
  );

  const updateCheckin = useCallback(
    (checkinId: string, patch: Partial<StepCheckin>) => {
      setColumns((prev) => {
        let mutated = false;
        const next = prev.map((col) => ({
          ...col,
          plan_steps: col.plan_steps.map((s) => {
            if (s.checkin && s.checkin.id === checkinId) {
              mutated = true;
              return { ...s, checkin: { ...s.checkin, ...patch } };
            }
            return s;
          }),
        })) as [ParallelRoomColumn, ParallelRoomColumn];
        return mutated ? next : prev;
      });
    },
    [],
  );

  const removeCheckin = useCallback((checkinId: string) => {
    setColumns((prev) => {
      let mutated = false;
      const next = prev.map((col) => {
        const updatedSteps = col.plan_steps.map((s) => {
          if (s.checkin && s.checkin.id === checkinId) {
            mutated = true;
            return { ...s, checkin: null };
          }
          return s;
        });
        return {
          ...col,
          plan_steps: updatedSteps,
          completed: updatedSteps.filter((s) => s.checkin !== null).length,
        };
      }) as [ParallelRoomColumn, ParallelRoomColumn];
      return mutated ? next : prev;
    });
  }, []);

  // ── Local-write handlers (called from PlanStepRow's children) ──

  const onLocalCheckin = useCallback(
    (row: CheckinRow) => {
      insertCheckin(row.step_block_id, row.user_id, toStepCheckin(row), {
        playAnimation: true,
      });
    },
    [insertCheckin],
  );

  const onLocalReflection = useCallback(
    (row: CheckinRow) => {
      updateCheckin(row.id, {
        reflection: row.reflection,
        updated_at: row.updated_at,
      });
    },
    [updateCheckin],
  );

  const onLocalUndo = useCallback(
    (checkinId: string) => {
      removeCheckin(checkinId);
    },
    [removeCheckin],
  );

  // ── Reveal handshake reducers (C-3) ──
  //
  // Same dual-path pattern as check-ins: local POST/DELETE and remote
  // CDC events both call these reducers. The bothRevealed transition
  // triggers a peer-profile fetch (effect below).

  const setYouRevealed = useCallback((revealedAt: string | null) => {
    setReveal((prev) => {
      const youRevealed = revealedAt !== null;
      const bothRevealed = youRevealed && prev.they_revealed;
      return {
        you_revealed: youRevealed,
        they_revealed: prev.they_revealed,
        both_revealed: bothRevealed,
        your_revealed_at: revealedAt,
      };
    });
    // If we just withdrew (revealedAt === null), drop the peer profile
    // since mutual reveal is no longer satisfied.
    if (revealedAt === null) {
      setPeer({ display_name: null, avatar_url: null });
    }
  }, []);

  const setTheyRevealed = useCallback((theyRevealed: boolean) => {
    setReveal((prev) => ({
      ...prev,
      they_revealed: theyRevealed,
      both_revealed: prev.you_revealed && theyRevealed,
    }));
    // If they withdrew, drop the peer profile too.
    if (!theyRevealed) {
      setPeer({ display_name: null, avatar_url: null });
    }
  }, []);

  const onLocalReveal = useCallback(
    (revealedAt: string) => {
      setYouRevealed(revealedAt);
    },
    [setYouRevealed],
  );

  const onLocalWithdraw = useCallback(() => {
    setYouRevealed(null);
  }, [setYouRevealed]);

  // ── Effect: fetch peer profile when mutual reveal becomes true ──
  // Skip if we already have it (initial page load with bothRevealed=true).
  useEffect(() => {
    if (!reveal.both_revealed) return;
    if (peer.display_name !== null || peer.avatar_url !== null) return;
    let cancelled = false;
    void fetchPeerProfile(bundle.room.id)
      .then((p) => {
        if (cancelled) return;
        setPeer({
          display_name: p.display_name,
          avatar_url: p.avatar_url,
        });
      })
      .catch((e) => {
        // 403 is expected if the realtime event arrived ahead of DB
        // commit on the other side; we'll retry on the next render.
        console.warn("[reveal] peer-profile fetch failed:", (e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [reveal.both_revealed, peer.display_name, peer.avatar_url, bundle.room.id]);

  // ── Realtime subscription ──
  //
  // Postgres CDC over plan_step_checkins, filtered by room_id. We
  // pattern-match on payload.eventType and call the same reducers
  // used by the local-write path. Idempotency in the reducers makes
  // the echo of our own writes safe.

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`parallel-room:${bundle.room.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "plan_step_checkins",
          filter: `room_id=eq.${bundle.room.id}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          const checkin: StepCheckin = {
            id: row.id,
            marked_complete_at: row.marked_complete_at,
            reflection: row.reflection ?? null,
            updated_at: row.updated_at,
          };
          insertCheckin(row.step_block_id, row.user_id, checkin, {
            playAnimation: true,
          });
          // Micro-toast only for the other user, throttled
          if (row.user_id !== myUserId) {
            const now = Date.now();
            if (now - lastRemoteToastRef.current > 4000) {
              lastRemoteToastRef.current = now;
              toast.success("They checked in on a step", {
                ttl: 3000,
              });
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "plan_step_checkins",
          filter: `room_id=eq.${bundle.room.id}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          updateCheckin(row.id, {
            reflection: row.reflection ?? null,
            updated_at: row.updated_at,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "plan_step_checkins",
          filter: `room_id=eq.${bundle.room.id}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.old as any;
          if (row?.id) removeCheckin(row.id);
        },
      )
      // ── Reveal handshake events (C-3) ──
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "synergy_room_identity_reveals",
          filter: `room_id=eq.${bundle.room.id}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          if (row.user_id === myUserId) {
            // Echo of our own reveal — local handler already updated state
            return;
          }
          // Their reveal arrived
          setTheyRevealed(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "synergy_room_identity_reveals",
          filter: `room_id=eq.${bundle.room.id}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.old as any;
          if (!row?.user_id) return;
          if (row.user_id === myUserId) {
            // Echo of our own withdraw — already handled locally
            return;
          }
          // They withdrew (within 24h). Drop mutual-reveal state.
          setTheyRevealed(false);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // bundle.room.id is stable for the lifetime of this component
    // (the page re-mounts on route change). The reducers are stable
    // refs from useCallback so they're safe deps.
  }, [
    bundle.room.id,
    insertCheckin,
    updateCheckin,
    removeCheckin,
    setTheyRevealed,
    myUserId,
  ]);

  // ── Render ──

  // Display label for the OTHER user in the rail header. Pre-reveal
  // it stays "THEM" — keep the room language consistent regardless of
  // reveal state.
  const youLabel = "YOU";
  const themLabel = "THEM";

  // Memoize the rails props so dot-pulse keying stays stable across
  // unrelated re-renders.
  const youRailKey = useMemo(
    () => you.plan_steps.map((s) => (s.checkin ? "1" : "0")).join(""),
    [you.plan_steps],
  );
  const themRailKey = useMemo(
    () => them.plan_steps.map((s) => (s.checkin ? "1" : "0")).join(""),
    [them.plan_steps],
  );

  return (
    <div>
      <RoomTopBar
        roomId={bundle.room.id}
        youRevealed={reveal.you_revealed}
        theyRevealed={reveal.they_revealed}
        bothRevealed={reveal.both_revealed}
        theirDisplayName={peer.display_name}
        yourRevealedAt={reveal.your_revealed_at}
        onLocalReveal={onLocalReveal}
        onLocalWithdraw={onLocalWithdraw}
        onArchived={() => router.push("/app/synergy/rooms")}
      />

      {showDivergenceBanner && (
        <DivergenceBanner
          roomId={bundle.room.id}
          onDismissed={() =>
            setDivergence((prev) => ({
              ...prev,
              dismissed_at: new Date().toISOString(),
            }))
          }
          onArchive={async () => {
            try {
              await archiveRoom(bundle.room.id);
              router.push("/app/synergy/rooms");
            } catch (e) {
              toast.error("Couldn't archive", {
                description: (e as Error).message,
              });
            }
          }}
        />
      )}

      <RoomHeader
        sharedTheme={bundle.room.shared_theme}
        similarityScore={bundle.similarity_score}
        createdAt={bundle.room.created_at}
        pillarCount={bundle.room.shared_pillars.length}
      />

      <SharedPillarsStrip pillars={bundle.room.shared_pillars} />

      <DivergenceCallout summary={bundle.divergence_summary} />

      <DualRailSummary
        you={{
          side: "you",
          label: youLabel,
          completed: you.completed,
          total: you.total,
          stepBlockIds: you.plan_steps.map((s) => s.block_id),
          filled: you.plan_steps.map((s) => s.checkin !== null),
        }}
        them={{
          side: "them",
          label: themLabel,
          completed: them.completed,
          total: them.total,
          stepBlockIds: them.plan_steps.map((s) => s.block_id),
          filled: them.plan_steps.map((s) => s.checkin !== null),
        }}
        recentlyFilledStepIds={recentlyFilled}
        // Key the rail by the filled-pattern so it remounts cleanly on
        // any structural change. Forces consistent animation triggering.
        youKey={youRailKey}
        themKey={themRailKey}
      />

      <PlanLedger
        you={you}
        them={them}
        roomId={bundle.room.id}
        onLocalCheckin={onLocalCheckin}
        onLocalReflection={onLocalReflection}
        onLocalUndo={onLocalUndo}
      />

      <WeeklyDigestLine
        digest={bundle.digest}
        yourTotal={you.completed}
        theirTotal={them.completed}
        roomAgeDays={Math.floor(
          (Date.now() - new Date(bundle.room.created_at).getTime()) /
            86_400_000,
        )}
      />
    </div>
  );
}
