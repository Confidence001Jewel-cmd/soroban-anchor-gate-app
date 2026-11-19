"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { getThemeToggleAriaAttributes } from "@/lib/theme";

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme, isMounted } = useTheme();

  if (!isMounted) {
    // Avoid hydration mismatch and layout shift before client hydration
    return (
      <button
        type="button"
        className={`w-10 h-10 rounded-xl border border-border bg-input/40 flex items-center justify-center text-muted-foreground opacity-50 cursor-pointer transition-colors ${className}`}
        aria-label="Toggle dark and light theme"
        title="Toggle theme"
        disabled
      >
        <span className="w-4 h-4 rounded-full border border-current opacity-30" />
      </button>
    );
  }

  const { label, title, pressed } = getThemeToggleAriaAttributes(resolvedTheme);
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      className={`relative w-10 h-10 rounded-xl border border-border bg-card/60 hover:bg-muted text-foreground flex items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer active:scale-95 shadow-sm ${className}`}
      data-testid="theme-toggle"
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 transition-transform duration-300 hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 text-primary transition-transform duration-300 hover:-rotate-12" />
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}
