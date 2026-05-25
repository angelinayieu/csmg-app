// ── /app/objective/new ──
//
// Legacy route — kept for back-compat with any links that still
// point here (the prior version of the flow used this as a
// dedicated entry route). State-based landing-experience now
// owns the entry card, so we just redirect with a stage hint.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ObjectiveCanvasNewRedirect() {
  redirect("/app/objective?stage=entry");
}
