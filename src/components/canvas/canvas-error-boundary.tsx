"use client";

// ── Canvas error boundary ──
//
// The whiteboard mounts tldraw, ~20 custom shape utils, the pipeline
// painter doing live DOM mutation, and several streaming subscribers.
// Any of those can throw on unexpected editor state (e.g., a shape
// with malformed props, a race during ghost cleanup, a bad meta
// field). Today those throws unwind to the nearest React error
// boundary — which for the whiteboard is `/app/space/[id]/error.tsx`,
// a route-level fallback. The user loses the entire space view and
// any unsaved tldraw state in memory (autosave runs every 700ms, but
// the 0-700ms window of unsaved edits is gone).
//
// This component wraps just the canvas mount block. On error it
// shows a recoverable fallback: a card with the error message, a
// "Retry canvas" button that resets the boundary (triggers a fresh
// mount — the Supabase-persisted snapshot reloads), and a "Reload
// page" escape hatch. Most canvas-level throws are transient
// (editor state corruption that a remount clears), so retry fixes
// them without losing the persisted work.
//
// Classed component because React only supports error boundaries on
// classes — there is no hooks-based equivalent. No new dep.

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional hook for reporting errors to a monitoring service. */
  onError?: (error: Error, info: { componentStack?: string | null }) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[canvas] error boundary caught:", error, info);
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    // Reset the boundary state so children remount. tldraw's store
    // rebuilds from the Supabase snapshot via useCanvasPersistence on
    // the next mount, so the user keeps their persisted shapes.
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message ?? "Unknown canvas error";

    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-red-50/40 via-white to-orange-50/40 px-6 py-10 text-center">
        <div className="max-w-[440px] rounded-2xl border border-red-200/70 bg-white/95 px-6 py-5 shadow-lg">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-red-500">
            Canvas crashed
          </div>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-gray-900">
            Something went wrong in the whiteboard
          </h2>
          <p className="mb-1 text-[12.5px] leading-relaxed text-gray-600">
            Your persisted work is safe — the canvas autosaves every second.
            Most errors here are transient; a retry usually restores the view.
          </p>
          <div className="mb-4 max-h-[80px] overflow-auto rounded-md bg-gray-50 px-3 py-2 text-left font-mono text-[10.5px] text-gray-500">
            {message}
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.handleRetry}
              className="rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:-translate-y-px hover:shadow-md transition-all"
            >
              Retry canvas
            </button>
            <button
              onClick={this.handleReload}
              className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
