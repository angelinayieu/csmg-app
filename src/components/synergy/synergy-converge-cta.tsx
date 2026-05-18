"use client";

// ── SynergyConvergeCTA (Wave 3.4) ─────────────────────────────────
//
// The "Build prototype →" action moment after the speedrun lands.
// Anchored at the recommended cluster's centroid in CANVAS COORDS
// so it pans + zooms with the cluster the user is being pointed at.
// Renders inside the whiteboard's transformed container alongside
// the cluster overlay.
//
// Visual: emerald gradient pill with a gentle pulse halo. Pulse is
// CSS-driven (no JS animation loop). Respects prefers-reduced-motion.
//
// Click: for v1 just fires a toast — the actual "build prototype"
// handoff (open prototype scaffold, jump to the lab, etc.) is a
// separate future surface. The CTA being present is the cinematic
// payoff; what it leads to evolves.

import { ArrowRight, Hammer } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  /** Canvas-space center coordinates of the recommended cluster's
   *  member bbox. Comes from useConvergeResult.recommendedCentroid. */
  centroid: { x: number; y: number };
  /** Display name of the recommended cluster — shown in the toast
   *  + on hover as a tooltip preview. */
  clusterName: string;
}

export function SynergyConvergeCTA({ centroid, clusterName }: Props) {
  const handleClick = () => {
    // Placeholder action — a real prototype-scaffold handoff lands
    // in a later phase. For now, acknowledge the user's intent.
    toast.success("Coming next", {
      description: `"${clusterName}" prototype scaffold is the next surface.`,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Build a prototype for: ${clusterName}`}
      className="synergy-converge-cta absolute -translate-x-1/2 group inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold text-white shadow-lg transition hover:scale-[1.04]"
      style={{
        // Anchored to the centroid in canvas coords. translate(-50%, _)
        // via the class above centers horizontally; we offset y manually
        // so the CTA floats BELOW the cluster (so it doesn't overlap
        // the cluster name label which sits above the boundary).
        left: centroid.x,
        top: centroid.y + 220,
        background:
          "linear-gradient(180deg, #10b981 0%, #059669 100%)",
        boxShadow:
          "0 0 0 1px rgba(16,185,129,0.4), 0 10px 30px -10px rgba(16,185,129,0.5), inset 0 1px 0 rgba(255,255,255,0.3)",
        // Subtle scale-up entrance — uses the existing keyframe so
        // the CTA "lands" the moment it mounts.
        animation: "synergyNodeEnter 700ms cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <Hammer
        className="h-3.5 w-3.5 transition group-hover:rotate-12"
        strokeWidth={1.75}
      />
      Build prototype
      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      {/* Pulse halo — pure CSS ::after-style ring that scales out +
          fades, gently signaling "click me" without being demanding.
          Honors reduced-motion via globals.css media query. */}
      <span
        aria-hidden
        className="synergy-converge-cta-halo pointer-events-none absolute inset-0 rounded-full"
      />
    </button>
  );
}
