"use client";

// ── Minimal toast system ────────────────────────────────────────────────
//
// Imperative API + React store. No external dep. Ring-buffered to max 3
// visible; older toasts fade out when pushed. Auto-dismiss 4s by default
// but hover-to-persist (handled in the Toaster component).
//
// Usage:
//   import { toast } from "@/lib/hooks/use-toast";
//   toast.success("Change approved", { action: { label: "Undo", onClick: undo } });
//   toast.error("Failed to approve");
//   toast.info("Strategy regenerated");
//
// For React subscribers (the Toaster root component):
//   const toasts = useToasts();

import { useEffect, useState } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  createdAt: number;
  ttl: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

type Listener = (toasts: Toast[]) => void;

const MAX_VISIBLE = 3;
const DEFAULT_TTL = 4000;

let current: Toast[] = [];
let listeners: Listener[] = [];
let nextId = 0;

function emit() {
  for (const l of listeners) l(current);
}

function push(t: Omit<Toast, "id" | "createdAt">) {
  const id = `toast-${++nextId}`;
  const toast: Toast = { ...t, id, createdAt: Date.now() };
  current = [toast, ...current].slice(0, MAX_VISIBLE);
  emit();
  // Auto-dismiss
  window.setTimeout(() => dismiss(id), t.ttl);
  return id;
}

function dismiss(id: string) {
  current = current.filter((t) => t.id !== id);
  emit();
}

function clear() {
  current = [];
  emit();
}

export const toast = {
  success: (title: string, opts?: { description?: string; ttl?: number; action?: Toast["action"] }) =>
    push({ variant: "success", title, description: opts?.description, ttl: opts?.ttl ?? DEFAULT_TTL, action: opts?.action }),
  error: (title: string, opts?: { description?: string; ttl?: number; action?: Toast["action"] }) =>
    push({ variant: "error", title, description: opts?.description, ttl: opts?.ttl ?? 6000, action: opts?.action }),
  info: (title: string, opts?: { description?: string; ttl?: number; action?: Toast["action"] }) =>
    push({ variant: "info", title, description: opts?.description, ttl: opts?.ttl ?? DEFAULT_TTL, action: opts?.action }),
  warning: (title: string, opts?: { description?: string; ttl?: number; action?: Toast["action"] }) =>
    push({ variant: "warning", title, description: opts?.description, ttl: opts?.ttl ?? 5000, action: opts?.action }),
  dismiss,
  clear,
};

export function useToasts(): Toast[] {
  const [state, setState] = useState<Toast[]>(current);
  useEffect(() => {
    const l: Listener = (next) => setState([...next]);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return state;
}
