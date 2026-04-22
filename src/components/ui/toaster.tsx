"use client";

// ── Toaster root ────────────────────────────────────────────────────────
//
// Mounted once at the app root. Consumes the global toast store and
// renders a stack in the bottom-right corner. Each toast is a glass
// surface with variant-tinted accent, respects prefers-reduced-motion,
// hover-to-persist, and offers an optional inline action button.

import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { useToasts, toast as toastApi, type Toast, type ToastVariant } from "@/lib/hooks/use-toast";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

const VARIANT_META: Record<ToastVariant, { icon: React.ElementType; accent: string; ring: string; aria: "status" | "alert" }> = {
  success: { icon: CheckCircle2, accent: "text-emerald-600", ring: "ring-emerald-200", aria: "status" },
  error: { icon: AlertCircle, accent: "text-red-600", ring: "ring-red-200", aria: "alert" },
  info: { icon: Info, accent: "text-indigo-600", ring: "ring-indigo-200", aria: "status" },
  warning: { icon: AlertTriangle, accent: "text-amber-600", ring: "ring-amber-200", aria: "status" },
};

export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-label="Notifications"
      className="fixed z-[9999] right-4 bottom-4 flex flex-col gap-2 pointer-events-none max-w-[380px] w-[min(92vw,380px)]"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastRow({ toast: t }: { toast: Toast }) {
  const meta = VARIANT_META[t.variant];
  const Icon = meta.icon;
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const pauseStartRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(t.ttl);

  // Trigger enter animation one tick after mount
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Pause-on-hover dismiss timer
  useEffect(() => {
    if (paused) {
      pauseStartRef.current = Date.now();
      return;
    }
    if (pauseStartRef.current) {
      const elapsed = Date.now() - pauseStartRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      pauseStartRef.current = null;
    }
    const timeout = window.setTimeout(() => toastApi.dismiss(t.id), remainingRef.current);
    return () => window.clearTimeout(timeout);
  }, [paused, t.id]);

  const handleDismiss = () => {
    setVisible(false);
    window.setTimeout(() => toastApi.dismiss(t.id), reducedMotion ? 0 : 180);
  };

  return (
    <div
      role={meta.aria}
      aria-live={meta.aria === "alert" ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={0}
      className={cn(
        "pointer-events-auto rounded-2xl border border-gray-200/70 bg-white/85 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] px-3.5 py-3 ring-1",
        meta.ring,
        !reducedMotion && "transition-all duration-200 ease-out",
        visible
          ? "opacity-100 translate-x-0"
          : reducedMotion
            ? "opacity-0"
            : "opacity-0 translate-x-4",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", meta.accent)} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-gray-900 leading-snug">{t.title}</div>
          {t.description && (
            <div className="text-[11px] text-gray-600 leading-snug mt-0.5">{t.description}</div>
          )}
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                handleDismiss();
              }}
              className={cn(
                "mt-1.5 inline-flex items-center text-[11px] font-semibold transition-colors",
                meta.accent,
                "hover:underline",
              )}
            >
              {t.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          className="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
