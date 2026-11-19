import { ActivityIcon, CircleHelpIcon, CodeIcon, DatabaseIcon, GlobeIcon, HistoryIcon, ImageIcon, LayoutTemplateIcon, PaletteIcon, ScrollTextIcon, SettingsIcon, SmartphoneIcon, SparklesIcon, TerminalIcon, type LucideIcon } from "lucide-react";
import type { PanelId } from "@/lib/layout";

/** Het icoon bij elk onderdeel in het menu. De namen komen uit i18n (`werkruimte.paneel.<id>`). */
export const ICONEN: Partial<Record<PanelId, LucideIcon>> = {
  start: SparklesIcon,
  schermen: LayoutTemplateIcon,
  uiterlijk: PaletteIcon,
  bestanden: ImageIcon,
  gegevens: DatabaseIcon,
  onlinezetten: GlobeIcon,
  appwinkel: SmartphoneIcon,
  versies: HistoryIcon,
  instellingen: SettingsIcon,
  hulp: CircleHelpIcon,
  terminal: TerminalIcon,
  logs: ScrollTextIcon,
  technischestatus: ActivityIcon,
  code: CodeIcon,
};

/** Sneltoetsen die in tooltips staan (zie ook ShortcutsDialog). */
export const TOETSEN: Partial<Record<PanelId, string>> = { start: "Ctrl + Shift + S", preview: "Ctrl + Shift + P", chat: "Ctrl + Shift + G" };
