import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SpacePage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Construction className="h-12 w-12 text-gray-400" />
      <h2 className="mt-4 text-lg font-semibold">Space viewer coming soon</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Graph visualization, tier view, and synthesis will be available in Week
        3.
      </p>
      <Link href="/app" className="mt-6">
        <Button variant="secondary">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to dashboard
        </Button>
      </Link>
    </div>
  );
}
