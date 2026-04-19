import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Route consolidation redirects ─────────────────────────────────────
  // Preserve existing bookmarks and any stale internal links pointing at
  // routes that have been deleted or renamed. Each entry is a permanent
  // 301 so user browsers + search engines update their references.
  async redirects() {
    return [
      // ── Canvas family (all collapsed into /whiteboard) ─────────────
      { source: "/app/canvas", destination: "/app", permanent: true },
      { source: "/app/space/:id/canvas", destination: "/app/space/:id/whiteboard", permanent: true },
      { source: "/app/space/:id/whiteboard/playground", destination: "/app/space/:id/whiteboard", permanent: true },

      // ── Whiteboard overview → whiteboard (rename) ────────────────
      { source: "/app/space/:id/whiteboard/overview", destination: "/app/space/:id/whiteboard", permanent: true },

      // ── Twin merge: design | live tabs ────────────────────────────
      { source: "/app/space/:id/digital-twin", destination: "/app/space/:id/twin?tab=design", permanent: true },
      { source: "/app/space/:id/operating-twin", destination: "/app/space/:id/twin?tab=live", permanent: true },

      // ── Actions → Interventions (first-class in Sprint 1) ─────────
      { source: "/app/space/:id/actions", destination: "/app/space/:id/interventions", permanent: true },

      // ── Analysis → Inventory (rows-expand replaces accordion view) ─
      { source: "/app/space/:id/analysis", destination: "/app/space/:id/inventory", permanent: true },

      // ── Per-space patterns: just link to the global library ──────
      { source: "/app/space/:id/patterns", destination: "/app/patterns", permanent: true },

      // ── Global renames ────────────────────────────────────────────
      { source: "/app/meta", destination: "/app/bridges", permanent: true },
      // /app/objectives → /app/objectives/inbox  (but NOT /app/space/:id/objectives)
      { source: "/app/objectives", destination: "/app/objectives/inbox", permanent: true },
    ];
  },
};

export default nextConfig;
