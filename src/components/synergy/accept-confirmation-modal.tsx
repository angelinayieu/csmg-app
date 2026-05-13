// ── Accept Confirmation modal (Surface D) ──
//
// Surfaces after the receiver clicks "Accept" on an incoming request.
// Pre-fetches the SENDER'S profile (gated via /accept-preview) so the
// receiver makes their final decision with full info — but the
// reveal happens HERE, not in the inbox listing.
//
// On confirm: fires PATCH /requests/[id] with action=accept (the
// existing endpoint also auto-creates the synergy_room and returns
// room_id). Caller navigates to the room.
//
// On cancel: closes; request stays pending.

"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Edit3,
  Eye,
  Loader2,
  Sparkles,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { acceptPreview } from "@/lib/synergy/match-client";
import type {
  AcceptPreviewResponse,
} from "@/lib/synergy/match-client";

interface Props {
  requestId: string;
  open: boolean;
  onClose: () => void;
  onAccepted: (roomId: string | null) => void;
}

export function AcceptConfirmationModal({
  requestId,
  open,
  onClose,
  onAccepted,
}: Props) {
  const [preview, setPreview] = useState<AcceptPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    acceptPreview(requestId)
      .then((r) => {
        if (cancelled) return;
        setPreview(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, requestId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, confirming]);

  if (!open) return null;

  const confirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/synergy/requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as { room_id: string | null };
      toast.success("Connected — opening shared room");
      onAccepted(body.room_id);
    } catch (e) {
      toast.error("Accept failed", { description: (e as Error).message });
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirming) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm acceptance"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(20px)",
          boxShadow:
            "0 0 60px -15px rgba(6, 182, 212, 0.4), 0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.5) 50%, transparent 100%)",
          }}
        />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200/60 px-6 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 shadow-sm">
              <Eye className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">
                Reveal profiles?
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
                Both sides will see each other after this
              </div>
            </div>
          </div>
          <button
            onClick={() => !confirming && onClose()}
            disabled={confirming}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Loading sender profile…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
              {error}
            </div>
          )}

          {preview && !loading && !error && (
            <>
              {/* Sender profile (revealed at moment-of-decision) */}
              <section>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                  About to connect with
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-200 to-cyan-200 text-blue-800">
                    <UserCircle2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-gray-900">
                      {preview.sender_profile?.display_name ?? "Anonymous"}
                    </div>
                    {preview.sender_profile?.bio && (
                      <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                        {preview.sender_profile.bio}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* What they'll see about me */}
              <section>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                  They&apos;ll see
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-200 to-cyan-200 text-emerald-800">
                    <UserCircle2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[14px] font-semibold text-gray-900">
                        {preview.my_profile?.display_name ?? "(your display name)"}
                      </div>
                      <a
                        href="/app/synergy/profile"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
                      >
                        <Edit3 className="h-3 w-3" /> Edit bio
                      </a>
                    </div>
                    {preview.my_profile?.bio ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                        {preview.my_profile.bio}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] italic text-gray-500">
                        No bio yet — edit before connecting (optional)
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Additional components if any */}
              {preview.additional_components.length > 0 && (
                <section>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                    They&apos;re also sharing
                  </div>
                  <ul className="space-y-1.5">
                    {preview.additional_components.map((c, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
                            {c.kind}
                          </span>
                          <span className="text-[12px] font-semibold text-gray-900">
                            {c.label_public}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                          {c.description_public}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-[11px] leading-relaxed text-blue-900">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                  <div>
                    <span className="font-semibold">What happens next:</span> A
                    shared room opens for both of you with the matched
                    components pinned + a live co-edit whiteboard.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t border-gray-200/60 px-6 py-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.85) 50%)",
          }}
        >
          <button
            onClick={() => !confirming && onClose()}
            disabled={confirming}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={confirm}
            disabled={confirming || loading || !!error}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_4px_20px_-4px_rgba(6,182,212,0.5)] transition hover:scale-[1.02] disabled:opacity-60"
          >
            {confirming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {confirming ? "Opening room…" : "Connect + open room"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
