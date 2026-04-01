import { AlertTriangle } from "lucide-react";

interface OrphanAlertProps {
  orphanCount: number;
}

export function OrphanAlert({ orphanCount }: OrphanAlertProps) {
  if (orphanCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
      <p className="text-[12px] text-amber-700">
        <span className="font-semibold">{orphanCount} entit{orphanCount === 1 ? "y has" : "ies have"}</span>{" "}
        fewer than 2 connections. These may be under-analyzed.
      </p>
    </div>
  );
}
