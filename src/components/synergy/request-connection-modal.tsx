// ── Request Connection modal ──
//
// Opens from a match card on /app/synergy/discover. Shows a clean,
// confidence-building summary of what the OTHER party will see if
// the user submits — full transparency. Then accepts an optional
// short message and submits.
//
// Privacy: nothing about the sender is leaked beyond what's already
// on their published matchable components. Sender stays anonymous
// to the receiver until the receiver accepts.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Loader2,
  Lock,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { createMatchRequest, listMatches } from "@/lib/synergy/match-client";
import type { RedactedMatch } from "@/lib/synergy/match-client";

interface Props {
  match: RedactedMatch;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  // Fires when the POST endpoint returns kind=existing_inbound (i.e.
  // the other user already requested us first). Caller redirects to
  // the inbox so the user can accept the existing request.
  onExistingInbound?: (requestId: string) => void;
}

const MAX_LEN = 500;
const MAX_ADDITIONAL = 3;

interface OwnComponent {
  id: string;
  kind: string;
  label_public: string;
  description_public: string;
}

export function RequestConnectionModal({
  match,
  open,
  onClose,
  onSent,
  onExistingInbound,
}: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [ownComponents, setOwnComponents] = useState<OwnComponent[]>([]);
  const [additionalSelected, setAdditionalSelected] = useState<Set<string>>(
    new Set(),
  );
  const [loadingOwn, setLoadingOwn] = useState(false);

  // Fetch my OTHER matchable components (excluding the one I'm
  // requesting on) so the user can offer additional shared components
  // along with this request. We piggyback on listMatches() which
  // already returns my-side components in each row — it's the
  // cheapest way to enumerate "mine" without a new endpoint.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingOwn(true);
    listMatches({ limit: 50, minScore: 0 })
      .then((page) => {
        if (cancelled) return;
        const seen = new Set<string>([match.mine.id]);
        const out: OwnComponent[] = [];
        for (const m of page.matches) {
          if (seen.has(m.mine.id)) continue;
          seen.add(m.mine.id);
          out.push({
            id: m.mine.id,
            kind: m.mine.kind,
            label_public: m.mine.label_public,
            description_public: m.mine.description_public,
          });
        }
        setOwnComponents(out.slice(0, 8));
      })
      .catch(() => {
        // Silent — additional-components UI just shows empty
      })
      .finally(() => {
        if (!cancelled) setLoadingOwn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, match.mine.id]);

  const toggleAdditional = (id: string) => {
    setAdditionalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_ADDITIONAL) next.add(id);
      else {
        toast.info(`Up to ${MAX_ADDITIONAL} additional components`);
        return prev;
      }
      return next;
    });
  };

  // ESC to close, focus textarea on open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    setTimeout(() => textareaRef.current?.focus(), 100);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, sending]);

  if (!open) return null;

  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      const res = await createMatchRequest({
        fromComponentId: match.mine.id,
        toComponentId: match.theirs.id,
        matchId: match.id,
        message: message.trim() || undefined,
        additionalComponentIds: Array.from(additionalSelected),
      });
      // Bidirectional resolve: server returned existing_inbound
      if ("kind" in res && res.kind === "existing_inbound") {
        toast.info("They already requested you", {
          description: "Opening your inbox to respond.",
        });
        onClose();
        onExistingInbound?.(res.request_id);
        return;
      }
      toast.success("Request sent", {
        description:
          "We'll surface their response in your inbox. Profile reveals when they accept.",
      });
      setMessage("");
      onSent();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes("already exists")) {
        toast.info("You've already requested this connection.");
        onClose();
      } else {
        toast.error("Couldn't send request", { description: msg });
      }
    } finally {
      setSending(false);
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
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Request connection"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(20px)",
          boxShadow:
            "0 0 60px -15px rgba(6, 182, 212, 0.4), 0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner top cyan accent line */}
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
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
              <Send className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">
                Request connection
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
                Anonymous until they accept
              </div>
            </div>
          </div>
          <button
            onClick={() => !sending && onClose()}
            disabled={sending}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* What they'll see */}
          <section>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              What they&apos;ll see
            </div>
            <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <div className="text-[11px] text-gray-600">
                <span className="font-semibold text-gray-900">Their match:</span>{" "}
                an anonymous user reaching out about their{" "}
                <span className="font-semibold">{match.theirs.kind}</span>{" "}
                component &mdash;
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
                <div className="text-[12px] font-semibold text-gray-900">
                  {match.theirs.label_public}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
                  {match.theirs.description_public}
                </p>
              </div>
              <div className="text-[11px] text-gray-600">
                <span className="font-semibold text-gray-900">Your offer:</span>{" "}
                they&apos;ll see your matching component &mdash;
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5">
                <div className="text-[12px] font-semibold text-gray-900">
                  {match.mine.label_public}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
                  {match.mine.description_public}
                </p>
              </div>
            </div>
          </section>

          {/* What stays private */}
          <section className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3 w-3 shrink-0 text-amber-700" />
              <div>
                <span className="font-semibold">What stays private:</span> your
                name, email, board, other components, and any unmatched private
                context. Identity reveals only after they accept.
              </div>
            </div>
          </section>

          {/* Message */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="connect-message"
                className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
              >
                Optional message · {MAX_LEN - message.length} chars left
              </label>
            </div>
            <textarea
              ref={textareaRef}
              id="connect-message"
              value={message}
              onChange={(e) =>
                setMessage(e.target.value.slice(0, MAX_LEN))
              }
              rows={4}
              placeholder="Why this match resonates, what you&apos;d hope to exchange, any quick context that&apos;d help them decide…"
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              maxLength={MAX_LEN}
            />
          </section>

          {/* Additional components — optional, capped at 3 */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                Share additional components · max {MAX_ADDITIONAL}
              </span>
              {additionalSelected.size > 0 && (
                <span className="font-mono text-[10px] text-blue-600">
                  {additionalSelected.size}/{MAX_ADDITIONAL} selected
                </span>
              )}
            </div>
            {loadingOwn ? (
              <div className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading your
                components…
              </div>
            ) : ownComponents.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-[11px] italic text-gray-500">
                You have no other matchable components to share.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {ownComponents.map((c) => {
                  const selected = additionalSelected.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggleAdditional(c.id)}
                        className={[
                          "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition",
                          selected
                            ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200"
                            : "border-gray-200 bg-white hover:border-blue-300",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                            selected
                              ? "border-blue-500 bg-blue-500 text-white"
                              : "border-gray-300 bg-white",
                          ].join(" ")}
                        >
                          {selected && (
                            <svg
                              viewBox="0 0 12 12"
                              className="h-2.5 w-2.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-md bg-gray-100 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
                              {c.kind}
                            </span>
                            <span className="text-[12px] font-semibold text-gray-900">
                              {c.label_public}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-600">
                            {c.description_public}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t border-gray-200/60 px-6 py-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.85) 50%)",
          }}
        >
          <button
            onClick={() => !sending && onClose()}
            disabled={sending}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            ) : (
              <Send className="h-3 w-3" strokeWidth={1.5} />
            )}
            {sending ? "Sending…" : "Send request"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
