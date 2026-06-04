// ── Journal book (CSS 3D) ──
//
// A small, looping 3D book for the Self-Discovery Journal card banner —
// candidate replacement for the flat CardGlyph on that one card. Pure CSS
// 3D (perspective + preserve-3d + keyframes): the book floats, its cover
// swings open, then ruled pages riffle through in sequence, and it closes
// and loops. The volume is fully closed (fore-edge + top/bottom page-edge
// faces) so it reads as one solid block. No WebGL/JS → cheap on a card and
// SSR-safe; reduced-motion shows a static open book.
//
// Prototyped on /preflight/journal-book (+ public/book-proto.html while the
// dev /preflight routes are down). Size via `height`; width+depth derive.

interface Props {
  /** Book height in px; width≈0.74×, depth≈0.15×. */
  height?: number;
  /** Cover color (defaults to the journal template accent). */
  accent?: string;
  /** Loop duration. */
  durationMs?: number;
  className?: string;
}

export function JournalBook3D({
  height = 200,
  accent = "#d97706",
  durationMs = 8000,
  className,
}: Props) {
  const w = Math.round(height * 0.74);
  const d = Math.round(height * 0.15);

  return (
    <div
      className={className}
      style={{
        ...({
          "--jb-w": `${w}px`,
          "--jb-h": `${height}px`,
          "--jb-d": `${d}px`,
          "--jb-accent": accent,
          "--jb-dur": `${durationMs}ms`,
        } as any),
        perspective: `${height * 5}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <div className="jb-book">
        <div className="jb-shadow" />
        <div className="jb-face jb-back" />
        <div className="jb-fore" />
        <div className="jb-edge-t" />
        <div className="jb-edge-b" />
        <div className="jb-face jb-paper" />
        <div className="jb-leaf jb-pg3" />
        <div className="jb-leaf jb-pg2" />
        <div className="jb-leaf jb-pg1" />
        <div className="jb-spine" />
        <div className="jb-face jb-cover">
          <div className="jb-cover-frame" />
          <div className="jb-cover-title" />
          <div className="jb-cover-seal" />
          <div className="jb-band" />
        </div>
        <div className="jb-ribbon" />
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.jb-book {
  position: relative;
  width: var(--jb-w); height: var(--jb-h);
  transform-style: preserve-3d;
  animation: jb-float var(--jb-dur) ease-in-out infinite;
}
@keyframes jb-float {
  0%, 100% { transform: rotateX(13deg) rotateY(-30deg); }
  50%      { transform: rotateX(8deg)  rotateY(-13deg); }
}
.jb-face { position: absolute; inset: 0; border-radius: 2px 6px 6px 2px; backface-visibility: hidden; }

.jb-back {
  background: linear-gradient(145deg,
    color-mix(in srgb, var(--jb-accent) 70%, #000),
    color-mix(in srgb, var(--jb-accent) 88%, #000));
  transform: translateZ(calc(var(--jb-d) / -2));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
}

/* fore-edge + top + bottom faces — close the volume (page-edge texture) */
.jb-fore {
  position: absolute; right: 0; top: 0; width: var(--jb-d); height: 100%;
  transform-origin: right center;
  transform: translateX(calc(var(--jb-d) / 2)) rotateY(90deg);
  background: repeating-linear-gradient(180deg, #efe7d6 0 2px, #d8cdb6 2px 3px);
}
.jb-edge-t, .jb-edge-b {
  position: absolute; left: 0; width: 100%; height: var(--jb-d);
  background: repeating-linear-gradient(90deg, #efe7d6 0 2px, #d8cdb6 2px 3px);
}
.jb-edge-t { top: 0; transform-origin: top center; transform: translateY(calc(var(--jb-d) / -2)) rotateX(90deg); }
.jb-edge-b { bottom: 0; transform-origin: bottom center; transform: translateY(calc(var(--jb-d) / 2)) rotateX(-90deg); }

/* page block (ruled) — the page that stays put under the riffle */
.jb-paper {
  inset: 4px 5px 4px 7px; border-radius: 1px 3px 3px 1px;
  background:
    repeating-linear-gradient(180deg, transparent 0 12px, rgba(15,23,42,0.10) 12px 13px),
    linear-gradient(180deg, #fffdf7, #f3ecdd);
  transform: translateZ(calc(var(--jb-d) / 2 - 5px));
  box-shadow: 0 0 0 1px rgba(0,0,0,0.05), inset -6px 0 10px -8px rgba(0,0,0,0.25);
}
.jb-paper::before { content: ""; position: absolute; left: 17%; top: 7%; bottom: 7%; width: 1.5px; background: rgba(190,30,45,0.45); }

/* riffling leaves (ruled) — flip through in sequence while open */
.jb-leaf {
  position: absolute; inset: 4px 5px 4px 7px; border-radius: 1px 3px 3px 1px;
  background:
    repeating-linear-gradient(180deg, transparent 0 12px, rgba(15,23,42,0.09) 12px 13px),
    linear-gradient(180deg, #fffefb, #f3ecdd);
  transform-origin: left center; backface-visibility: hidden;
  box-shadow: 1px 0 5px -1px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04);
}
.jb-leaf::before { content: ""; position: absolute; left: 17%; top: 7%; bottom: 7%; width: 1.5px; background: rgba(190,30,45,0.4); }
.jb-pg1 { animation: jb-pg1 var(--jb-dur) ease-in-out infinite; }
.jb-pg2 { animation: jb-pg2 var(--jb-dur) ease-in-out infinite; }
.jb-pg3 { animation: jb-pg3 var(--jb-dur) ease-in-out infinite; }
@keyframes jb-pg1 {
  0%, 40%   { transform: translateZ(calc(var(--jb-d)/2 - 2px)) rotateY(0deg); }
  52%, 86%  { transform: translateZ(calc(var(--jb-d)/2 - 2px)) rotateY(-158deg); }
  94%, 100% { transform: translateZ(calc(var(--jb-d)/2 - 2px)) rotateY(0deg); }
}
@keyframes jb-pg2 {
  0%, 48%   { transform: translateZ(calc(var(--jb-d)/2 - 3px)) rotateY(0deg); }
  60%, 86%  { transform: translateZ(calc(var(--jb-d)/2 - 3px)) rotateY(-158deg); }
  94%, 100% { transform: translateZ(calc(var(--jb-d)/2 - 3px)) rotateY(0deg); }
}
@keyframes jb-pg3 {
  0%, 56%   { transform: translateZ(calc(var(--jb-d)/2 - 4px)) rotateY(0deg); }
  68%, 86%  { transform: translateZ(calc(var(--jb-d)/2 - 4px)) rotateY(-158deg); }
  94%, 100% { transform: translateZ(calc(var(--jb-d)/2 - 4px)) rotateY(0deg); }
}

/* front cover (swings open on the spine) */
.jb-cover {
  background: linear-gradient(150deg,
    color-mix(in srgb, var(--jb-accent) 100%, #fff 8%),
    color-mix(in srgb, var(--jb-accent) 82%, #000));
  transform-origin: left center;
  transform: translateZ(calc(var(--jb-d) / 2)) rotateY(0deg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 18px -10px rgba(0,0,0,0.55);
  overflow: hidden;
  animation: jb-open var(--jb-dur) ease-in-out infinite;
}
@keyframes jb-open {
  0%, 10%  { transform: translateZ(calc(var(--jb-d) / 2)) rotateY(0deg); }
  36%, 74% { transform: translateZ(calc(var(--jb-d) / 2)) rotateY(-150deg); }
  92%,100% { transform: translateZ(calc(var(--jb-d) / 2)) rotateY(0deg); }
}
.jb-cover-frame { position: absolute; inset: 8%; border: 1px solid rgba(255,255,255,0.28); border-radius: 3px; }
.jb-cover-title {
  position: absolute; left: 22%; right: 22%; top: 26%; height: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.55);
  box-shadow: 0 9px 0 rgba(255,255,255,0.35), 0 18px 0 rgba(255,255,255,0.22);
}
.jb-cover-seal { position: absolute; left: 50%; top: 60%; width: 18%; aspect-ratio: 1; transform: translate(-50%,-50%); border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.5); }
.jb-band { position: absolute; top: -4%; bottom: -4%; right: 14%; width: 5%; background: rgba(0,0,0,0.22); }

.jb-spine {
  position: absolute; left: 0; top: 0; width: var(--jb-d); height: 100%;
  transform-origin: left center; transform: translateX(calc(var(--jb-d) / -2)) rotateY(-90deg);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--jb-accent) 92%, #000),
    color-mix(in srgb, var(--jb-accent) 75%, #000));
  border-radius: 2px;
}
.jb-ribbon {
  position: absolute; top: -3px; right: 30%; width: 7px; height: 64%;
  background: linear-gradient(180deg, #0e7490, #155e75);
  transform: translateZ(calc(var(--jb-d) / 2 - 6px));
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%);
}
.jb-shadow {
  position: absolute; left: 50%; bottom: -14%; width: 78%; height: 16px;
  transform: translateX(-50%) translateZ(calc(var(--jb-d) / -2));
  background: radial-gradient(ellipse at center, rgba(11,18,40,0.28), transparent 70%);
  filter: blur(4px);
}

@media (prefers-reduced-motion: reduce) {
  .jb-book { animation: none; transform: rotateX(11deg) rotateY(-26deg); }
  .jb-cover { animation: none; transform: translateZ(calc(var(--jb-d) / 2)) rotateY(-120deg); }
  .jb-leaf { animation: none; }
}
`;
