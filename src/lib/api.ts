import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type Provider = "claude" | "gemini";

export interface Project {
  id: number;
  naam: string;
  pad: string;
  template: string;
  created_at: string;
  default_account_id: number | null;
  /** Laatst geopend of bewerkt (ISO 8601); null zolang het project nog nooit is geopend. */
  last_used_at: string | null;
}

export interface Account {
  id: number;
  provider: Provider;
  label: string;
  profile_dir: string;
  created_at: string;
}

export type McpProblemKind =
  | "node_missing"
  | "node_old"
  | "node_broken"
  | "script_missing"
  | "spawn_failed"
  | "timeout"
  | "crashed"
  | "error";

export interface McpInfo {
  state: "starting" | "running" | "connected" | "unavailable";
  port: number | null;
  error: string | null;
  kind?: McpProblemKind | null;
  log?: string[];
}

export interface McpCheck {
  verdict: "connected" | "pending_approval" | "failed" | "not_found" | "timeout" | "unknown";
  output: string;
}

export interface InstallStep {
  label: string;
  command: string;
}

export interface CliStatus {
  provider: Provider;
  installed: boolean;
  path: string | null;
  install_steps: InstallStep[];
  docs_url: string;
}

export interface SessionInfo {
  id: string;
  kind: "shell" | "ai" | "login";
  provider: Provider | null;
  account_id: number | null;
  account_label: string | null;
  project_id: number | null;
  warnings: string[];
}

export interface Snapshot {
  data: string;
  end_offset: number;
  exited: boolean;
  exit_code: number | null;
}

// projecten
export const listProjects = () => invoke<Project[]>("list_projects");
export const createProject = (naam: string, bovenliggendPad: string, template?: string) =>
  invoke<Project>("create_project", { naam, bovenliggendPad, template });
export const deleteProject = (id: number) => invoke<void>("delete_project", { id });
export const renameProject = (id: number, naam: string) => invoke<Project>("rename_project", { id, naam });
export const projectThumbnailGet = (id: number) => invoke<string | null>("project_thumbnail_get", { id });
export const projectThumbnailSet = (id: number, dataUrl: string) => invoke<void>("project_thumbnail_set", { id, dataUrl });

// indeling van de werkruimte per project
export interface StoredLayout {
  versie: number;
  json: string;
}
export const layoutGet = (projectId: number) => invoke<StoredLayout | null>("layout_get", { projectId });
export const layoutSet = (projectId: number, versie: number, json: string) => invoke<void>("layout_set", { projectId, versie, json });
export const layoutReset = (projectId: number) => invoke<void>("layout_reset", { projectId });
export const setDefaultAccount = (projectId: number, accountId: number | null) =>
  invoke<void>("set_default_account", { projectId, accountId });

// accounts
export const listAccounts = () => invoke<Account[]>("list_accounts");
export const createAccount = (provider: Provider, label: string) => invoke<Account>("create_account", { provider, label });
export const deleteAccount = (id: number) => invoke<void>("delete_account", { id });

// CLI en MCP
export const cliStatus = (provider: Provider) => invoke<CliStatus>("cli_status", { provider });
export const openProject = (id: number) => invoke<McpInfo>("open_project", { id });
export const verifyClaudeMcp = (projectId: number, accountId: number | null) =>
  invoke<McpCheck>("verify_claude_mcp", { projectId, accountId });
export const closeProject = (id: number) => invoke<void>("close_project", { id });

// terminal
export const startShell = (projectId: number, rows = 24, cols = 80) =>
  invoke<SessionInfo>("start_shell", { projectId, rows, cols });
export const startAi = (
  projectId: number,
  provider: Provider,
  accountId: number | null,
  opts: { handover?: boolean; resume?: boolean } = {},
) =>
  invoke<SessionInfo>("start_ai", {
    projectId,
    provider,
    accountId,
    handover: opts.handover ?? false,
    resume: opts.resume ?? false,
    rows: 24,
    cols: 80,
  });
export const startLogin = (accountId: number) => invoke<SessionInfo>("start_login", { accountId, rows: 24, cols: 80 });
export const ptyWrite = (id: string, data: string) => invoke<void>("pty_write", { id, data });
export const ptyResize = (id: string, rows: number, cols: number) => invoke<void>("pty_resize", { id, rows, cols });
export const ptySnapshot = (id: string) => invoke<Snapshot>("pty_snapshot", { id });
export const ptyClose = (id: string) => invoke<void>("pty_close", { id });

export async function kiesMap(startIn?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, ...(startIn ? { defaultPath: startIn } : {}) });
  return typeof result === "string" ? result : null;
}

// fase 3: runtime (dev-server, checks, git)
export type DevState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface DevStatus {
  state: DevState;
  pid: number | null;
  url: string | null;
  exitCode: number | null;
  error: string | null;
}

