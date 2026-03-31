import { GitBranch } from "lucide-react";

export default function WeavePage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <GitBranch className="h-12 w-12 text-gray-400" />
      <h2 className="mt-4 text-lg font-semibold">Weave coming soon</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Connect multiple spaces through shared variables to discover
        cross-domain insights. Available in Week 4.
      </p>
    </div>
  );
}
