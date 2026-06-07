import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ClientRootChrome } from "@/components/chrome/client-root-chrome";

const geist = Geist({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "akiboe — Your Intelligence System",
  description:
    "AI with enhanced real world logic reasoning capabilities. Digital infrastructure for speed, quality, and accuracy.",
  icons: {
    icon: "/akiboe-mark.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geist.className} suppressHydrationWarning>
      <body className="min-h-screen bg-gradient-page text-gray-900 antialiased" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("interaxis-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
        {/* Sticky 32px banner at the very top of the viewport. Hidden
            by default; renders when /api/health/supabase reports the
            circuit breaker is open. Provides global awareness of
            "the service is having an episode" so users don't blame
            individual actions for transient infrastructure issues. */}
        {children}
        <ClientRootChrome />
      </body>
    </html>
  );
}
