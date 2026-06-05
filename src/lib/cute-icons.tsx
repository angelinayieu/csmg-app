// Cute icon set — Phosphor duotone wrapped to be drop-in compatible with the
// lucide-react props we already pass (size, className, color, strokeWidth).
// Weight defaults to "duotone" for the rounded, friendly vibe; pass `weight`
// to override (e.g. "fill" for badges, "bold" for emphasis).
"use client";

import {
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowUpRight as PhArrowUpRight,
  ArrowsClockwise,
  ArrowsIn,
  ArrowsOut,
  BookBookmark,
  BookOpen as PhBookOpen,
  CaretDown,
  CaretRight,
  Check as PhCheck,
  CircleNotch,
  Cube,
  DotsSixVertical,
  Folder as PhFolder,
  FolderPlus as PhFolderPlus,
  Image as PhImage,
  MagicWand,
  MagnifyingGlass,
  MapPin as PhMapPin,
  Megaphone as PhMegaphone,
  NotePencil,
  PencilSimple,
  Plus as PhPlus,
  PushPin,
  Sparkle,
  Stack,
  StackSimple,
  Star as PhStar,
  Target as PhTarget,
  X as PhX,
  type Icon as PhIcon,
  type IconProps,
} from "@phosphor-icons/react";

type CompatProps = Omit<IconProps, "ref"> & { strokeWidth?: number };

function wrap(Comp: PhIcon) {
  const W = ({ strokeWidth: _ignored, weight = "duotone", ...rest }: CompatProps) => (
    <Comp weight={weight} {...rest} />
  );
  W.displayName = `Cute(${Comp.displayName ?? "Icon"})`;
  return W;
}

export const BookOpen = wrap(PhBookOpen);
export const Boxes = wrap(Stack);
export const Maximize2 = wrap(ArrowsOut);
export const Minimize2 = wrap(ArrowsIn);
export const X = wrap(PhX);
export const Search = wrap(MagnifyingGlass);
export const ChevronDown = wrap(CaretDown);
export const ChevronRight = wrap(CaretRight);
export const Loader2 = wrap(CircleNotch);
export const RefreshCw = wrap(ArrowsClockwise);
export const Sparkles = wrap(Sparkle);
export const NotebookPen = wrap(NotePencil);
export const ImageIcon = wrap(PhImage);
export const Megaphone = wrap(PhMegaphone);
export const Wand2 = wrap(MagicWand);
export const Library = wrap(BookBookmark);
export const ArrowRight = wrap(PhArrowRight);
export const ArrowLeft = wrap(PhArrowLeft);
export const MapPin = wrap(PhMapPin);
export const Target = wrap(PhTarget);
export const Star = wrap(PhStar);
export const Check = wrap(PhCheck);
export const Pencil = wrap(PencilSimple);
export const Pin = wrap(PushPin);
export const ArrowUpRight = wrap(PhArrowUpRight);
export const GripVertical = wrap(DotsSixVertical);
export const Plus = wrap(PhPlus);
export const Cube3D = wrap(Cube);
export const Folder = wrap(PhFolder);
export const FolderPlus = wrap(PhFolderPlus);
export const Layers = wrap(StackSimple);

export type LucideIcon = ReturnType<typeof wrap>;
