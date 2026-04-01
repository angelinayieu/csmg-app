import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

function GridCirclesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="7.5" cy="7.5" r="3.5" />
      <circle cx="16.5" cy="7.5" r="3.5" />
      <circle cx="7.5" cy="16.5" r="3.5" />
      <circle cx="16.5" cy="16.5" r="3.5" />
    </svg>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-interaxis-50">
        <GridCirclesIcon className="h-8 w-8 text-interaxis-600" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">No spaces yet</h2>
      <p className="mt-1 max-w-sm text-sm text-gray-600">
        Paste any text — a business situation, research problem, or complex
        decision — and analyze it into a structured knowledge graph.
      </p>
      <Link href="/app/analyze" className="mt-6">
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create your first space
        </Button>
      </Link>
    </div>
  );
}