export interface StudioConfig {
  dev?: string;
  build?: string;
  lint?: string;
  test?: string;
  previewUrl?: string;
  timeoutSec?: number;
}

export interface ConfigInfo {
  exists: boolean;
  config: StudioConfig | null;
  hash: string | null;
  error?: string;
  trusted: boolean;
}

export interface Checkpoint {
  hash: string;
  short: string;
  date: string;
  message: string;
}

export interface StepResult {
  name: "lint" | "build" | "test" | "html" | "links" | "console";
  command?: string;
  status: "passed" | "failed" | "timeout" | "skipped" | "warned";
  exitCode: number | null;
  durationMs: number;
  output: string[];
}

export interface CheckRun {
  id: number;
  ok: boolean;
  steps: StepResult[];
  created_at: string;
}

export interface RestoreResult {
  safety?: string;
  hash: string;
  unchanged: boolean;
}

export const runtime = <T>(projectId: number, cmd: string, args: Record<string, unknown> = {}) =>
  invoke<T>("runtime_call", { projectId, cmd, args });
export const trustStudioConfig = (projectId: number) => invoke<void>("trust_studio_config", { projectId });
export const lastChecks = (projectId: number, limit = 3) => invoke<CheckRun[]>("last_checks", { projectId, limit });

// zero-config preview
export type PreviewMode = "empty" | "static" | "node" | "config" | "flutter" | "unsupported";
export type PreviewStatus = "idle" | "starting" | "running" | "stopping" | "error";

export interface PreviewProblem {
  kind: string;
  message: string;
  log: string[];
}

export interface PreviewInfo {
  mode: PreviewMode;
  status: PreviewStatus;
  url: string | null;
  hmr: boolean;
  problem: PreviewProblem | null;
  plan: { entry: string | null; dev_script: string | null; needs_install: boolean };
}

export const previewInfo = (id: number) => invoke<PreviewInfo | null>("preview_info", { id });
export const previewStart = (id: number) => invoke<PreviewInfo>("preview_start", { id });
export const previewStop = (id: number) => invoke<PreviewInfo>("preview_stop", { id });
export const previewRestart = (id: number) => invoke<PreviewInfo>("preview_restart", { id });
export const previewTrustScripts = (id: number) => invoke<PreviewInfo>("preview_trust_scripts", { id });
export const previewInstall = (id: number) => invoke<PreviewInfo>("preview_install", { id });
export const getUiSetting = (key: string) => invoke<string | null>("get_ui_setting", { key });
export const setUiSetting = (key: string, value: string) => invoke<void>("set_ui_setting", { key, value });
export const resetUiSetting = (key: string) => invoke<void>("reset_ui_setting", { key });

// chat-weergave
export type ChatStatus = "thinking" | "editing" | "working" | "checking" | "done" | "idle";
export type ActionKind =
  | "file_created" | "file_edited" | "file_read" | "search" | "run_checks" | "install_packages" | "start_server"
  | "run_command" | "delete_files" | "publish" | "save_version" | "list_versions" | "view_preview"
  | "find_page_errors" | "read_logs" | "read_notes" | "update_notes" | "plan" | "web_lookup" | "helper" | "other";
export type ChatErrorCode =
  | "not_logged_in" | "rate_limit" | "overloaded" | "billing" | "network" | "model_not_found"
  | "cli_crashed" | "cli_missing" | "mcp_unavailable" | "unknown";

export interface ChatMessage {
  id: number;
  project_id: number;
  kind: "user" | "assistant" | "action" | "permission" | "error" | "divider" | "notice" | "version" | "loop_alert" | "connect_offer";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  created_at: string;
}

export type ChatOut =
  | { type: "message"; project_id: number; message: ChatMessage }
  | { type: "update"; project_id: number; message: ChatMessage }
  | { type: "status"; project_id: number; state: ChatStatus; busy: boolean }
  | { type: "fallback"; project_id: number; reason: string }
  | { type: "mode"; project_id: number; mode: ChatMode };

export type ChatMode = "plan" | "build";

export interface ChatTarget {
  provider: Provider;
  account_id: number | null;
  account_label: string | null;
  structured: boolean;
  mode: ChatMode;
}

export const chatTarget = (projectId: number) => invoke<ChatTarget>("chat_target", { projectId });
export const chatHistory = (projectId: number, limit = 200) => invoke<ChatMessage[]>("chat_history", { projectId, limit });
export const chatBusy = (projectId: number) => invoke<boolean>("chat_busy", { projectId });
export const chatSend = (projectId: number, text: string, attachments?: string[]) =>
  invoke<void>("chat_send", attachments?.length ? { projectId, text, attachments } : { projectId, text });

