import Image from "next/image";

/**
 * InterAxis brand mark — uses the image asset at `public/interaxis-logo.png`.
 *
 * To update the logo, replace the file at:
 *   `/Users/angelina/Desktop/interaxis kg build v1/public/interaxis-logo.png`
 *
 * The image is auto-cropped to a square via `object-cover` — even if the source
 * file is rectangular, only the centered square region will show in the logo slot.
 */
interface InterAxisLogoProps {
  /** Applied to the outer wrapper — control size via width/height (e.g. `h-8 w-8`) */
  className?: string;
  /** Inline styles applied to the outer wrapper (e.g. shadow, border-radius) */
  style?: React.CSSProperties;
  /** Pixel size (used for the native <Image> width/height — defaults to 64) */
  size?: number;
}

export function InterAxisLogo({
  className,
  style,
  size = 64,
}: InterAxisLogoProps) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        ...style,
      }}
      aria-label="InterAxis"
      role="img"
    >
      <Image
        src="/interaxis-logo.png"
        alt="InterAxis"
        width={size}
        height={size}
        priority
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",        // crops a rectangular source to a centered square
          objectPosition: "center",
          display: "block",
        }}
      />
    </div>
  );
}
