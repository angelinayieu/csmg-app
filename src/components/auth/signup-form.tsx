"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignUpForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
          // In production, this resolves to https://www.interaxis.com/auth/callback
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="text-center">
        <h3 className="text-lg font-semibold">Check your email</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          We sent a confirmation link to <strong>{email}</strong>. Click the
          link to activate your account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="display-name"
        label="Display name"
        type="text"
        placeholder="Your name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />
      <Input
        id="email"
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        id="password"
        label="Password"
        type="password"
        placeholder="At least 6 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
      />
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      <Button type="submit" loading={loading} className="w-full">
        Create account
      </Button>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="font-medium text-blue-600 hover:text-blue-500"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}
