"use client";

import React, { createContext, useContext, useSyncExternalStore } from "react";
import {
  ResolvedTheme,
  ThemePreference,
  themeStore,
} from "@/lib/theme";

export interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
  isMounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const emptySubscribe = () => () => {};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const themeState = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot
  );

  return (
    <ThemeContext.Provider
      value={{
        theme: themeState.preference,
        resolvedTheme: themeState.resolved,
        setTheme: themeStore.setPreference,
        toggleTheme: themeStore.toggle,
        isMounted,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
