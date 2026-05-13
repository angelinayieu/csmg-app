// ── /email/unsubscribe — public unsubscribe confirmation ──
//
// Lands here from the footer of any Synergy email. Reads the token
// from ?token=... in the URL, POSTs to /api/synergy/email/unsubscribe,
// and renders a confirmation card. Single page; no nav, no auth.
//
// "Public" route — sits at /email/unsubscribe (NOT under /app),
// inheriting nothing from the /app layout (no auth redirect, no
// chrome). Lives at the root /email/ path so the link works for
// signed-out users.

import Link from "next/link";
import { redeemUnsubscribeToken } from "@/lib/email/tokens";
import { Check, Sparkles, X } from "lucide-react";

const KEY_LABEL: Record<string, string> = {
  new_request: "New connection requests",
  request_accepted: "Request acceptance confirmations",
  weekly_digest: "Weekly digest emails",
  all: "All Synergy emails",
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function UnsubscribePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token || token.length < 10) {
    return (
      <Layout>
        <Card
          tone="error"
          title="Missing unsubscribe token"
          body="This link looks malformed. Check the link in the email or open Synergy and adjust your preferences directly."
        />
      </Layout>
    );
  }

  const result = await redeemUnsubscribeToken(token);

  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "This unsubscribe link has expired. Click the link in your most recent Synergy email, or update preferences in your profile."
        : result.reason === "already_used"
          ? "This link was already used. Your preferences should already reflect that change."
          : "Couldn't find that unsubscribe token. It may have been revoked or the link is malformed.";
    return (
      <Layout>
        <Card tone="error" title="Unable to unsubscribe" body={message} />
      </Layout>
    );
  }

  return (
    <Layout>
      <Card
        tone="success"
        title={
          result.notification_key === "all"
            ? "All Synergy emails turned off"
            : `Unsubscribed: ${KEY_LABEL[result.notification_key] ?? result.notification_key}`
        }
        body={
          result.notification_key === "all"
            ? "We won't send you any more emails. You can turn specific events back on any time from your profile."
            : `You won't receive emails for this event anymore. Other Synergy emails (if any) stay on — adjust each one separately from your profile.`
        }
      />
    </Layout>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-16">
      <div className="mx-auto max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-[12px] text-gray-600 transition hover:text-gray-900"
        >
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          <span className="font-semibold">Synergy</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

function Card({
  tone,
  title,
  body,
}: {
  tone: "success" | "error";
  title: string;
  body: string;
}) {
  const Icon = tone === "success" ? Check : X;
  const ring =
    tone === "success"
      ? "ring-emerald-200 bg-emerald-50/60"
      : "ring-rose-200 bg-rose-50/60";
  const iconColor =
    tone === "success"
      ? "from-emerald-500 to-emerald-600"
      : "from-rose-500 to-rose-600";
  return (
    <div className={`rounded-2xl bg-white p-8 ring-1 ${ring}`}>
      <div
        className={`mx-auto mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${iconColor} text-white shadow-sm`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-700">{body}</p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link
          href="/app/synergy/profile#email"
          className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-blue-600 to-cyan-500 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          Manage email preferences
        </Link>
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400"
        >
          Open Synergy
        </Link>
      </div>
    </div>
  );
}
