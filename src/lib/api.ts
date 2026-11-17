import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
  status: "passed" | "failed" | "timeout" | "skipped";
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
