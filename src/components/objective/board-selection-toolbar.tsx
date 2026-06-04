"use client";

// ── BoardSelectionToolbar ──
//
// The contextual action that floats just above a multi-card selection on
// the objective board. Deliberately surfaces ONE primary verb at a time
// (the "one verb at a time" principle): exactly two cards → Connect;
// three or more → Synthesize. Presentational only — the parent
// (BoardOverlay in whiteboard-base) owns the selection math + the LLM
// call and passes screen coordinates + handlers in.

import { useState, type CSSProperties } from "react";
import {
  Loader2,
  GitMerge,
  Check,
  BookmarkPlus,
  Globe,
  Wand2,
  AppWindow,
  Pencil,
  Send,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";

export function BoardSelectionToolbar({
  x,
  y,
  count,
  busy,
  onRun,
  onSaveToLibrary,
  saved,
  deepCount = 0,
  deepBusy = false,
  onDeepRun,
  onSpec,
  specBusy = false,
  onPrototype,
  prototypeBusy = false,
  onCustom,
  customBusy = false,
}: {
  /** Screen-space top-center of the selection (px from viewport origin). */
  x: number;
  y: number;
  count: number;
  busy: boolean;
  /** Fires the AI action appropriate to the current count. Present only
   *  when ≥2 cards are selected (Connect/Synthesize need a pair+). */
  onRun?: () => void;
  /** Save the selected cards to the Library as objects. Present whenever
   *  ≥1 selected card is library-saveable. */
  onSaveToLibrary?: () => void;
  /** Brief confirmation state after a successful save. */
  saved?: boolean;
  /** Count of "idea" shapes (post-its + text + cards) in the selection —
   *  the broader set Deep Synthesize reads, vs. the card-only `count`. */
  deepCount?: number;
  /** Deep Synthesize (pro Claude + web search) is running. */
  deepBusy?: boolean;
  /** Fires Deep Synthesize. Present only when ≥2 idea shapes are selected. */
  onDeepRun?: () => void;
  /** Forge a full spec from the whole selection (synthesize → SpecForge). */
  onSpec?: () => void;
  specBusy?: boolean;
  /** Forge -> tech-spec -> auto-build a prototype from the whole selection. */
  onPrototype?: () => void;
  prototypeBusy?: boolean;
  /** Run the user's own instruction over the selection. */
  onCustom?: (prompt: string) => void;
  customBusy?: boolean;
}) {
  const isConnect = count === 2;
  const label = isConnect ? "Connect" : "Synthesize";
  const Icon = isConnect ? GitMerge : Sparkle;
  const hint = isConnect ? "name the relationship" : `weave ${count} together`;
  // Any AI action running locks the buttons; each shows its own spinner.
  const anyBusy = busy || deepBusy || specBusy || prototypeBusy || customBusy;

  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  function submitCustom() {
    const v = customText.trim();
    if (!v || !onCustom) return;
    onCustom(v);
    setCustomText("");
    setCustomOpen(false);
  }

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: Math.max(8, y - 56),
        transform: "translateX(-50%)",
        zIndex: 70,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* Primary verb — the existing "one verb at a time" AI action. */}
      {onRun && (
        <button
          type="button"
          onClick={onRun}
          disabled={anyBusy}
          title={`${label} — ${hint}`}
          className="flex items-center gap-2 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={{
            background: appleVibe.accent.primary,
            border: `1px solid ${appleVibe.accent.primary}`,
            color: appleVibe.text.onAccent,
            padding: "9px 15px",
            fontSize: 12.5,
            fontWeight: 650,
            letterSpacing: "0.01em",
            cursor: anyBusy ? "wait" : "pointer",
            opacity: busy ? 0.85 : deepBusy ? 0.55 : 1,
            boxShadow:
              "0 16px 40px -12px rgba(71,85,105,0.45), 0 4px 12px -2px rgba(11,18,40,0.14)",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          ) : (
            <Icon className="h-4 w-4" strokeWidth={2.4} />
          )}
          {busy ? "Thinking…" : label}
          <span
            style={{
              marginLeft: 2,
              display: "inline-grid",
              placeItems: "center",
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.22)",
              fontSize: 10.5,
              fontWeight: 700,
            }}
          >
            {count}
          </span>
        </button>
      )}

      {/* Pro-Claude deep synthesis — reads the WHOLE selection (post-its +
          text + cards), searches the web, and forks a map of cross-linked
          insights. Quiet glass styling so the heavier, opt-in action reads as
          secondary to the instant Connect/Synthesize verb. */}
      {onDeepRun && (
        <button
          type="button"
          onClick={onDeepRun}
          disabled={anyBusy}
          title="Deep Synthesize — pro Claude reads your selection + searches the web, then forks a map of cross-linked insights"
          className="flex items-center gap-2 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={{
            background: "rgba(255,255,255,0.94)",
            border: `1px solid ${appleVibe.accent.primary}55`,
            color: appleVibe.accent.primary,
            padding: "9px 15px",
            fontSize: 12.5,
            fontWeight: 650,
            letterSpacing: "0.01em",
            cursor: anyBusy ? "wait" : "pointer",
            opacity: busy ? 0.55 : 1,
            backdropFilter: "blur(8px)",
            boxShadow:
              "0 10px 30px -12px rgba(71,85,105,0.40), 0 3px 10px -2px rgba(11,18,40,0.12)",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {deepBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          ) : (
            <Globe className="h-4 w-4" strokeWidth={2.4} />
          )}
          {deepBusy ? "Researching…" : "Deep Synthesize"}
          {!deepBusy && deepCount > 0 && (
            <span
              style={{
                marginLeft: 2,
                display: "inline-grid",
                placeItems: "center",
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 999,
                background: `${appleVibe.accent.primary}1A`,
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {deepCount}
            </span>
          )}
        </button>
      )}

      {/* Forge a full spec from the WHOLE selection (synthesize → SpecForge). */}
      {onSpec && (
        <button
          type="button"
          onClick={onSpec}
          disabled={anyBusy}
          title="Forge a full spec from this selection"
          className="flex items-center gap-2 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={quietGlass}
        >
          {specBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <Wand2 className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          {specBusy ? "Forging…" : "Spec"}
        </button>
      )}

      {/* Forge -> tech-spec -> auto-build a prototype from the WHOLE selection. */}
      {onPrototype && (
        <button
          type="button"
          onClick={onPrototype}
          disabled={anyBusy}
          title="Build a prototype from this selection (forge -> spec -> prototype)"
          className="flex items-center gap-2 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={quietGlass}
        >
          {prototypeBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <AppWindow className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          {prototypeBusy ? "Building..." : "Prototype"}
        </button>
      )}

      {/* Run the user's OWN instruction over the selection. */}
      {onCustom && (
        <button
          type="button"
          onClick={() => setCustomOpen((o) => !o)}
          disabled={anyBusy}
          title="Run your own instruction over this selection"
          className="flex items-center gap-2 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={{
            ...quietGlass,
            ...(customOpen
              ? { background: appleVibe.accent.primary, color: appleVibe.text.onAccent, border: `1px solid ${appleVibe.accent.primary}` }
              : {}),
          }}
        >
          {customBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <Pencil className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          {customBusy ? "Running…" : "Custom"}
        </button>
      )}

      {/* Secondary, quiet action — save the selection to the Library. */}
      {onSaveToLibrary && (
        <button
          type="button"
          onClick={onSaveToLibrary}
          disabled={anyBusy}
          title="Save the selected card(s) to your Library"
          className="flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={{
            background: saved ? "rgba(22,163,74,0.10)" : "rgba(255,255,255,0.94)",
            border: `1px solid ${saved ? "rgba(22,163,74,0.30)" : appleVibe.stroke.soft}`,
            color: saved ? "rgba(22,163,74,0.95)" : appleVibe.text.primary,
            padding: "8px 13px",
            fontSize: 12,
            fontWeight: 600,
            cursor: anyBusy ? "wait" : "pointer",
            backdropFilter: "blur(8px)",
            boxShadow: "0 8px 24px -10px rgba(11,18,40,0.18)",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {saved ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
          ) : (
            <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          {saved ? "Saved" : "Save to Library"}
        </button>
      )}
    </div>

      {/* Inline custom-instruction input (toggled by the Custom button). */}
      {customOpen && (
        <div style={customInputRow}>
          <input
            autoFocus
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCustom();
              if (e.key === "Escape") setCustomOpen(false);
            }}
            placeholder="Tell the AI what to do with these…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 12.5,
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.stack,
            }}
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!customText.trim() || anyBusy}
            title="Run"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "none",
              flexShrink: 0,
              cursor: customText.trim() ? "pointer" : "default",
              background: customText.trim() ? appleVibe.accent.primary : appleVibe.surface.chip,
              color: customText.trim() ? appleVibe.text.onAccent : appleVibe.text.tertiary,
            }}
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => setCustomOpen(false)}
            title="Cancel"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 24,
              height: 24,
              borderRadius: 999,
              border: "none",
              flexShrink: 0,
              cursor: "pointer",
              background: "transparent",
              color: appleVibe.text.tertiary,
            }}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        </div>
      )}
    </div>
  );
}

const quietGlass: CSSProperties = {
  background: "rgba(255,255,255,0.94)",
  border: `1px solid ${appleVibe.stroke.soft}`,
  color: appleVibe.text.primary,
  padding: "8px 13px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  backdropFilter: "blur(8px)",
  boxShadow: "0 8px 24px -10px rgba(11,18,40,0.18)",
  fontFamily: appleVibe.font.stack,
};

const customInputRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 6px 5px 13px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.97)",
  border: `1px solid ${appleVibe.stroke.soft}`,
  boxShadow: "0 12px 32px -12px rgba(11,18,40,0.24)",
  backdropFilter: "blur(10px)",
  minWidth: 340,
  maxWidth: 460,
};
