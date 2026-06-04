import { getAuthUser, createClient } from "@/lib/supabase/server";
import { PricingClient } from "./pricing-client";

export const metadata = {
  title: "Pricing — Intersice",
  description:
    "Plans that refill every week. One round is a single diverge → converge loop on the canvas.",
};

// Public marketing route (sits on the root layout, NOT the authed /app
// layout) so logged-out visitors can see it. We still try to read the
// signed-in user so the page can highlight their current plan and swap
// the CTAs to a logged-in flow — but any auth/db hiccup falls back to
// the logged-out view rather than erroring a public page.
export default async function PricingPage() {
  let isLoggedIn = false;
  let currentTier: string | null = null;
  try {
    const user = await getAuthUser();
    if (user) {
      isLoggedIn = true;
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select("tier")
        .eq("id", user.id)
        .single();
      currentTier = (data as { tier?: string | null } | null)?.tier ?? null;
    }
  } catch {
    // Public page — render the logged-out view on any failure.
  }

  return <PricingClient isLoggedIn={isLoggedIn} currentPlan={currentTier} />;
}
