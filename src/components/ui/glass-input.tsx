import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

/**
 * Glass-treatment input. Use on intake / twin-proposal / canvas surfaces where
 * a flat white box would clash with the surrounding glass cards. For dense
 * settings forms, the existing flat <Input/> is still appropriate.
 */
export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label
            htmlFor={id}
            className="block text-[12px] font-medium tracking-wide text-gray-700/90"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "glass-input block w-full rounded-xl px-3.5 py-2.5 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-50",
            error && "!border-red-400 focus:!border-red-500",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600/90">{error}</p>}
      </div>
    );
  }
);

GlassInput.displayName = "GlassInput";
