import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { AppStoreProvider } from "@/stores/store-provider";
import type { Space } from "@/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch user's spaces for the sidebar
  const { data } = await supabase
    .from("spaces")
    .select("*")
    .order("updated_at", { ascending: false });

  const spaces = (data ?? []) as Space[];

  return (
    <AppStoreProvider initialState={{ spaces }}>
      <div className="flex h-screen overflow-hidden">
        <SpaceSidebar userEmail={user.email ?? ""} />
        <main className="flex-1 overflow-y-auto">
          <div className="h-full px-6 py-6">{children}</div>
        </main>
      </div>
    </AppStoreProvider>
  );
}
