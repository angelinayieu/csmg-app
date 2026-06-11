"use client";

// Trove Map route — tldraw is browser-only, so the canvas loads dynamically.

import dynamic from "next/dynamic";

const TroveMap = dynamic(() => import("../_components/trove-map"), {
  ssr: false,
  loading: () => (
    <div className="tr-empty">
      <div className="tr-working">
        <span className="tr-working-dot" /> Unrolling the whiteboard…
      </div>
    </div>
  ),
});

export default function TroveMapPage() {
  return <TroveMap />;
}
