import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

// v2: earlier builds auto-persisted the default theme; bumping the key drops
// those stale values so the OS preference is honored until an explicit choice.
const STORAGE_KEY = "ais.theme.v2";

function osPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function savedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return null;
}

/** Initial theme: an explicit saved choice wins, otherwise follow the OS. */
function initial(): Theme {
  return savedTheme() ?? (osPrefersDark() ? "dark" : "light");
}

/**
 * App theme. Defaults to the OS `prefers-color-scheme` and live-follows OS
 * changes *until* the user explicitly toggles — at which point the choice is
 * persisted and overrides the OS. Toggling flips the `.dark` class on <html>,
 * which drives the CSS variables (and Tailwind's class dark mode). An inline
 * script in index.html applies the same logic before first paint to avoid a flash.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initial);

  // Apply the class (no persistence here — only explicit choices persist).
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Follow OS changes while the user hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => {
      if (savedTheme()) return; // user has chosen explicitly — don't override
      setThemeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const persistAndSet = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(
    () => persistAndSet(theme === "dark" ? "light" : "dark"),
    [theme, persistAndSet],
  );

  return { theme, setTheme: persistAndSet, toggle };
}
