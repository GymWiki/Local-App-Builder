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

export async function kiesMap(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
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
  kind: "user" | "assistant" | "action" | "permission" | "error" | "divider" | "notice" | "version" | "loop_alert";
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
