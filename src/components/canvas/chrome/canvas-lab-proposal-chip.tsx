"use client";

// ── Canvas lab-proposal chip ──
//
// Watches `/api/spaces/[id]/lab-scaffolds?status=proposed` for a
// pending wizard. When found, surfaces a violet floating chip on
// the whiteboard ("Lab proposal ready — review"). Click → opens
// the LabProposalWizard modal, which handles approve →
// materialize → navigate to lab.
//
// Polling cadence: 8s while no proposal pending, 30s after one
// shows up (we keep checking in case it gets superseded). Network
// chatter is minimal (single small JSON list), but we could
// upgrade to SSE if propose-lab fired its own structural event in
// the future.
//
// Renders nothing when no proposal exists. Hidden during the
// wizard's open state (the modal is the visible surface).

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { LabRoomIcon } from "@/components/canvas/icons";
import { LabProposalWizard } from "@/components/lab/lab-proposal-wizard";
import type { LabScaffold, Subject } from "@/types/subject";

interface Props {
  spaceId: string;
}

const POLL_INACTIVE_MS = 8000;
const POLL_ACTIVE_MS = 30000;

export function CanvasLabProposalChip({ spaceId }: Props) {
  const [pending, setPending] = useState<LabScaffold | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/spaces/${spaceId}/lab-scaffolds?status=proposed`,
        { credentials: "include" },
      );
      if (!r.ok) return;
      const json = (await r.json()) as { scaffolds: LabScaffold[] };
      const list = (json.scaffolds ?? []).filter(
        (s) => !dismissed.has(s.id),
      );
      // Newest pending wins.
      setPending(list[0] ?? null);
    } catch {
      /* soft-fail — polling will retry */
    }
  }, [spaceId, dismissed]);

  useEffect(() => {
    void poll();
    const interval = pending ? POLL_ACTIVE_MS : POLL_INACTIVE_MS;
    const t = window.setInterval(poll, interval);
    return () => window.clearInterval(t);
  }, [poll, pending]);

  const dismiss = () => {
    if (!pending) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(pending.id);
      return next;
    });
    setPending(null);
  };

  const onScaffolded = useCallback((subjects: Subject[]) => {
    // Wizard already navigated to the new subject's lab; clear
    // local state so we don't re-prompt.
    void subjects;
    setPending(null);
  }, []);

  if (!pending && !open) return null;

  return (
    <>
      {pending && !open && (
        <div className="pointer-events-none fixed bottom-20 right-3 z-[55] flex items-end justify-end">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-violet-300 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-md">
            <LabRoomIcon size={14} style={{ color: "#7c3aed" }} />
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[12px] font-semibold text-violet-700 hover:underline"
            >
              Lab proposal ready
            </button>
            <span className="text-[10px] text-slate-500">
              {pending.proposed_subjects.length} subject
              {pending.proposed_subjects.length === 1 ? "" : "s"} ·{" "}
              {pending.proposed_features.length} feature
              {pending.proposed_features.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={dismiss}
              className="ml-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Dismiss for this session"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
      {pending && (
        <LabProposalWizard
          spaceId={spaceId}
          scaffoldId={pending.id}
          open={open}
          onClose={() => setOpen(false)}
          onScaffolded={onScaffolded}
        />
      )}
    </>
  );
}
