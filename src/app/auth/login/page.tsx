// ── /auth/login ──
//
// We standardized on ONE auth surface: the hash-driven AuthModal that
// floats over the landing page with a translucent backdrop. This route
// exists only as a redirect target for legacy links + middleware bounces;
// it forwards to "/#signin" (preserving any safe `next` param), so the
// user lands on the marketing surface with the same modal on top.

import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const { next } = (await searchParams) ?? {};
  const safeNext = next && next.startsWith("/") ? next : null;
  const query = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";
  redirect(`/${query}#signin`);
}
