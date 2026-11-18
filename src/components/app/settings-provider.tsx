import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getUiSetting, resetUiSetting, setUiSetting } from "@/lib/api";
import { bewaar, defaults, loadSettings, migrateSettings, REGISTER, type SettingKey, type Settings, type SettingsStorage } from "@/lib/settings";
import { useTheme } from "@/components/app/theme-provider";

interface SettingsState {
  settings: Settings;
  /** Klaar met laden (de standaardwaarden gelden tot die tijd). */
  geladen: boolean;
  set: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>;
  /** "Standaard herstellen". */
  reset: (key: SettingKey) => Promise<void>;
}

const SettingsContext = createContext<SettingsState>({ settings: defaults(), geladen: false, set: async () => undefined, reset: async () => undefined });
export const useSettings = () => useContext(SettingsContext);

const storage: SettingsStorage = { get: getUiSetting, set: setUiSetting, reset: resetUiSetting };

/** Houdt de instellingen van Studio bij (SQLite), migreert ze bij het opstarten en past tekstgrootte toe. Komt binnen de ThemeProvider. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [geladen, setGeladen] = useState(false);
  const { setTheme } = useTheme();

  useEffect(() => {
    let off = false;
    void migrateSettings(storage)
      .then(() => loadSettings(storage))
      .then((s) => {
        if (off) return;
        setSettings(s);
        setGeladen(true);
      })
      .catch(() => !off && setGeladen(true));
    return () => {
      off = true;
    };
  }, []);

  // Tekstgrootte: een factor op de basisgrootte (zie index.css).
  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(settings.text_scale / 100));
  }, [settings.text_scale]);

  const set = useCallback(
    async <K extends SettingKey>(key: K, value: Settings[K]) => {
      setSettings((s) => ({ ...s, [key]: value }));
      if (key === "theme") return setTheme(value as Settings["theme"]); // de themawisselaar bewaart zelf
      await setUiSetting(key, bewaar(value as string | number | boolean)).catch(() => undefined);
    },
    [setTheme],
  );

  const reset = useCallback(
    async (key: SettingKey) => {
      const standaard = defaults()[key];
      setSettings((s) => ({ ...s, [key]: standaard }));
      if (key === "theme") return setTheme("system");
      await resetUiSetting(key).catch(() => undefined);
    },
    [setTheme],
  );

  const waarde = useMemo(() => ({ settings, geladen, set, reset }), [settings, geladen, set, reset]);
  return <SettingsContext.Provider value={waarde}>{children}</SettingsContext.Provider>;
}

export { REGISTER };
