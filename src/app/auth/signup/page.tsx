// ── /auth/signup ──
//
// See /auth/login — redirect-only stub that forwards to the unified
// AuthModal on the landing page in "signup" mode.

import { redirect } from "next/navigation";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const { next } = (await searchParams) ?? {};
  const safeNext = next && next.startsWith("/") ? next : null;
  const query = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";
  redirect(`/${query}#signup`);
}
