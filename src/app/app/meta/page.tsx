import { Network } from "lucide-react";

export default function MetaPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Network className="h-12 w-12 text-gray-400" />
      <h2 className="mt-4 text-lg font-semibold">Meta-graph coming soon</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        View all your spaces and their connections as a navigable meta-graph.
        Available in Week 4.
      </p>
    </div>
  );
}