export interface SavedAsset {
  path: string;
  name: string;
  kind: "image" | "document";
  size: number;
}
export const chatAttach = (projectId: number, name: string, data: string) =>
  invoke<SavedAsset>("chat_attach", { projectId, name, data });
export const chatAssetData = (projectId: number, path: string) =>
  invoke<string | null>("chat_asset_data", { projectId, path });
export const chatRetry = (projectId: number) => invoke<void>("chat_retry", { projectId });
export const chatStop = (projectId: number) => invoke<void>("chat_stop", { projectId });
export const chatSwitch = (projectId: number, provider: Provider, accountId: number | null) =>
  invoke<ChatTarget>("chat_switch", { projectId, provider, accountId });
export const permissionAnswer = (projectId: number, reqId: string, allow: boolean) =>
  invoke<void>("permission_answer", { projectId, reqId, allow });
export const chatModeSet = (projectId: number, mode: ChatMode) => invoke<void>("chat_mode_set", { projectId, mode });

// UI-kits (uiterlijk)
export type KitStack = "react-vite" | "flutter";
export interface KitCard {
  id: string;
  naam: string;
  beschrijving: string;
  label: string;
  licentie: string;
  stacks: string[];
  compatible: boolean;
  attributieVerplicht: boolean;
  installatiescripts: boolean;
  pakketten: string[];
  preview: string | null;
  kleuren: { primair: string; achtergrond: string; tekst: string };
}
export interface KitList {
  stack: KitStack | null;
  kits: KitCard[];
  geweigerd: { id: string; reden: string }[];
}
export interface KitTokens {
  kleuren: { licht: Record<string, string>; donker: Record<string, string> };
  rondingen: Record<string, string>;
  spacing: { schaal: number; eenheid: string };
  typografie: { lettertype: string };
  instellingen?: { afronding?: "scherp" | "gemiddeld" | "rond"; ruimte?: "compact" | "normaal" | "ruim" };
}
export interface KitCurrent {
  kit: { kit: string; naam: string; versie: string | null; licentie: string; stack: KitStack } | null;
  tokens: KitTokens | null;
  attributie: { required: boolean; ok: boolean };
}
export type KitApplyCode = "ok" | "refused" | "install_failed" | "checks_failed" | "no_repo";
export interface KitApplyOutcome {
  ok: boolean;
  code: KitApplyCode;
  rolledBack: boolean;
  detail?: string;
  plan?: { kitId: string; naam: string; pakketten: string[]; verwijderen: string[] };
  scriptsSkipped: string[];
  checksSkipped?: string;
  before?: string;
  version?: string;
  switched: boolean;
  shotBefore?: string | null;
  shotAfter?: string | null;
}
export interface KitTailor {
  hoofdkleur?: string;
  afronding?: "scherp" | "gemiddeld" | "rond";
  ruimte?: "compact" | "normaal" | "ruim";
  lettertype?: string;
  reset?: boolean;
}
export const kitList = (projectId: number) => invoke<KitList>("kit_list", { projectId });
export const kitCurrent = (projectId: number) => invoke<KitCurrent>("kit_current", { projectId });
export const kitApply = (projectId: number, kit: string, tailor?: KitTailor) => invoke<KitApplyOutcome>("kit_apply", { projectId, kit, tailor });
export const kitScripts = (projectId: number, packages: string[]) => invoke<{ ok: boolean; detail?: string }>("kit_scripts", { projectId, packages });
export const kitTailor = (projectId: number, tailor: KitTailor) => invoke<KitTokens>("kit_tailor", { projectId, tailor });
export interface KitFinding {
  file: string;
  line: number;
  col: number;
  rule: "kleur" | "pixels" | "lettertype" | "native" | "bibliotheek";
  message: string;
  fix: string;
}
export interface KitCheck {
  enabled: boolean;
  strengheid: "waarschuwen" | "blokkeren";
  scanned: number;
  findings: KitFinding[];
}
export const kitCheck = (projectId: number) => invoke<KitCheck>("kit_check", { projectId });
export const kitStrictness = (projectId: number, level: "waarschuwen" | "blokkeren") => invoke<{ strengheid: string }>("kit_strictness", { projectId, level });

// exporteren ("Download je project")
export interface ExportResult {
  path: string;
  files: number;
  bytes: number;
  skipped_secrets: string[];
  skipped_large: string[];
}
export const exportProject = (projectId: number, dest: string) => invoke<ExportResult>("export_project", { projectId, dest });
export async function kiesZipBestand(defaultName: string): Promise<string | null> {
  const result = await save({ defaultPath: defaultName, filters: [{ name: "Zip", extensions: ["zip"] }] });
  return typeof result === "string" ? result : null;
}

// opdracht-verbeteraar (functie 7)
export const improvePrompt = (projectId: number, text: string) => invoke<string>("improve_prompt", { projectId, text });

