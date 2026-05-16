// ── Reflection display (read-only) ──
//
// Renders a check-in's reflection text as a quote block — Apple
// Notes citation style: 2px left-border in gray-200, 12px left padding,
// 13px gray-700 text. Never a chat bubble.
//
// Always read-only in C-1. The 24h-window inline editor lands in C-2.
// If reflection is empty/null, renders nothing (the parent shouldn't
// pass null but defensive guard kept).

interface Props {
  reflection: string | null;
}

export function ReflectionDisplay({ reflection }: Props) {
  if (!reflection || reflection.trim().length === 0) return null;
  return (
    <blockquote className="mt-2 border-l-2 border-gray-200 pl-3 text-[13px] leading-relaxed text-gray-700">
      {reflection}
    </blockquote>
  );
}
