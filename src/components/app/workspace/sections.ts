import {
  BlocksIcon,
  DatabaseIcon,
  HistoryIcon,
  KeyRoundIcon,
  ListTreeIcon,
  PaletteIcon,
  PlugIcon,
  RocketIcon,
  SettingsIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import type { PanelId } from "@/lib/layout";

/** Het icoon bij elk onderdeel in de iconenbalk. De namen komen uit i18n (`werkruimte.paneel.<id>`). */
export const ICONEN: Partial<Record<PanelId, LucideIcon>> = {
  structuur: ListTreeIcon,
  componenten: BlocksIcon,
  uiterlijk: PaletteIcon,
  database: DatabaseIcon,
  koppelingen: PlugIcon,
  publiceren: RocketIcon,
  geschiedenis: HistoryIcon,
  accounts: KeyRoundIcon,
  instellingen: SettingsIcon,
  geavanceerd: TerminalIcon,
};
