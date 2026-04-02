import Link from "next/link";
import { XCircle } from "lucide-react";

export default function CreditCancelPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <XCircle className="h-12 w-12 text-gray-400" />
      <h1 className="mt-4 text-2xl font-bold">Purchase Cancelled</h1>
      <p className="mt-2 text-sm text-gray-600">
        No charges were made. You can try again anytime.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/app/credits"
          className="inline-flex items-center rounded-lg bg-interaxis-600 px-6 py-3 text-base font-medium text-white hover:bg-interaxis-700 transition-colors"
        >
          View Plans
        </Link>
        <Link
          href="/app"
          className="inline-flex items-center rounded-lg bg-gray-100 px-6 py-3 text-base font-medium text-gray-900 hover:bg-gray-200 transition-colors"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
