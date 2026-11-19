export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

export const THEME_STORAGE_KEY = "sag-theme-preference";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/**
 * Minified zero-flicker inline script executed synchronously in <head>
 * before initial page paint to prevent theme flashing during hydration.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(s==='light'||s==='dark')?s:(m?'dark':'light');var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);r.setAttribute('data-theme',t);r.style.colorScheme=t;}catch(e){}})();`;

/**
 * Retrieves the stored theme preference from localStorage with defensive error handling.
 * Returns null if localStorage is inaccessible or if the value is invalid.
 */
export function getStoredTheme(
  storageKey: string = THEME_STORAGE_KEY,
  storage?: Storage | null
): ThemePreference | null {
  try {
    const s = storage !== undefined ? storage : typeof window !== "undefined" ? window.localStorage : null;
    if (!s) return null;
    const value = s.getItem(storageKey);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists the user's theme preference to localStorage.
 * Handles storage quota and SecurityError exceptions gracefully.
 */
export function setStoredTheme(
  theme: ThemePreference,
  storageKey: string = THEME_STORAGE_KEY,
  storage?: Storage | null
): boolean {
  try {
    const s = storage !== undefined ? storage : typeof window !== "undefined" ? window.localStorage : null;
    if (!s) return false;
    s.setItem(storageKey, theme);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the system's preferred color scheme using window.matchMedia.
 * Defaults to 'dark' if matchMedia is unavailable.
 */
export function getSystemTheme(
  matcher?: ((query: string) => { matches: boolean }) | null
): ResolvedTheme {
  try {
    const matchFn =
      matcher !== undefined
        ? matcher
        : typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia.bind(window)
        : null;

    if (!matchFn) return "dark";
    return matchFn("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

/**
 * Resolves the effective active theme ('light' | 'dark') given a preference and system state.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  if (preference === "system") {
    return systemTheme;
  }
  return preference;
}

/**
 * Returns the opposite theme for simple two-way toggling.
 */
export function toggleTheme(current: ResolvedTheme): ResolvedTheme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Generates accessible ARIA attributes and labels for theme toggle controls.
 */
export function getThemeToggleAriaAttributes(resolvedTheme: ResolvedTheme) {
  const isDark = resolvedTheme === "dark";
  const nextTheme: ResolvedTheme = isDark ? "light" : "dark";
  return {
    label: `Switch to ${nextTheme} theme`,
    title: `Switch to ${nextTheme} mode`,
    pressed: isDark,
    currentTheme: resolvedTheme,
    nextTheme,
  };
}

/**
 * Synchronously applies theme classes, attributes, and colorScheme to a target DOM element.
 */
export function applyThemeToElement(
  theme: ResolvedTheme,
  element?: HTMLElement | null
): void {
  if (!element && typeof document !== "undefined") {
    element = document.documentElement;
  }
  if (!element) return;

  element.classList.remove("light", "dark");
  element.classList.add(theme);
  element.setAttribute("data-theme", theme);
  element.style.colorScheme = theme;
}

/**
 * Headless controller managing theme state, listeners, storage persistence, and tab synchronization.
 */
export class ThemeManager {
  private preference: ThemePreference;
  private resolved: ResolvedTheme;
  private storageKey: string;
  private storage: Storage | null;
  private listeners: Set<(theme: ResolvedTheme, preference: ThemePreference) => void> = new Set();
  private matcher: ((query: string) => { matches: boolean }) | null;

  constructor(options?: {
    storageKey?: string;
    storage?: Storage | null;
    matcher?: ((query: string) => { matches: boolean }) | null;
    initialPreference?: ThemePreference;
  }) {
    this.storageKey = options?.storageKey ?? THEME_STORAGE_KEY;
    this.storage = options?.storage !== undefined ? options.storage : typeof window !== "undefined" ? window.localStorage : null;
    this.matcher = options?.matcher !== undefined ? options.matcher : typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;

    const stored = getStoredTheme(this.storageKey, this.storage);
    this.preference = options?.initialPreference ?? stored ?? DEFAULT_THEME_PREFERENCE;
    const sysTheme = getSystemTheme(this.matcher);
    this.resolved = resolveTheme(this.preference, sysTheme);
  }

  public getPreference(): ThemePreference {
    return this.preference;
  }

  public getResolvedTheme(): ResolvedTheme {
    return this.resolved;
  }

  public setPreference(preference: ThemePreference): void {
    this.preference = preference;
    setStoredTheme(preference, this.storageKey, this.storage);
    const sysTheme = getSystemTheme(this.matcher);
    this.resolved = resolveTheme(preference, sysTheme);
    this.notify();
  }

  public toggle(): ResolvedTheme {
    const next = toggleTheme(this.resolved);
    this.setPreference(next);
    return next;
  }

  public handleSystemChange(systemTheme: ResolvedTheme): void {
    if (this.preference === "system") {
      this.resolved = systemTheme;
      this.notify();
    }
  }

  public handleStorageEvent(event: { key: string | null; newValue: string | null }): void {
    if (event.key === this.storageKey && event.newValue) {
      if (event.newValue === "light" || event.newValue === "dark" || event.newValue === "system") {
        this.preference = event.newValue as ThemePreference;
        const sysTheme = getSystemTheme(this.matcher);
        this.resolved = resolveTheme(this.preference, sysTheme);
        this.notify();
      }
    }
  }

  public subscribe(fn: (theme: ResolvedTheme, preference: ThemePreference) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.resolved, this.preference);
    }
  }
}

/**
 * Client-side external store for React 19 useSyncExternalStore integration.
 */
class ThemeStore {
  private state: ThemeState;
  private listeners = new Set<() => void>();
  private initialized = false;

  constructor() {
    this.state = {
      preference: DEFAULT_THEME_PREFERENCE,
      resolved: "dark",
    };
  }

  private initClient() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;

    const stored = getStoredTheme();
    const pref = stored || DEFAULT_THEME_PREFERENCE;
    const sys = getSystemTheme();
    const resolved = resolveTheme(pref, sys);

    this.state = { preference: pref, resolved };
    applyThemeToElement(resolved);

    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        if (e.newValue === "light" || e.newValue === "dark" || e.newValue === "system") {
          const nextPref = e.newValue as ThemePreference;
          const nextResolved = resolveTheme(nextPref, getSystemTheme());
          this.state = { preference: nextPref, resolved: nextResolved };
          applyThemeToElement(nextResolved);
          this.notify();
        }
      }
    });

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", (e: MediaQueryListEvent) => {
      if (this.state.preference === "system") {
        const nextResolved: ResolvedTheme = e.matches ? "dark" : "light";
        this.state = { ...this.state, resolved: nextResolved };
        applyThemeToElement(nextResolved);
        this.notify();
      }
    });
  }

  public subscribe = (callback: () => void): (() => void) => {
    this.initClient();
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };

  public getSnapshot = (): ThemeState => {
    this.initClient();
    return this.state;
  };

  public getServerSnapshot = (): ThemeState => {
    return {
      preference: DEFAULT_THEME_PREFERENCE,
      resolved: "dark",
    };
  };

  public setPreference = (preference: ThemePreference): void => {
    this.initClient();
    setStoredTheme(preference);
    const resolved = resolveTheme(preference, getSystemTheme());
    this.state = { preference, resolved };
    applyThemeToElement(resolved);
    this.notify();
  };

  public toggle = (): void => {
    const next = toggleTheme(this.state.resolved);
    this.setPreference(next);
  };

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const themeStore = new ThemeStore();
