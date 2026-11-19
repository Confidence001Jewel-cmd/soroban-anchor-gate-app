import { test, describe } from "node:test";
import assert from "node:assert";
import {
  THEME_STORAGE_KEY,
  DEFAULT_THEME_PREFERENCE,
  THEME_INIT_SCRIPT,
  getStoredTheme,
  setStoredTheme,
  getSystemTheme,
  resolveTheme,
  toggleTheme,
  getThemeToggleAriaAttributes,
  applyThemeToElement,
  ThemeManager,
} from "./theme";

function createMockStorage(initialData: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("Theme Management - Core Switching & Logic", () => {
  test("1. switches from light to dark mode", () => {
    assert.strictEqual(toggleTheme("light"), "dark");
  });

  test("2. switches from dark to light mode", () => {
    assert.strictEqual(toggleTheme("dark"), "light");
  });

  test("3. persists selected theme to storage", () => {
    const mockStorage = createMockStorage();
    const success = setStoredTheme("dark", THEME_STORAGE_KEY, mockStorage);
    assert.strictEqual(success, true);
    assert.strictEqual(mockStorage.getItem(THEME_STORAGE_KEY), "dark");

    setStoredTheme("light", THEME_STORAGE_KEY, mockStorage);
    assert.strictEqual(mockStorage.getItem(THEME_STORAGE_KEY), "light");
  });

  test("4. restores saved theme from storage on subsequent load", () => {
    const mockStorage = createMockStorage({ [THEME_STORAGE_KEY]: "light" });
    const loaded = getStoredTheme(THEME_STORAGE_KEY, mockStorage);
    assert.strictEqual(loaded, "light");

    const manager = new ThemeManager({ storage: mockStorage });
    assert.strictEqual(manager.getPreference(), "light");
    assert.strictEqual(manager.getResolvedTheme(), "light");
  });

  test("5. saved user preference takes precedence over system default", () => {
    // System prefers dark, but user saved light
    const mockStorage = createMockStorage({ [THEME_STORAGE_KEY]: "light" });
    const mockMatcher = () => ({ matches: true }); // dark
    const manager = new ThemeManager({
      storage: mockStorage,
      matcher: mockMatcher,
    });
    assert.strictEqual(manager.getPreference(), "light");
    assert.strictEqual(manager.getResolvedTheme(), "light");
  });

  test("6. system preference is used when no saved preference exists", () => {
    const emptyStorage = createMockStorage();

    // System dark
    const darkMatcher = (q: string) => ({ matches: q.includes("dark") });
    const darkManager = new ThemeManager({
      storage: emptyStorage,
      matcher: darkMatcher,
    });
    assert.strictEqual(darkManager.getPreference(), "system");
    assert.strictEqual(darkManager.getResolvedTheme(), "dark");

    // System light
    const lightMatcher = () => ({ matches: false });
    const lightManager = new ThemeManager({
      storage: emptyStorage,
      matcher: lightMatcher,
    });
    assert.strictEqual(lightManager.getPreference(), "system");
    assert.strictEqual(lightManager.getResolvedTheme(), "light");

    // Direct getSystemTheme checks
    assert.strictEqual(getSystemTheme(darkMatcher), "dark");
    assert.strictEqual(getSystemTheme(lightMatcher), "light");
    assert.strictEqual(getSystemTheme(null), "dark");
  });

  test("7. handles missing, failing, or throwing localStorage gracefully", () => {
    const throwingStorage: Storage = {
      getItem: () => {
        throw new Error("SecurityError: Access denied");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };

    assert.strictEqual(getStoredTheme(THEME_STORAGE_KEY, throwingStorage), null);
    assert.strictEqual(setStoredTheme("light", THEME_STORAGE_KEY, throwingStorage), false);
    assert.strictEqual(getStoredTheme(THEME_STORAGE_KEY, null), null);
    assert.strictEqual(setStoredTheme("dark", THEME_STORAGE_KEY, null), false);

    // Manager should initialize safely even when storage throws
    const safeManager = new ThemeManager({ storage: throwingStorage });
    assert.strictEqual(safeManager.getPreference(), DEFAULT_THEME_PREFERENCE);
    assert.doesNotThrow(() => safeManager.setPreference("light"));
  });

  test("8. handles initialization and hydration edge cases (invalid stored values, null matcher)", () => {
    const invalidStorage = createMockStorage({ [THEME_STORAGE_KEY]: "invalid_theme_xyz" });
    assert.strictEqual(getStoredTheme(THEME_STORAGE_KEY, invalidStorage), null);

    // Manager falls back to system when stored value is invalid
    const manager = new ThemeManager({ storage: invalidStorage, matcher: null });
    assert.strictEqual(manager.getPreference(), "system");
    assert.strictEqual(manager.getResolvedTheme(), "dark"); // Default fallback when matcher null

    assert.strictEqual(resolveTheme("light", "dark"), "light");
    assert.strictEqual(resolveTheme("dark", "light"), "dark");
    assert.strictEqual(resolveTheme("system", "light"), "light");
    assert.strictEqual(resolveTheme("system", "dark"), "dark");
  });

  test("9. provides accessible ARIA attributes and labels for controls", () => {
    const darkAttrs = getThemeToggleAriaAttributes("dark");
    assert.strictEqual(darkAttrs.label, "Switch to light theme");
    assert.strictEqual(darkAttrs.title, "Switch to light mode");
    assert.strictEqual(darkAttrs.pressed, true);
    assert.strictEqual(darkAttrs.nextTheme, "light");

    const lightAttrs = getThemeToggleAriaAttributes("light");
    assert.strictEqual(lightAttrs.label, "Switch to dark theme");
    assert.strictEqual(lightAttrs.title, "Switch to dark mode");
    assert.strictEqual(lightAttrs.pressed, false);
    assert.strictEqual(lightAttrs.nextTheme, "dark");
  });

  test("10. applies theme classes, data-theme, and colorScheme to DOM elements", () => {
    class MockElement {
      public classList = {
        classes: new Set<string>(["dark"]),
        remove: (...args: string[]) => {
          args.forEach((c) => this.classList.classes.delete(c));
        },
        add: (...args: string[]) => {
          args.forEach((c) => this.classList.classes.add(c));
        },
        contains: (c: string) => this.classList.classes.has(c),
      };
      public attributes = new Map<string, string>();
      public setAttribute(k: string, v: string) {
        this.attributes.set(k, v);
      }
      public getAttribute(k: string) {
        return this.attributes.get(k) ?? null;
      }
      public style = { colorScheme: "" };
    }

    const mockRoot = new MockElement() as unknown as HTMLElement;

    // Apply light
    applyThemeToElement("light", mockRoot);
    assert.strictEqual((mockRoot as unknown as MockElement).classList.contains("light"), true);
    assert.strictEqual((mockRoot as unknown as MockElement).classList.contains("dark"), false);
    assert.strictEqual((mockRoot as unknown as MockElement).getAttribute("data-theme"), "light");
    assert.strictEqual(mockRoot.style.colorScheme, "light");

    // Apply dark
    applyThemeToElement("dark", mockRoot);
    assert.strictEqual((mockRoot as unknown as MockElement).classList.contains("light"), false);
    assert.strictEqual((mockRoot as unknown as MockElement).classList.contains("dark"), true);
    assert.strictEqual((mockRoot as unknown as MockElement).getAttribute("data-theme"), "dark");
    assert.strictEqual(mockRoot.style.colorScheme, "dark");
  });

  test("11. synchronizes theme across tabs via storage events and system changes", () => {
    const mockStorage = createMockStorage();
    const manager = new ThemeManager({ storage: mockStorage });
    let notifiedTheme: string | null = null;
    let notifiedPref: string | null = null;

    manager.subscribe((theme, pref) => {
      notifiedTheme = theme;
      notifiedPref = pref;
    });

    // Cross-tab event
    manager.handleStorageEvent({ key: THEME_STORAGE_KEY, newValue: "light" });
    assert.strictEqual(notifiedTheme, "light");
    assert.strictEqual(notifiedPref, "light");
    assert.strictEqual(manager.getResolvedTheme(), "light");

    // Toggle via manager
    const next = manager.toggle();
    assert.strictEqual(next, "dark");
    assert.strictEqual(notifiedTheme, "dark");
    assert.strictEqual(mockStorage.getItem(THEME_STORAGE_KEY), "dark");

    // System change when preference is system
    manager.setPreference("system");
    manager.handleSystemChange("light");
    assert.strictEqual(manager.getResolvedTheme(), "light");
  });

  test("12. contains valid zero-flicker initialization script", () => {
    assert.ok(THEME_INIT_SCRIPT.includes(THEME_STORAGE_KEY));
    assert.ok(THEME_INIT_SCRIPT.includes("classList"));
    assert.ok(THEME_INIT_SCRIPT.includes("colorScheme"));
  });
});
