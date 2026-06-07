// ── /auth/signup ──
//
// See /auth/login — redirect-only stub that forwards to the unified
// AuthModal on the landing page in "signup" mode.
//
// If the user arrived from /pricing with `?plan=standard|pro`, fold it into
// `next=` so AuthModal returns them to /app/credits?plan=… post-auth, where
// the page picks the plan up and fires the subscribe checkout. Same pattern
// as next= — never reflect free-text into a redirect.

import { redirect } from "next/navigation";

const ALLOWED_PLANS = new Set(["standard", "pro"]);

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; plan?: string }>;
}) {
  const { next, plan } = (await searchParams) ?? {};
  const safePlan = plan && ALLOWED_PLANS.has(plan) ? plan : null;
  // Plan-driven post-auth landing trumps a generic ?next= (you came here to
  // subscribe — finish that). Falls back to the caller's ?next= otherwise.
  const safeNext = safePlan
    ? `/app/credits?plan=${safePlan}`
    : next && next.startsWith("/")
      ? next
      : null;
  const query = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";
  redirect(`/${query}#signup`);
}
