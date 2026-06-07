"use client";

import dynamic from "next/dynamic";

const ServiceDegradationBanner = dynamic(
  () =>
    import("@/components/chrome/service-degradation-banner").then(
      (mod) => mod.ServiceDegradationBanner,
    ),
  { ssr: false },
);

const Toaster = dynamic(
  () => import("@/components/ui/toaster").then((mod) => mod.Toaster),
  { ssr: false },
);

const GlobalKeyboardHelp = dynamic(
  () =>
    import("@/components/ui/global-keyboard-help").then(
      (mod) => mod.GlobalKeyboardHelp,
    ),
  { ssr: false },
);

export function ClientRootChrome() {
  return (
    <>
      <ServiceDegradationBanner />
      <Toaster />
      <GlobalKeyboardHelp />
    </>
  );
}
