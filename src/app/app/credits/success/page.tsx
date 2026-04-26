import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function CreditSuccessPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <CheckCircle className="h-12 w-12 text-green-500" />
      <h1 className="mt-4 text-2xl font-bold">Credits Added!</h1>
      <p className="mt-2 text-sm text-gray-600">
        Your credits have been added to your account and are ready to use.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/app"
          className="inline-flex items-center rounded-lg bg-interaxis-600 px-6 py-3 text-base font-medium text-white hover:bg-interaxis-700 transition-colors"
        >
          Start Analyzing
        </Link>
      </div>
    </div>
  );
}
