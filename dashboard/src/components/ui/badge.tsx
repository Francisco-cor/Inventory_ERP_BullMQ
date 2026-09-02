import * as React from "react";
import { cn } from "../../lib/utils.js";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "border-transparent bg-primary text-primary-foreground": variant === "default",
          "border-transparent bg-muted text-muted-foreground": variant === "secondary",
          "border-transparent bg-red-600 text-white": variant === "destructive",
          "border-transparent bg-green-600 text-white": variant === "success",
          "border-transparent bg-amber-500 text-white": variant === "warning",
          "text-foreground": variant === "outline",
        },
        className
      )}
      {...props}
    />
  );
}
