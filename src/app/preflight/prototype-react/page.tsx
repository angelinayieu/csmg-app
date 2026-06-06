// Preflight: render a T2 Sandpack-backed prototype with a hardcoded sample
// "Opus output." No auth, no LLM call — just proves the runtime stack
// resolves and the boot files merge correctly.

"use client";

import { Sandpack } from "@codesandbox/sandpack-react";
import {
  buildSandpackFiles,
  T2_DEPENDENCIES,
} from "@/lib/objective-canvas/tech-spec/sandpack-template";

// Sample multi-file React from the Opus prompt's expected output shape.
// Mirrors what claude-artifact-runner expects: Tailwind classes, Lucide
// icons, light shadcn-flavored composition.
const SAMPLE_FILES: Record<string, string> = {
  "/App.tsx": `import React, { useState } from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import { cn } from "./lib/cn";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="min-h-full bg-[#fafafa] p-8 font-sans text-[#0F172A]">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200/60 shadow-[0_12px_32px_-16px_rgba(11,18,40,0.18)] p-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-amber-600" />
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            T2 preflight
          </span>
        </div>
        <h1 className="text-2xl font-semibold mb-2">Real React in a tldraw shape</h1>
        <p className="text-sm text-slate-600 mb-5">
          Sandpack bundles this in its own iframe. Tailwind via JIT CDN. State
          is real — click the button.
        </p>
        <button
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium",
            "bg-slate-900 text-white hover:bg-slate-800 transition-colors",
          )}
          onClick={() => setCount((c) => c + 1)}
        >
          Clicked {count} times <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
`,
};

export default function PreflightPrototypeReact() {
  const files = buildSandpackFiles(SAMPLE_FILES);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Preflight — T2 prototype (Sandpack)</h1>
      <p style={{ color: "#64748B" }}>
        Hardcoded sample React. If you see "Clicked N times" and the button
        increments, the full T2 stack works: boot files merge, Sandpack
        bundles, Tailwind JIT runs, Lucide imports resolve, cn() helper works.
      </p>
      <div
        style={{
          height: 560,
          marginTop: 16,
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 20,
          overflow: "hidden",
        }}
      >
        <Sandpack
          template="react-ts"
          files={files}
          customSetup={{ dependencies: T2_DEPENDENCIES, entry: "/App.tsx" }}
          options={{
            showNavigator: false,
            showTabs: false,
            showLineNumbers: false,
            showInlineErrors: true,
            editorHeight: "100%",
            editorWidthPercentage: 0,
          }}
          theme="light"
        />
      </div>

      <h2 style={{ marginTop: 24 }}>Boot files (owned by template; not LLM)</h2>
      <ul>
        <li>
          <code>/index.html</code> — boots React + Tailwind play CDN
        </li>
        <li>
          <code>/index.tsx</code> — React 18 createRoot
        </li>
        <li>
          <code>/lib/cn.ts</code> — clsx + tailwind-merge wrapper
        </li>
      </ul>

      <h2>Preloaded deps</h2>
      <ul>
        {Object.entries(T2_DEPENDENCIES).map(([k, v]) => (
          <li key={k}>
            <code>
              {k}@{v}
            </code>
          </li>
        ))}
      </ul>
    </main>
  );
}
