"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, Zap, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasBottomDockProps {
  onSubmit: (text: string, files: File[]) => Promise<void> | void;
  loading: boolean;
  placeholder?: string;
}

export function CanvasBottomDock({
  onSubmit,
  loading,
  placeholder = "Type a concept, paste a URL, or drop a file — Decompose to expand into nodes",
}: CanvasBottomDockProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Phase 6.3 / 6.5: pick up a seed from sessionStorage so deep-linking
  // into the canvas (e.g. from the homepage chat expand button) can
  // pre-populate the input. Seed is consumed once.
  useEffect(() => {
    try {
      const seed = window.sessionStorage.getItem("interaxis:canvas:seed");
      if (seed) {
        setText(seed);
        window.sessionStorage.removeItem("interaxis:canvas:seed");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const submit = useCallback(async () => {
    if (!text.trim() && files.length === 0) return;
    await onSubmit(text.trim(), files);
    setText("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }, [text, files, onSubmit]);

  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
  }, []);

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
      <div className="pointer-events-auto flex min-w-[640px] max-w-[840px] flex-col gap-1.5 rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-[0_10px_40px_-10px_rgba(0,0,30,0.18)] backdrop-blur-xl">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {files.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-blue-700"
              >
                {f.name.length > 28 ? f.name.slice(0, 28) + "…" : f.name}
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilePicked}
            accept=".pdf,.txt,.md,.docx,image/*"
          />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="flex-1 border-0 bg-transparent px-1 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
          />
          <button
            onClick={submit}
            disabled={loading || (!text.trim() && files.length === 0)}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12px] font-semibold transition-all",
              loading || (!text.trim() && files.length === 0)
                ? "bg-gray-100 text-gray-400"
                : "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md hover:shadow-lg",
            )}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {loading ? "Decomposing…" : "Decompose"}
          </button>
        </div>
      </div>
    </div>
  );
}
