"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import type { Space, Entity, Edge } from "@/types";

const InteraxisCanvas = dynamic(
  () => import("@/components/canvas/interaxis-canvas").then((m) => m.InteraxisCanvas),
  { ssr: false },
);

export interface UniversalCanvasClientProps {
  targetSpace: Space;
  spaces: Space[];
  entities: Entity[];
  edges: Edge[];
  seed: string | null;
}

// Thin wrapper that mounts InteraxisCanvas with cross-space data +
// universal chrome. The `targetSpace` is the one materialize writes to
// (user's most-recently-updated space). All entities + edges are pooled
// across every space so the canvas shows the user's whole knowledge
// graph.
export function UniversalCanvasClient({
  targetSpace,
  spaces,
  entities,
  edges,
  seed,
}: UniversalCanvasClientProps) {
  // Rewrite the target space's displayed name to "Universal" while keeping
  // its real id so the existing space-scoped APIs work. A future phase can
  // add a first-class user-scoped endpoint.
  const universalSpace: Space = {
    ...targetSpace,
    name: "Universal Canvas",
    description: `Cross-space canvas across ${spaces.length} spaces · materializes into "${targetSpace.name}"`,
  };

  // If a seed was provided via ?seed=, prime it into sessionStorage so the
  // bottom dock picks it up on mount. We use sessionStorage (not a prop)
  // because InteraxisCanvas is dynamically imported and doesn't accept a
  // seed prop today — Phase 6.5 will formalize this.
  const [seedApplied, setSeedApplied] = useState(false);
  useEffect(() => {
    if (!seed || seedApplied) return;
    try {
      window.sessionStorage.setItem("interaxis:canvas:seed", seed);
      setSeedApplied(true);
    } catch {
      /* ignore */
    }
  }, [seed, seedApplied]);

  return (
    <div className="relative h-full w-full">
      {/* Universal chrome: back link + cross-space badge */}
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200/70 bg-white/85 px-3 py-1.5 shadow-sm backdrop-blur-md">
          <Link
            href="/app"
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="Back to dashboard"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <div className="h-3 w-px bg-gray-200" />
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700">
            <Layers className="h-3 w-3 text-blue-500" />
            Universal
          </div>
          <div className="text-[10px] font-medium text-gray-400">
            {entities.length} entities · {spaces.length} spaces
          </div>
        </div>
      </div>

      <InteraxisCanvas
        space={universalSpace}
        entities={entities}
        edges={edges}
        libraryspaceNames={
          new Map(spaces.map((s) => [s.id, s.name]))
        }
      />
    </div>
  );
}
