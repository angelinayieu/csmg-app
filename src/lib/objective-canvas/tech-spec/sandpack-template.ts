// ── sandpack-template — T2 React bootstrap ────────────────────────
//
// The non-LLM files that every T2 prototype boots into. Mirrors what
// claude-artifact-runner preloads so Opus's Artifact-style output renders
// unchanged: React 18 + Tailwind (via the play CDN, the same way Anthropic's
// Artifact runtime works) + Lucide + Recharts + Three.js.
//
// Why CDN Tailwind here vs inlined for T1: Sandpack runs the bundle in its
// OWN iframe at codesandbox.io's bundler origin — our T1 null-origin CSP
// concerns don't apply, and CDN Tailwind gives full JIT class support
// without us shipping the entire utility surface.
//
// Production tradeoff (logged for Step 7 follow-on): Tailwind play CDN has
// a runtime cost (~280KB + scan-on-mount). For published prototypes this
// is fine; for repeated edits it's noticeable. A follow-on would inline a
// minimal pre-baked tailwind.css via PostCSS.

import type { SandpackFiles } from "@codesandbox/sandpack-react";

/** The exact dep set claude-artifact-runner mirrors from Anthropic's Artifact
 *  sandbox. Opus's vendored output drops in unchanged. */
export const T2_DEPENDENCIES: Record<string, string> = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "lucide-react": "^0.469.0",
  clsx: "^2.1.1",
  "tailwind-merge": "^2.5.4",
  recharts: "^2.13.3",
  three: "^0.170.0",
  "@react-three/fiber": "^8.17.10",
  "@react-three/drei": "^9.117.3",
};

/** index.html — boots React, loads Tailwind play CDN, sets the body
 *  background to the brand surface. Stable across all T2 prototypes. */
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Prototype</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body { background: #fafafa; font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; color: #0F172A; }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/** index.tsx — React 18 root that mounts App. Hidden from the model. */
const INDEX_TSX = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(<React.StrictMode><App /></React.StrictMode>);
`;

/** A friendly placeholder App, shown before the LLM has emitted anything
 *  (e.g. during the loading window). Not used at steady-state. */
const PLACEHOLDER_APP = `export default function App() {
  return (
    <div className="flex items-center justify-center h-full text-slate-400">
      Generating…
    </div>
  );
}
`;

/** A tiny utility module the model can lean on without inventing one. */
const LIB_CN = `import clsx from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...args: any[]) { return twMerge(clsx(args)); }
`;

/** The boot files merged with whatever Opus emitted. We always own
 *  index.html / index.tsx / lib/cn.ts — the model can't override them
 *  (their keys are stripped from llmFiles before merge). */
export function buildSandpackFiles(llmFiles: Record<string, string>): SandpackFiles {
  const RESERVED = new Set(["/index.html", "/index.tsx", "/lib/cn.ts"]);
  const safe: Record<string, string> = {};
  for (const [path, contents] of Object.entries(llmFiles)) {
    if (RESERVED.has(path)) continue;
    safe[path] = contents;
  }
  if (!safe["/App.tsx"]) safe["/App.tsx"] = PLACEHOLDER_APP;
  return {
    "/index.html": INDEX_HTML,
    "/index.tsx": INDEX_TSX,
    "/lib/cn.ts": LIB_CN,
    ...safe,
  };
}

/** The set of import specifiers the sanitizer accepts. Anything else is
 *  rejected. Composed from the dependency manifest above + relative paths. */
export const T2_IMPORT_ALLOWLIST = new Set<string>([
  ...Object.keys(T2_DEPENDENCIES),
  // sub-paths of allowed deps
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom",
  "lucide-react",
  // internal utility we own
  "./lib/cn",
  "@/lib/cn",
]);
