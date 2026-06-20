"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-12 w-full rounded-xl bg-[var(--purple-soft)] px-4 text-base font-medium text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--purple)] disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
