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

export interface McpInfo {
  state: "starting" | "running" | "connected" | "unavailable";
  port: number | null;
  error: string | null;
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
