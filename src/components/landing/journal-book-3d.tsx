// ── Journal book (CSS 3D) ──
//
// A small, looping 3D book for the Self-Discovery Journal card banner —
// candidate replacement for the flat CardGlyph on that one card. Pure CSS
// 3D (perspective + preserve-3d + keyframes): the book floats, its cover
// swings open to reveal a ruled page, and a leaf turns — then it closes and
// loops. No WebGL/JS, so it's cheap enough to sit on a card and SSR-safe.
//
// Prototyped on /preflight/journal-book. Size via the `height` prop; width +
// depth derive from it. Accent defaults to the journal amber.

interface Props {
  /** Book height in px; width≈0.74×, depth≈0.16×. */
  height?: number;
  /** Cover color (defaults to the journal template accent). */
  accent?: string;
  className?: string;
}

export function JournalBook3D({
  height = 200,
  accent = "#d97706",
  className,
}: Props) {
  const w = Math.round(height * 0.74);
  const d = Math.round(height * 0.16);

  return (
    <div
      className={className}
      style={{
        // CSS vars consumed by the <style> block below.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({
          "--jb-w": `${w}px`,
          "--jb-h": `${height}px`,
          "--jb-d": `${d}px`,
          "--jb-accent": accent,
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
        <div className="jb-face jb-paper" />
        <div className="jb-leaf" />
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
  width: var(--jb-w);
  height: var(--jb-h);
  transform-style: preserve-3d;
  animation: jb-float 7s ease-in-out infinite;
}
@keyframes jb-float {
  0%, 100% { transform: rotateX(13deg) rotateY(-32deg); }
  50%      { transform: rotateX(8deg)  rotateY(-12deg); }
}

.jb-face {
  position: absolute;
  inset: 0;
  border-radius: 2px 6px 6px 2px;
  backface-visibility: hidden;
}

/* back cover */
.jb-back {
  background: linear-gradient(145deg,
    color-mix(in srgb, var(--jb-accent) 70%, #000),
    color-mix(in srgb, var(--jb-accent) 88%, #000));
  transform: translateZ(calc(var(--jb-d) / -2));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
}

/* page block (ruled cream pages) */
.jb-paper {
  inset: 4px 5px 4px 7px;
  border-radius: 1px 3px 3px 1px;
  background:
    repeating-linear-gradient(180deg, transparent 0 12px, rgba(15,23,42,0.10) 12px 13px),
    linear-gradient(180deg, #fffdf7, #f3ecdd);
  transform: translateZ(calc(var(--jb-d) / 2 - 3px));
  box-shadow: 0 0 0 1px rgba(0,0,0,0.05), inset -6px 0 10px -8px rgba(0,0,0,0.25);
}
.jb-paper::before { /* red margin rule */
  content: "";
  position: absolute;
  left: 17%; top: 7%; bottom: 7%;
  width: 1.5px;
  background: rgba(190,30,45,0.45);
}

/* a single turning leaf */
.jb-leaf {
  position: absolute;
  inset: 4px 5px 4px 7px;
  border-radius: 1px 3px 3px 1px;
  background: linear-gradient(180deg, #fffefb, #f5eede);
  transform-origin: left center;
  transform: translateZ(calc(var(--jb-d) / 2 - 2px)) rotateY(0deg);
  backface-visibility: hidden;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.04);
  animation: jb-flip 7s ease-in-out infinite;
}
@keyframes jb-flip {
  0%, 42%  { transform: translateZ(calc(var(--jb-d) / 2 - 2px)) rotateY(0deg); }
  57%, 64% { transform: translateZ(calc(var(--jb-d) / 2 - 2px)) rotateY(-150deg); }
  80%,100% { transform: translateZ(calc(var(--jb-d) / 2 - 2px)) rotateY(0deg); }
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
  animation: jb-open 7s ease-in-out infinite;
}
@keyframes jb-open {
  0%, 12%  { transform: translateZ(calc(var(--jb-d) / 2)) rotateY(0deg); }
  40%, 72% { transform: translateZ(calc(var(--jb-d) / 2)) rotateY(-148deg); }
  100%     { transform: translateZ(calc(var(--jb-d) / 2)) rotateY(0deg); }
}
.jb-cover-frame {
  position: absolute; inset: 8%;
  border: 1px solid rgba(255,255,255,0.28);
  border-radius: 3px;
}
.jb-cover-title {
  position: absolute; left: 22%; right: 22%; top: 26%;
  height: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.55);
  box-shadow: 0 9px 0 rgba(255,255,255,0.35), 0 18px 0 rgba(255,255,255,0.22);
}
.jb-cover-seal {
  position: absolute; left: 50%; top: 60%;
  width: 18%; aspect-ratio: 1; transform: translate(-50%,-50%);
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.5);
}
.jb-band { /* elastic closure band near the fore-edge */
  position: absolute; top: -4%; bottom: -4%; right: 14%;
  width: 5%;
  background: rgba(0,0,0,0.22);
}

/* spine (left face joining the covers) */
.jb-spine {
  position: absolute; left: 0; top: 0;
  width: var(--jb-d); height: 100%;
  transform-origin: left center;
  transform: translateX(calc(var(--jb-d) / -2)) rotateY(-90deg);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--jb-accent) 92%, #000),
    color-mix(in srgb, var(--jb-accent) 75%, #000));
  border-radius: 2px;
}

/* bookmark ribbon */
.jb-ribbon {
  position: absolute; top: -3px; right: 30%;
  width: 7px; height: 64%;
  background: linear-gradient(180deg, #0e7490, #155e75);
  transform: translateZ(calc(var(--jb-d) / 2 - 4px));
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%);
}

/* soft ground shadow */
.jb-shadow {
  position: absolute;
  left: 50%; bottom: -14%;
  width: 78%; height: 16px;
  transform: translateX(-50%) translateZ(calc(var(--jb-d) / -2));
  background: radial-gradient(ellipse at center, rgba(11,18,40,0.28), transparent 70%);
  filter: blur(4px);
}

@media (prefers-reduced-motion: reduce) {
  .jb-book { animation: none; transform: rotateX(11deg) rotateY(-26deg); }
  .jb-cover { animation: none; transform: translateZ(calc(var(--jb-d) / 2)) rotateY(-118deg); }
  .jb-leaf { animation: none; }
}
`;
