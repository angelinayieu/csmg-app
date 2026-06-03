"use client";

// Suppress global chrome (pulse strip, floating toolbox) on the minimal
// home (/app), which renders its own clean header. Everywhere else the
// chrome shows as before.

import { usePathname } from "next/navigation";

export function HideOnHome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/app") return null;
  return <>{children}</>;
}
