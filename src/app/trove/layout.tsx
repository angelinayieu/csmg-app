import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getAuthUser } from "@/lib/supabase/server";
import "./trove.css";
import { TroveProvider } from "./_lib/store";
import { TroveChrome, TroveOverlays } from "./_components/chrome";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-trove",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "trove — your knowledge, self-organized",
  description:
    "A personal knowledge graph that decomposes everything you collect, files it automatically, and lets you think on it — as a library, a drive, a whiteboard, and agents.",
};

// Standalone app surface. Lives outside /app/* on purpose — the
// route-compaction proxy only rewrites /app/*, so /trove renders with its own
// chrome. Auth IS required (the graph is per-user): no session → login.
export default async function TroveLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent("/trove")}`);

  return (
    <div className={`tr-shell ${jakarta.variable}`}>
      <TroveProvider>
        <TroveChrome />
        <main className="tr-main">{children}</main>
        <TroveOverlays />
      </TroveProvider>
    </div>
  );
}
