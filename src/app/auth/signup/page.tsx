import { Network } from "lucide-react";
import Link from "next/link";
import { SignUpForm } from "@/components/auth/signup-form";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <Network className="h-6 w-6 text-blue-600" />
            <span className="text-lg font-semibold">CSMG</span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold">Create your account</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Start mapping complex situations
          </p>
        </div>
        <SignUpForm />
      </div>
    </div>
  );
}
