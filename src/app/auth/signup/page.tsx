import Link from "next/link";
import { SignUpForm } from "@/components/auth/signup-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const { next } = (await searchParams) ?? {};
  const safeNext = next && next.startsWith("/") ? next : "/app";
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/">
            <span className="text-xl font-bold tracking-tight">akiboe</span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold">Create your account</h1>
          <p className="mt-1 text-sm text-gray-600">
            Build your intelligence system
          </p>
        </div>
        <SignUpForm next={safeNext} />
      </div>
    </div>
  );
}
