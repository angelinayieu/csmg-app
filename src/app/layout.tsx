import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InterAxis — Your Intelligence System",
  description:
    "AI with enhanced real world logic reasoning capabilities. Digital infrastructure for speed, quality, and accuracy.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geist.className} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("interaxis-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-gradient-page text-gray-900 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
