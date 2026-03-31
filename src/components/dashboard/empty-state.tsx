import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950">
        <Layers className="h-8 w-8 text-blue-600" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">No spaces yet</h2>
      <p className="mt-1 max-w-sm text-sm text-gray-600 dark:text-gray-400">
        Paste any text — a business situation, research problem, or complex
        decision — and decompose it into a structured knowledge graph.
      </p>
      <Link href="/app/decompose" className="mt-6">
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create your first space
        </Button>
      </Link>
    </div>
  );
}
