// ── /invite/[token] ───────────────────────────────────────────────
//
// Board-share landing page. Unauthenticated visitors are bounced to
// /auth/login?next=/invite/[token] (so they return here after signing
// in or creating an account with the invited email). Authenticated
// visitors hit the accept endpoint via the client component, which
// materializes their membership and routes them onto the board.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { InviteAccept } from "@/components/objective/invite-accept";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <InviteAccept token={token} />
    </div>
  );
}
