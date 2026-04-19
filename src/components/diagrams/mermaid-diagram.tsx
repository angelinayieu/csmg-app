"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MermaidDiagramProps {
  /** Mermaid source string — e.g. "graph LR\nA --> B". */
  source: string;
  /** Optional aria label / caption. */
  ariaLabel?: string;
  /** Additional className applied to the wrapping div. */
  className?: string;
  /** Render height constraint; diagram scales to fit. */
  maxHeight?: number;
}

/**
 * MermaidDiagram — renders a Mermaid source string to SVG inside a
 * styled card. Mermaid itself is dynamically imported so it only
 * loads on pages that actually render a diagram (it's ~1MB gzipped).
 *
 * Error handling: if the source is invalid or render fails, we show a
 * compact error card with a "Copy source" affordance so the user can
 * paste the offending source into mermaid.live and debug.
 */
export function MermaidDiagram({
  source,
  ariaLabel,
  className,
  maxHeight = 420,
}: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!containerRef.current) return;
      setStatus("idle");
      setErrorMsg(null);

      try {
        const mermaid = (await import("mermaid")).default;

        // Initialize once per process; repeat calls are no-ops in
        // mermaid 11, so this is cheap to call on every mount.
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            // Match the Interaxis palette (blues + neutral grays)
            primaryColor: "#eef4ff",
            primaryTextColor: "#0a1020",
            primaryBorderColor: "#0a6aee",
            lineColor: "#556479",
            secondaryColor: "#f8fafc",
            tertiaryColor: "#ffffff",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: "13px",
          },
          flowchart: {
            htmlLabels: true,
            curve: "basis",
            nodeSpacing: 40,
            rankSpacing: 55,
          },
          securityLevel: "strict",
        });

        // A stable but per-instance id avoids duplicate-id errors when
        // multiple diagrams exist on the page.
        const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, source);

        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [source]);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard rejection
    }
  }

  return (
    <div
      className={cn(
        "relative rounded-lg border border-gray-200 bg-white p-3",
        className,
      )}
      aria-label={ariaLabel}
    >
      {status === "idle" && (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Rendering diagram…
        </div>
      )}

      {status === "error" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            Couldn&apos;t render diagram
          </div>
          {errorMsg && (
            <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] leading-snug text-red-700">
              {errorMsg.slice(0, 400)}
            </pre>
          )}
          <button
            onClick={copySource}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy source"}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          "mermaid-container overflow-auto transition-opacity",
          status === "ready" ? "opacity-100" : "opacity-0 h-0",
        )}
        style={{ maxHeight }}
      />

      {/* Floating copy button when rendered successfully */}
      {status === "ready" && (
        <button
          onClick={copySource}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-gray-200 bg-white/80 px-1.5 py-0.5 text-[10px] text-gray-500 backdrop-blur hover:text-gray-800"
          title="Copy Mermaid source"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Source"}
        </button>
      )}
    </div>
  );
}
