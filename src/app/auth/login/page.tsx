import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const { next } = (await searchParams) ?? {};
  // Only honor in-app relative paths (no open-redirects to external URLs).
  const safeNext = next && next.startsWith("/") ? next : "/app";
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/">
            <span className="text-xl font-bold tracking-tight">akiboe</span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-600">
            Log in to your account
          </p>
        </div>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