// veiligheidscheck (functie 6)
export type SecurityCode = "api_key" | "private_key" | "env_in_git" | "secret_file_in_git" | "secret_in_export" | "password" | "db_rules_missing" | "db_rules_open";
export interface SecurityFinding {
  code: SecurityCode;
  severity: "hoog" | "midden";
  file: string;
  line?: number;
  detail: string;
}
export interface SecurityReport {
  scanned: number;
  findings: SecurityFinding[];
}

// werkruimte: pagina's, bestanden, foto's, signalen, gegevens, beschrijving en vlaggen
export interface PageInfo {
  naam: string;
  pad: string;
  bestand: string;
}
export interface FileEntry {
  pad: string;
  grootte: number;
}
export interface FileContent {
  tekst: string;
  ingekort: boolean;
}
export interface AssetInfo {
  naam: string;
  pad: string;
  soort: string;
  grootte: number;
}
export interface ProjectSignals {
  project_md_ingevuld: boolean;
  needs_data: boolean;
  needs_data_reden: string | null;
  heeft_database: boolean;
  aantal_assets: number;
}
export interface DataFile {
  bestand: string;
  tabellen: { naam: string; rijen: number }[];
}
export interface TableRows {
  kolommen: string[];
  rijen: string[][];
  totaal: number;
}
export type ProjectFlagKey = "online_gezet" | "gegevens_aan" | "meer_onderdelen" | "start_verborgen";
export const projectPages = (projectId: number) => invoke<PageInfo[]>("project_pages", { projectId });
export const projectFiles = (projectId: number) => invoke<FileEntry[]>("project_files", { projectId });
export const projectFileRead = (projectId: number, path: string) => invoke<FileContent>("project_file_read", { projectId, path });
export const projectSignals = (projectId: number) => invoke<ProjectSignals>("project_signals", { projectId });
export const assetsList = (projectId: number) => invoke<AssetInfo[]>("assets_list", { projectId });
export const assetsDelete = (projectId: number, path: string) => invoke<void>("assets_delete", { projectId, path });
export const dataOverview = (projectId: number) => invoke<DataFile[]>("data_overview", { projectId });
export const dataRows = (projectId: number, file: string, table: string, limit = 50) => invoke<TableRows>("data_rows", { projectId, file, table, limit });
export const projectDescriptionGet = (projectId: number) => invoke<string>("project_description_get", { projectId });
export const projectDescriptionSet = (projectId: number, text: string) => invoke<void>("project_description_set", { projectId, text });
export const projectFlags = (projectId: number) => invoke<Record<string, string>>("project_flags", { projectId });
export const projectFlagSet = (projectId: number, key: ProjectFlagKey, value: string | null) => invoke<void>("project_flag_set", { projectId, key, value });

// ---------- koppelingen met diensten (GitHub, Vercel, Supabase) ----------
// Er gaat nooit een token naar de frontend; alleen het plakken van het token door de gebruiker gaat naar Rust.
export type DienstId = "github" | "vercel" | "supabase";
export type KoppelStatus = "niet_gekoppeld" | "bezig" | "werkt" | "verlopen" | "fout";
export type Strategie = "oauth_loopback_pkce" | "oauth_device" | "token_plakken";
export type KoppelBezig = { soort: "apparaat"; user_code: string; verification_uri: string; expires_in: number } | { soort: "browser"; url: string };
export interface KoppelInfo {
  id: DienstId;
  strategie: Strategie;
  status: KoppelStatus;
  account: string | null;
  /** Foutcode (nl.json: koppelingen.fout.<code>). */
  fout: string | null;
  rechten: string[];
  functies: string[];
  links: { signup: string; token_page: string; manage: string };
  bezig: KoppelBezig | null;
  verloopt: number | null;
}
export type KoppelStart = { soort: "plakken" } | { soort: "apparaat"; user_code: string; verification_uri: string; expires_in: number } | { soort: "browser"; url: string };
export const connectList = () => invoke<KoppelInfo[]>("connect_list");
export const connectStart = (id: DienstId) => invoke<KoppelStart>("connect_start", { id });
export const connectPaste = (id: DienstId, token: string) => invoke<KoppelInfo>("connect_paste", { id, token });
export const connectCancel = (id: DienstId) => invoke<void>("connect_cancel", { id });
export const connectTest = (id: DienstId) => invoke<KoppelInfo>("connect_test", { id });
export const connectTestAll = () => invoke<KoppelInfo[]>("connect_test_all");
export const connectDisconnect = (id: DienstId) => invoke<{ ingetrokken: boolean; beheer_url: string }>("connect_disconnect", { id });
export const connectOpen = (url: string) => invoke<void>("connect_open", { url });
