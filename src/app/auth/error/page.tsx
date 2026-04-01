import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
        <h1 className="mt-4 text-xl font-bold">Authentication error</h1>
        <p className="mt-2 text-sm text-gray-600">
          {error || "Something went wrong during authentication."}
        </p>
        <div className="mt-6">
          <Link href="/auth/login">
            <Button variant="secondary">Back to login</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
