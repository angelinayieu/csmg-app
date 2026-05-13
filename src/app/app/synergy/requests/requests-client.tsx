// ── Synergy requests inbox — client composition ──
//
// Three tabs (Incoming / Outgoing / History) over the same API
// (listMatchRequests). Each card surfaces the matching components on
// both sides and, for pending/accepted rows, the OTHER party's
// display_name + bio.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCircle,
  Inbox,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  listMatchRequests,
  updateMatchRequest,
  type HydratedMatchRequest,
  type MatchRequestStatus,
} from "@/lib/synergy/match-client";
import { AcceptConfirmationModal } from "@/components/synergy/accept-confirmation-modal";

type TabKey = "incoming" | "outgoing" | "connected" | "history";

const TAB_LABEL: Record<TabKey, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  connected: "Connected",
  history: "History",
};

export function SynergyRequestsClient() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("incoming");
  const [requests, setRequests] = useState<HydratedMatchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Accept confirmation modal (Surface D) — opened by clicking Accept
  // on an incoming pending row. Pre-fetches sender profile via
  // /accept-preview; commits accept on confirm.
  const [acceptTargetId, setAcceptTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "incoming") {
        const list = await listMatchRequests("incoming", "pending");
        setRequests(list);
      } else if (tab === "outgoing") {
        const list = await listMatchRequests("outgoing", "pending");
        setRequests(list);
      } else if (tab === "connected") {
        // Accepted rows from both directions
        const [inc, out] = await Promise.all([
          listMatchRequests("incoming", "accepted"),
          listMatchRequests("outgoing", "accepted"),
        ]);
        const combined = [...inc, ...out];
        combined.sort(
          (a, b) =>
            new Date(b.responded_at ?? b.created_at).getTime() -
            new Date(a.responded_at ?? a.created_at).getTime(),
        );
        setRequests(combined);
      } else {
        // History: terminal states (declined / expired / withdrawn)
        const [inc, out] = await Promise.all([
          listMatchRequests("incoming"),
          listMatchRequests("outgoing"),
        ]);
        const combined = [...inc, ...out].filter(
          (r) =>
            r.status === "declined" ||
            r.status === "expired" ||
            r.status === "withdrawn",
        );
        combined.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        );
        setRequests(combined);
      }
    } catch (e) {
      toast.error("Couldn't load requests", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const onAction = async (
    id: string,
    action: "accept" | "decline" | "withdraw",
  ) => {
    if (busyId) return;
    // Accept is special: opens the confirmation modal (Surface D),
    // doesn't commit immediately. The modal handles the PATCH +
    // navigation when the user confirms.
    if (action === "accept") {
      setAcceptTargetId(id);
      return;
    }
    setBusyId(id);
    try {
      const newStatus = await updateMatchRequest(id, action);
      const label = action === "decline" ? "Declined" : "Withdrawn";
      toast.success(label);
      if (tab === "history") {
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)),
        );
      } else {
        setRequests((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (e) {
      toast.error(`${action} failed`, { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const handleAccepted = (roomId: string | null) => {
    setAcceptTargetId(null);
    if (roomId) {
      router.push(`/app/synergy/room/${roomId}`);
    } else {
      // Soft-fail — drop row from incoming, refresh
      load();
    }
  };

  return (
    <div>
      <div className="mb-5 inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {(["incoming", "outgoing", "connected", "history"] as TabKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
              tab === k
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-700 hover:bg-gray-100",
            ].join(" ")}
          >
            {k === "incoming" && <Inbox className="h-3 w-3" />}
            {k === "outgoing" && <Send className="h-3 w-3" />}
            {k === "connected" && <CheckCircle className="h-3 w-3" />}
            {k === "history" && <ArrowLeftRight className="h-3 w-3" />}
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-600" />
          <p className="mt-2 text-sm text-gray-500">Loading…</p>
        </div>
      ) : requests.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              busy={busyId === r.id}
              onAction={onAction}
            />
          ))}
        </ul>
      )}

      {acceptTargetId && (
        <AcceptConfirmationModal
          requestId={acceptTargetId}
          open={!!acceptTargetId}
          onClose={() => setAcceptTargetId(null)}
          onAccepted={handleAccepted}
        />
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: TabKey }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
      {tab === "incoming" && (
        <>
          <Inbox className="mx-auto mb-3 h-6 w-6 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            No incoming requests
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            When someone reaches out about one of your matchable components,
            it&apos;ll appear here. Profile reveals only when you accept.
          </p>
        </>
      )}
      {tab === "outgoing" && (
        <>
          <Send className="mx-auto mb-3 h-6 w-6 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            No outgoing requests yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Browse matches and tap &ldquo;Request connection&rdquo; to send
            one. You can have up to 5 pending at a time.
          </p>
        </>
      )}
      {tab === "connected" && (
        <>
          <CheckCircle className="mx-auto mb-3 h-6 w-6 text-emerald-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            No connections yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Accepted matches will land here with a direct link to the shared
            room.
          </p>
        </>
      )}
      {tab === "history" && (
        <>
          <ArrowLeftRight className="mx-auto mb-3 h-6 w-6 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">
            Nothing in history yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Declined, expired, and withdrawn requests will appear here.
          </p>
        </>
      )}
    </div>
  );
}

// ── Per-request card ──

const STATUS_TONE: Record<MatchRequestStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-amber-100", text: "text-amber-700", label: "pending" },
  accepted: { bg: "bg-emerald-100", text: "text-emerald-700", label: "accepted" },
  declined: { bg: "bg-gray-100", text: "text-gray-700", label: "declined" },
  expired: { bg: "bg-gray-100", text: "text-gray-500", label: "expired" },
  withdrawn: { bg: "bg-gray-100", text: "text-gray-500", label: "withdrawn" },
};

