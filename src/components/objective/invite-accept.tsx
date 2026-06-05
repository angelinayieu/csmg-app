"use client";

// ── InviteAccept ──────────────────────────────────────────────────
//
// Client half of /invite/[token]. POSTs the accept endpoint on mount and
// reflects the outcome: success → route onto the shared board; expired /
// email-mismatch / not-found → a friendly message. The server page has
// already guaranteed the visitor is signed in.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; spaceId: string }
  | { kind: "error"; message: string };

export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/invite/${token}/accept`, {
          method: "POST",
        });
        const json = (await res.json().catch(() => ({}))) as {
          spaceId?: string;
          error?: string;
        };
        if (res.ok && json.spaceId) {
          setStatus({ kind: "ok", spaceId: json.spaceId });
          // Land on the board shortly after showing the success state.
          setTimeout(
            () => router.replace(`/app/objective/${json.spaceId}`),
            700,
          );
        } else {
          setStatus({
            kind: "error",
            message: json.error ?? `Could not accept invite (${res.status}).`,
          });
        }
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error.",
        });
      }
    })();
  }, [token, router]);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mb-4 text-xl font-bold tracking-tight">akiboe</div>
      {status.kind === "loading" && (
        <>
          <h1 className="text-lg font-semibold text-gray-900">
            Joining the whiteboard…
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Setting up your access.
          </p>
        </>
      )}
      {status.kind === "ok" && (
        <>
          <h1 className="text-lg font-semibold text-green-700">
            You&apos;re in!
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Taking you to the board…
          </p>
        </>
      )}
      {status.kind === "error" && (
        <>
          <h1 className="text-lg font-semibold text-red-700">
            Couldn&apos;t accept this invite
          </h1>
          <p className="mt-2 text-sm text-gray-600">{status.message}</p>
          <button
            type="button"
            onClick={() => router.replace("/app")}
            className="mt-5 inline-flex items-center justify-center rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Go to my boards
          </button>
        </>
      )}
    </div>
  );
}
