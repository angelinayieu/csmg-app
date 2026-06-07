"use client";

// ── PrototypeCardShape ──
//
// The interactive Claude prototype on the board: a self-contained HTML/CSS+JS
// UI (sanitize-html-T1 sanitized server-side) rendered LIVE in a T1
// sandboxed iframe (sandbox="allow-scripts allow-forms allow-modals
// allow-popups"). Still NULL ORIGIN because allow-same-origin is OMITTED —
// can't read parent cookies, can't fetch APIs (CSP also forbids it), can't
// unset its own sandbox. The extra flags unlock the patterns Opus reaches
// for by default — form submits, alert/confirm/prompt, target=_blank links
// — so the prototype actually behaves like a real product surface instead
// of dying silently on the first alert(). Inline scripts are PERMITTED
// for real interactivity; external resources blocked at three layers:
// sanitizer + sandbox + injected CSP meta.
// Built from a TechSpec via "Build prototype", then iterated in place
// through the feedback box (PROTOTYPE_REFINE_EVENT → refine route). The
// header is the drag handle; the iframe + feedback box stop propagation so
// they're interactive without fighting tldraw.

import { useMemo, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  useEditor,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  Loader2,
  Wand2,
  AlertCircle,
  SendHorizontal,
  LayoutGrid,
  Minimize2,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { TasteReceipt } from "@/components/objective/canvas-interactions/taste-receipt";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

export const PROTOTYPE_REFINE_EVENT = "objective-board:prototype-refine";

export interface PrototypeRefineDetail {
  shapeId: string;
  feedback: string;
}

export type PrototypeCardShape = TLBaseShape<
  "prototype-card",
  {
    w: number;
    h: number;
    title: string;
    /** Sanitized, self-contained HTML rendered in the iframe. */
    html: string;
    status: "generating" | "ready" | "error";
    /** Bumps each time the feedback loop regenerates. */
    version: number;
    /** Stringified TechSpec — context the refine route grounds against. */
    specJson: string;
    /** When true, render a horizontal row of mini-iframes (one per spec
     *  screen) instead of the single full-size iframe. */
    screensExpanded: boolean;
    /** Snapshot of w/h at expand time, restored on collapse. */
    prevW: number;
    prevH: number;
  }
>;

export class PrototypeCardShapeUtil extends BaseBoxShapeUtil<PrototypeCardShape> {
  static override type = "prototype-card" as const;
  static override props: RecordProps<PrototypeCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    html: T.string,
    status: T.literalEnum("generating", "ready", "error"),
    version: T.number,
    specJson: T.string,
    screensExpanded: T.boolean,
    prevW: T.number,
    prevH: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: PrototypeCardShape, info: TLResizeInfo<PrototypeCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): PrototypeCardShape["props"] {
    return {
      w: 420,
      h: 540,
      title: "Prototype",
      html: "",
      status: "generating",
      version: 0,
      specJson: "",
      screensExpanded: false,
      prevW: 0,
      prevH: 0,
    };
  }

  component(shape: PrototypeCardShape) {
    return <PrototypeCardRenderer shape={shape} />;
  }

  indicator(shape: PrototypeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

// ── Multi-screen expansion ───────────────────────────────────────
//
// The prototype HTML is a single self-contained document with its OWN
// navigation. We don't know whether it uses hash routing, JS state, or
// data-attrs — so when the user clicks "View screens" we render N
// copies of the iframe, each with a small BOOTSTRAP SCRIPT spliced in
// just before </body>. The script runs after the prototype's own JS
// boots, then tries several universal strategies in order to navigate
// to the target screen — succeeds for hash-routed, data-routed, and
// text-labeled-button apps without the prototype knowing about us.

const MINI_W = 280; // each mini-iframe column width when expanded
const MINI_GAP = 12;
const SIDE_PAD = 12;

/** Splice a bootstrap nav script just before </body>. Pure string op; no
 *  re-sanitize needed (the sanitizer ran server-side on the original; the
 *  injected script is a known constant string we author). The script tries:
 *    (1) a `window.__navigateTo` hook (best — opt-in from generated code)
 *    (2) location.hash = name (works for hash-routed prototypes)
 *    (3) click an element matching [data-screen=name] / [data-route=name]
 *        / [data-tab=name] / [href="#name"] — works for declarative routes
 *    (4) click the first <button>/<a>/<[role=tab]> whose visible text
 *        equals the screen name (case-insensitive) — works for the
 *        common "tab bar" UI patterns the model spits out
 *  All steps soft-fail; a prototype that can't find the screen just shows
 *  its default route. */
function injectScreenNavigator(html: string, screenName: string): string {
  // JSON-encode to safely embed inside a <script> string literal.
  const target = JSON.stringify(screenName);
  const boot = `<script>(function(){
  function go(){
    var name=${target};
    try{ if(typeof window.__navigateTo==="function"){ window.__navigateTo(name); return; } }catch(e){}
    try{
      var slugA=name.toLowerCase().replace(/\\s+/g,"-").replace(/[^a-z0-9-]/g,"");
      var slugB=name.toLowerCase().replace(/\\s+/g,"");
      location.hash=slugA;
    }catch(e){}
    try{
      var sel=[
        '[data-screen='+JSON.stringify(name)+']',
        '[data-route='+JSON.stringify(name)+']',
        '[data-tab='+JSON.stringify(name)+']',
        '[data-view='+JSON.stringify(name)+']'
      ];
      for(var i=0;i<sel.length;i++){
        var el=document.querySelector(sel[i]);
        if(el && typeof el.click==="function"){ el.click(); return; }
      }
    }catch(e){}
    try{
      var nodes=document.querySelectorAll('button, a, [role=tab], [role=menuitem]');
      var want=name.trim().toLowerCase();
      for(var j=0;j<nodes.length;j++){
        var t=(nodes[j].textContent||"").trim().toLowerCase();
        if(t===want || t.indexOf(want)===0){
          try{ nodes[j].click(); return; }catch(e){}
        }
      }
    }catch(e){}
  }
  if(document.readyState==="complete"||document.readyState==="interactive"){
    setTimeout(go,40);
  } else {
    window.addEventListener("DOMContentLoaded", function(){ setTimeout(go,40); });
  }
})();</script>`;
  // Splice before </body> if present, else append.
  const idx = html.search(/<\/body\s*>/i);
  if (idx >= 0) return html.slice(0, idx) + boot + html.slice(idx);
  return html + boot;
}

/** Pull screen list from the persisted spec. Soft-fail to []. */
function readScreens(specJson: string): { name: string; purpose: string }[] {
  if (!specJson) return [];
  try {
    const spec = JSON.parse(specJson) as TechSpec;
    const screens = spec?.ui_plan?.screens;
    if (!Array.isArray(screens)) return [];
    return screens
      .filter((s) => s && typeof s.name === "string" && s.name.trim())
      .map((s) => ({
        name: s.name.trim(),
        purpose: typeof s.purpose === "string" ? s.purpose : "",
      }));
  } catch {
    return [];
  }
}

function PrototypeCardRenderer({ shape }: { shape: PrototypeCardShape }) {
  const { title, html, status, version, specJson, screensExpanded, prevW, prevH } =
    shape.props;
  const accent = appleVibe.accent.primary;
  const editor = useEditor();
  const [feedback, setFeedback] = useState("");
  const screens = useMemo(() => readScreens(specJson), [specJson]);
  const canExpand = status === "ready" && !!html && screens.length >= 2;

  function toggleScreens(e: React.MouseEvent) {
    e.stopPropagation();
    if (!canExpand && !screensExpanded) return;
    if (!screensExpanded) {
      // Expand: grow the shape to fit N mini-iframes + remember w/h.
      const next = Math.min(screens.length, 5);
      const targetW =
        next * MINI_W + (next - 1) * MINI_GAP + SIDE_PAD * 2;
      editor.updateShape<PrototypeCardShape>({
        id: shape.id,
        type: "prototype-card",
        props: {
          screensExpanded: true,
          prevW: shape.props.w,
          prevH: shape.props.h,
          w: targetW,
          h: Math.max(shape.props.h, 480),
        },
      });
    } else {
      // Collapse: restore w/h if we have a snapshot.
      editor.updateShape<PrototypeCardShape>({
        id: shape.id,
        type: "prototype-card",
        props: {
          screensExpanded: false,
          w: prevW > 0 ? prevW : 420,
          h: prevH > 0 ? prevH : 540,
        },
      });
    }
  }

  function sendFeedback() {
    const text = feedback.trim();
    if (!text || status === "generating") return;
    setFeedback("");
    window.dispatchEvent(
      new CustomEvent<PrototypeRefineDetail>(PROTOTYPE_REFINE_EVENT, {
        detail: { shapeId: shape.id, feedback: text },
      }),
    );
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow:
            "0 1px 2px rgba(11,18,40,0.04), 0 14px 38px -22px rgba(11,18,40,0.18)",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header — minimal: just the title + version. The iframe IS the
            prototype; subtitle labels are noise. Drag handle. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <Wand2 style={{ width: 12, height: 12, color: appleVibe.text.tertiary }} strokeWidth={2} />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: appleVibe.text.primary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              letterSpacing: -0.1,
            }}
          >
            {title}
          </span>
          {version > 0 && status === "ready" && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 500,
                color: appleVibe.text.faint,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              v{version}
            </span>
          )}

          {/* View screens toggle — only when the prototype is ready AND
              the spec has ≥2 screens. Sits at the far right of the header.
              stopEventPropagation on pointerdown so tldraw doesn't start a
              drag from the click. */}
          {(canExpand || screensExpanded) && (
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={toggleScreens}
              title={
                screensExpanded
                  ? "Collapse back to one view"
                  : `Expand all ${Math.min(screens.length, 5)} screens side-by-side`
              }
              style={{
                marginLeft: version > 0 && status === "ready" ? 6 : "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px",
                borderRadius: 999,
                border: `1px solid ${appleVibe.stroke.soft}`,
                background: screensExpanded ? accent : "#fff",
                color: screensExpanded ? "white" : appleVibe.text.secondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: appleVibe.font.stack,
              }}
            >
              {screensExpanded ? (
                <Minimize2 style={{ width: 11, height: 11 }} strokeWidth={2.4} />
              ) : (
                <LayoutGrid style={{ width: 11, height: 11 }} strokeWidth={2.4} />
              )}
              {screensExpanded ? "Collapse" : "View screens"}
            </button>
          )}
        </div>

        {/* Taste receipt — which terms / source images the prototype honors.
            Scans the title only (the body is sanitized HTML; scanning code
            would false-match). Self-renders only when there are hits. */}
        {status === "ready" && (
          <div onPointerDown={stopEventPropagation} style={{ padding: "0 12px" }}>
            <PrototypeTasteReceipt text={title} />
          </div>
        )}

        {/* Body — the live prototype, a skeleton, or an error. */}
        <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#fff" }}>
          {status === "ready" && html && screensExpanded ? (
            <div
              onPointerDown={stopEventPropagation}
              onWheelCapture={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                height: "100%",
                overflowX: "auto",
                overflowY: "hidden",
                display: "flex",
                gap: MINI_GAP,
                padding: SIDE_PAD,
                background: appleVibe.surface.chip,
                boxSizing: "border-box",
              }}
            >
              {screens.slice(0, 5).map((s, i) => (
                <div
                  key={`${i}-${s.name}`}
                  style={{
                    flex: `0 0 ${MINI_W}px`,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    background: "#fff",
                    borderRadius: 12,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                    overflow: "hidden",
                    boxShadow: "0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 24px -18px rgba(11,18,40,0.18)",
                  }}
                >
                  <div
                    style={{
                      padding: "6px 10px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: 0.2,
                      textTransform: "uppercase",
                      color: appleVibe.text.tertiary,
                      borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                      background: "#fff",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={s.purpose || s.name}
                  >
                    {s.name}
                  </div>
                  <iframe
                    title={`${title} – ${s.name}`}
                    srcDoc={injectScreenNavigator(html, s.name)}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    style={{ width: "100%", flex: 1, border: "none", display: "block", background: "#fff" }}
                  />
                </div>
              ))}
            </div>
          ) : status === "ready" && html ? (
            <iframe
              title={`${title} prototype`}
              srcDoc={html}
              // T1: allow scripts + forms + modals + popups, but NOT
              // same-origin — the doc loads at a null origin, can't read
              // parent cookies, can't fetch our APIs, can't escape the
              // sandbox. sanitizeHtmlT1 also wedges a deny-all CSP meta at
              // the top of <head> as the second layer; the extra flags
              // unlock alert/confirm/prompt + form submit + target=_blank
              // (the patterns Opus uses without thinking) so prototypes
              // don't silently die on the first localStorage/alert call.
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              onPointerDown={stopEventPropagation}
              onWheelCapture={(e) => e.stopPropagation()}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          ) : status === "error" ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: appleVibe.text.tertiary,
                padding: 24,
                textAlign: "center",
              }}
            >
              <AlertCircle style={{ width: 22, height: 22 }} strokeWidth={2} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                Couldn&apos;t build the prototype. Send feedback to retry.
              </span>
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: accent,
              }}
            >
              <Loader2 className="animate-spin" style={{ width: 24, height: 24 }} strokeWidth={2.2} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: appleVibe.text.secondary }}>
                {version > 0 ? "Revising the prototype…" : "Claude is building the prototype…"}
              </span>
            </div>
          )}
        </div>

        {/* Feedback box — the iteration loop. Flat hairline, no glass. */}
        <div
          onPointerDown={stopEventPropagation}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            borderTop: `1px solid ${appleVibe.stroke.hairline}`,
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendFeedback();
            }}
            placeholder="What should change?"
            disabled={status === "generating"}
            style={{
              flex: 1,
              border: `1px solid ${appleVibe.stroke.soft}`,
              borderRadius: 10,
              padding: "7px 12px",
              fontSize: 12.5,
              outline: "none",
              background: "#fff",
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.stack,
            }}
          />
          <button
            type="button"
            onClick={sendFeedback}
            disabled={status === "generating" || !feedback.trim()}
            title="Update the prototype with this feedback"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 30,
              height: 30,
              borderRadius: 10,
              border: "none",
              background: feedback.trim() ? accent : "rgba(15,23,42,0.06)",
              color: feedback.trim() ? "white" : appleVibe.text.faint,
              cursor: status === "generating" || !feedback.trim() ? "default" : "pointer",
              transition: "background 120ms ease-out",
              flexShrink: 0,
            }}
          >
            <SendHorizontal style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

/** Same wrapper pattern as the oc-card mount — resolves spaceId from
 *  the board URL; renders the receipt strip and hides off-board. */
function PrototypeTasteReceipt({ text }: { text: string }) {
  const spaceId =
    typeof window !== "undefined"
      ? window.location.pathname.match(/\/objective\/([^/?#]+)/)?.[1] ?? null
      : null;
  if (!spaceId) return null;
  return <TasteReceipt text={text} spaceId={spaceId} variant="strip" />;
}
