import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getUiSetting, setUiSetting } from "@/lib/api";

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEMES: Theme[] = ["system", "light", "dark"];
const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

interface ThemeState {
  /** De keuze van de gebruiker (standaard: volgens het systeem). */
  theme: Theme;
  /** Wat er nu echt getoond wordt. */
  resolved: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState>({ theme: "system", resolved: "light", setTheme: () => undefined });

const systemTheme = (): ResolvedTheme => (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Zet de klasse `dark` op <html>, zoals shadcn dat verwacht. De keuze staat in de instellingen (SQLite), niet in de browser. */
export function ThemeProvider({ children, initial = "system" }: { children: ReactNode; initial?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(initial);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved: ResolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    let off = false;
    getUiSetting("theme")
      .then((v) => !off && isTheme(v) && setThemeState(v))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    setUiSetting("theme", t).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