function RequestCard({
  request,
  busy,
  onAction,
}: {
  request: HydratedMatchRequest;
  busy: boolean;
  onAction: (id: string, action: "accept" | "decline" | "withdraw") => void;
}) {
  const tone = STATUS_TONE[request.status];
  const isPending = request.status === "pending";
  const isAccepted = request.status === "accepted";
  const expiresIn = relativeFuture(request.expires_at);

  return (
    <li className="group rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-md">
      {/* Top row: direction, status, time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider",
              request.direction === "incoming"
                ? "bg-blue-100 text-blue-700"
                : "bg-purple-100 text-purple-700",
            ].join(" ")}
          >
            {request.direction === "incoming" ? (
              <Inbox className="h-3 w-3" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {request.direction}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone.bg} ${tone.text}`}
          >
            {tone.label}
          </span>
          {isAccepted && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-100 to-cyan-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-blue-700">
              <Sparkles className="h-3 w-3" /> revealed
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
          {relativePast(request.created_at)}
        </span>
      </div>

      {/* Profile (revealed for pending-outgoing + accepted only) */}
      {request.other_party ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-200 to-cyan-200 text-blue-800">
            <UserCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-gray-900">
              {request.other_party.display_name}
            </div>
            {request.other_party.bio && (
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-700">
                {request.other_party.bio}
              </p>
            )}
          </div>
        </div>
      ) : (
        // Incoming pending: profile is INTENTIONALLY hidden until the
        // accept moment. Surface the anonymity guarantee explicitly so
        // the user understands the project-not-person framing.
        request.direction === "incoming" &&
        request.status === "pending" && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <UserCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-amber-900">
              <span className="font-semibold">Anonymous sender.</span> Decide on
              the project below — their display name + bio reveal at the moment
              you tap Accept.
            </div>
          </div>
        )
      )}

      {/* Match context (rationale + scores from the original match row) */}
      {request.match && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-blue-700">
            <Sparkles className="h-3 w-3" /> Why matched
          </div>
          <p className="text-[12px] leading-relaxed text-gray-800">
            {request.match.rationale}
          </p>
          <div className="mt-2 flex items-center gap-1">
            <ScorePill label="final" value={Math.round(request.match.final_score)} tone="blue" />
            <ScorePill
              label="comp"
              value={Math.round(request.match.complementarity_score)}
              tone="emerald"
            />
            <ScorePill
              label="goal"
              value={Math.round(request.match.goal_alignment_score)}
              tone="purple"
            />
          </div>
        </div>
      )}

      {/* Additional components, if sender shared any */}
      {request.additional_components.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
            {request.direction === "incoming" ? "Sender also shared" : "You also shared"}
          </div>
          <ul className="space-y-1">
            {request.additional_components.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-2 py-1"
              >
                <span className="mt-0.5 rounded-md bg-gray-100 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
                  {c.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-gray-900">
                    {c.label_public}
                  </div>
                  <p className="line-clamp-2 text-[10.5px] leading-snug text-gray-600">
                    {c.description_public}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Components on both sides */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr]">
        <CompSide
          title={request.direction === "incoming" ? "THEIR OFFER" : "YOUR OFFER"}
          comp={
            request.direction === "incoming"
              ? request.their_component
              : request.my_component
          }
          tone="emerald"
        />
        <div className="hidden items-center justify-center md:flex">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-cyan-100">
            <ArrowRight className="h-4 w-4 text-blue-600" />
          </div>
        </div>
        <CompSide
          title={request.direction === "incoming" ? "YOUR ASK" : "THEIR ASK"}
          comp={
            request.direction === "incoming"
              ? request.my_component
              : request.their_component
          }
          tone="blue"
        />
      </div>

      {/* Message */}
      {request.message && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
          <p className="text-[12px] leading-relaxed text-gray-700">
            {request.message}
          </p>
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isPending && request.direction === "incoming" && (
          <>
            <button
              onClick={() => onAction(request.id, "accept")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Accept
            </button>
            <button
              onClick={() => onAction(request.id, "decline")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
            >
              <X className="h-3 w-3" /> Decline
            </button>
          </>
        )}
        {isPending && request.direction === "outgoing" && (
          <button
            onClick={() => onAction(request.id, "withdraw")}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
            Withdraw
          </button>
        )}
        {isAccepted && (
          <Link
            href={`/app/synergy/room/by-request/${request.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
          >
            <Sparkles className="h-3 w-3" /> Open shared room
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
        {isPending && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-gray-500">
            expires {expiresIn}
          </span>
        )}
      </div>
    </li>
  );
}

function ScorePill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "emerald" | "purple";
}) {
  const toneClass = {
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    purple: "bg-purple-100 text-purple-700",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${toneClass}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </span>
  );
}

function CompSide({
  title,
  comp,
  tone,
}: {
  title: string;
  comp: { kind: string; label_public: string; description_public: string } | null;
  tone: "blue" | "emerald";
}) {
  const tint =
    tone === "blue"
      ? "border-blue-200 bg-blue-50/40"
      : "border-emerald-200 bg-emerald-50/40";
  return (
    <div className={`rounded-xl border ${tint} p-3`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-600">
          {title}
        </span>
        {comp && (
          <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
            {comp.kind}
          </span>
        )}
      </div>
      {comp ? (
        <>
          <div className="text-[13px] font-semibold text-gray-900">
            {comp.label_public}
          </div>
          <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-gray-700">
            {comp.description_public}
          </p>
        </>
      ) : (
        <div className="text-[11px] italic text-gray-500">
          Component deleted
        </div>
      )}
    </div>
  );
}

function relativePast(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function relativeFuture(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "expired";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}
