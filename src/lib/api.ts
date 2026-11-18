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
export type ProjectFlagKey = "online_gezet" | "gegevens_aan" | "meer_onderdelen" | "start_verborgen" | "route_plan" | "over_idee" | "over_plan" | "over_uiterlijk" | "over_bouwen" | "over_aanpassen" | "over_gegevens" | "over_testen" | "over_delen";
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

// ---------- Supabase (eigen account van de gebruiker; Studio voert alle acties uit, sleutels blijven in de kluis) ----------
export type SupaNiveau = "voorzichtig" | "zelfstandig" | "volledig";
export interface SupaState {
  gekoppeld: boolean;
  naam: string;
  referentie: string;
  regio: string;
  niveau: SupaNiveau;
  volledig_resterend: number | null;
  volledig_secs: number;
}
export interface SupaChange {
  code: string;
  params: Record<string, string>;
}
export interface SupaFinding {
  code: string;
  tabel: string | null;
  ernst: "waarschuw" | "weiger";
}
export interface SupaConfirm {
  id: string;
  project_id: number;
  tool: string;
  actor: "ai" | "gebruiker";
  class: number;
  level: SupaNiveau;
  redenen: string[];
  changes: SupaChange[];
  rijen: number | null;
  verlies: boolean;
  backup: "gemaakt" | "mislukt" | "niet_nodig";
  kosten: { plan: "gratis_plan" | "betaald_plan" | "onbekend_plan"; per_maand: number | null } | null;
  waarschuwingen: SupaFinding[];
  sql: string;
  uitleg: string;
}
export interface SupaReply {
  status: "uitgevoerd" | "geweigerd" | "mislukt";
  tekst: string;
  data?: unknown;
}
export interface SupaAction {
  id: number;
  at: number;
  tool: string;
  class: number;
  level: string;
  status: string;
  summary: SupaChange[] | null;
  detail: { code?: string; backup?: string } | null;
  kan_ongedaan: boolean;
  undone: boolean;
}
export interface SupaProject {
  reference: string;
  name: string;
  region: string;
  status: string;
}
export interface SupaTable {
  tabel: string;
  rls: boolean;
  rijen: number | null;
  kolommen: { kolom: string; type: string; verplicht: boolean }[];
  beleid: unknown[];
}
export interface SupaRows {
  kolommen: string[];
  rijen: string[][];
  meer: boolean;
  pagina: number;
}
export const supaState = (projectId: number) => invoke<SupaState>("supa_state", { projectId });
export const supaProjects = () => invoke<{ projecten?: SupaProject[]; organisaties?: { slug: string; name: string; plan: string | null }[]; fout?: string }>("supa_projects");
export const supaLink = (projectId: number, reference: string) => invoke<SupaReply>("supa_link", { projectId, reference });
export const supaCreate = (projectId: number, naam: string) => invoke<SupaReply>("supa_create", { projectId, naam });
export const supaUnlink = (projectId: number) => invoke<void>("supa_unlink", { projectId });
export const supaWake = (projectId: number) => invoke<SupaReply>("supa_wake", { projectId });
export const supaSetLevel = (projectId: number, niveau: SupaNiveau, bevestiging?: string) => invoke<void>("supa_set_level", { projectId, niveau, bevestiging });
export const supaSetDuration = (projectId: number, seconden: number) => invoke<void>("supa_set_duration", { projectId, seconden });
export const supaEmergency = (projectId: number) => invoke<void>("supa_emergency", { projectId });
export const supaActions = (projectId: number) => invoke<SupaAction[]>("supa_actions", { projectId });
export const supaUndo = (projectId: number, actie: number) => invoke<SupaReply>("supa_undo", { projectId, actie });
export const supaConfirmAnswer = (id: string, toestaan: boolean) => invoke<boolean>("supa_confirm_answer", { id, toestaan });
export const supaTables = (projectId: number) => invoke<{ tabellen?: SupaTable[]; fout?: string }>("supa_tables", { projectId });
export const supaRows = (projectId: number, tabel: string, pagina: number) => invoke<SupaRows & { fout?: string }>("supa_rows", { projectId, tabel, pagina });
export const supaRowSave = (projectId: number, tabel: string, sleutel: Record<string, string> | null, waarden: Record<string, string | null>) => invoke<SupaReply>("supa_row_save", { projectId, tabel, sleutel, waarden });
export const supaUsers = (projectId: number) => invoke<{ gebruikers?: Record<string, string | null>[]; fout?: string }>("supa_users", { projectId });
export const supaSecurityCheck = (projectId: number) => invoke<{ bevindingen?: { code: string; tabel: string }[]; fout?: string }>("supa_security_check", { projectId });
export const supaSql = (projectId: number, sql: string) => invoke<SupaReply>("supa_sql", { projectId, sql });
export const supaAuthSkill = (projectId: number, aan: boolean) => invoke<boolean>("supa_auth_skill", { projectId, aan });
export const supaStatus = (projectId: number) => invoke<SupaReply>("supa_status", { projectId });
export const supaWriteConfig = (projectId: number) => invoke<SupaReply>("supa_write_config", { projectId });
export const projectStorageGet = (projectId: number) => invoke<"lokaal" | "online" | null>("project_storage_get", { projectId });
export const projectStorageSet = (projectId: number, keuze: "lokaal" | "online") => invoke<void>("project_storage_set", { projectId, keuze });

// ---------- GitHub-back-up ----------
// Het token blijft in Rust. De frontend krijgt alleen codes en gewone gegevens.
export interface GhLink {
  eigenaar: string;
  repo: string;
  privaat: boolean;
  url: string;
  tak: string;
  laatste: number | null;
  laatste_aantal: number | null;
  auto: boolean;
  ai_vraagt: boolean;
  uiteengelopen: "uiteengelopen" | "online_nieuwer" | null;
  probleem: string | null;
}
export interface GhState {
  werkt: boolean;
  account: string | null;
  link: GhLink | null;
  versies: number;
  nieuw: number;
  bezig: boolean;
  nu: number;
}
/** Het resultaat van een actie; de tekst staat in nl.json (github.uitkomst.<code>). */
export interface GhUitkomst {
  status: "uitgevoerd" | "geweigerd" | "mislukt" | "wacht";
  code: string;
  params: Record<string, unknown>;
}
export interface GhRepo {
  eigenaar: string;
  naam: string;
  privaat: boolean;
  beschrijving: string;
  bijgewerkt: string;
}
export const githubState = (projectId: number) => invoke<GhState>("github_state", { projectId });
export const githubSuggestName = (projectId: number, naam?: string) => invoke<{ naam: string; geldig?: boolean; vrij?: boolean | null; fout?: string }>("github_suggest_name", { projectId, naam: naam ?? null });
export const githubFirstBackup = (projectId: number, naam: string, openbaar: boolean, openbaarBevestigd: boolean) => invoke<GhUitkomst>("github_first_backup", { projectId, naam, openbaar, openbaarBevestigd });
export const githubBackup = (projectId: number) => invoke<GhUitkomst>("github_backup", { projectId });
export const githubUnlink = (projectId: number) => invoke<void>("github_unlink", { projectId });
export const githubSetAuto = (projectId: number, aan: boolean) => invoke<void>("github_set_auto", { projectId, aan });
export const githubSetAiAsk = (projectId: number, vraagt: boolean) => invoke<void>("github_set_ai_ask", { projectId, vraagt });
export const githubListRepos = () => invoke<{ repos?: GhRepo[]; fout?: string }>("github_list_repos");
export const actieConfirmAnswer = (id: string, toestaan: boolean) => invoke<boolean>("actie_confirm_answer", { id, toestaan });
export const githubScan = (projectId: number, openbaar: boolean) => invoke<{ gescand?: number; blokkades?: { bestand: string; regel: number | null; soort: string; historie: boolean }[]; waarschuwingen?: { bestand: string; regel: number | null; soort: string; historie: boolean }[]; te_groot?: [string, number][]; groot?: [string, number][]; gitignore_ontbreekt?: number; fout?: string }>("github_scan", { projectId, openbaar });
export interface GhHerkend {
  soort: string;
  template: string;
  studio_json: boolean;
  niet_herkend: string[];
}
export const githubImport = (eigenaar: string, repo: string, privaat: boolean, bovenliggendPad: string) => invoke<{ project?: Project; herkend?: GhHerkend; fout?: string }>("github_import", { eigenaar, repo, privaat, bovenliggendPad });

// ---------- Online zetten met Vercel ----------
// Tokens en waarden van omgevingsvariabelen blijven in Rust; de frontend krijgt alleen codes en gewone gegevens.
export interface VercelLog {
  id: number;
  at: number;
  target: "preview" | "production";
  deployment_id: string | null;
  url: string | null;
  state: string;
  checkpoint: string | null;
  code: string;
}
export interface VercelState {
  werkt: boolean;
  account: string | null;
  project: string | null;
  flutter: boolean;
  server_deel: boolean;
  ontbrekend: string[];
  voorbeeld: VercelLog | null;
  live: VercelLog | null;
  laatste: VercelLog | null;
  bezig: boolean;
  nu: number;
}
export interface VercelUitkomst {
  status: "uitgevoerd" | "geweigerd" | "mislukt";
  code: string;
  params: Record<string, unknown>;
}
export interface VercelEnv {
  naam: string;
  soort: "openbaar" | "server";
  bron: string;
  omgevingen: string[];
  gezet: number;
  doorgestuurd: number | null;
}
export interface VercelVersie {
  id: string;
  adres: string;
  doel: string;
  status: string;
  gemaakt: number;
  versie: string | null;
}
export const vercelState = (projectId: number) => invoke<VercelState>("vercel_state", { projectId });
export const vercelDeploy = (projectId: number, doelNaam: "preview" | "live", bevestigd: boolean) => invoke<VercelUitkomst>("vercel_deploy", { projectId, doelNaam, bevestigd });
export const vercelCancel = (projectId: number) => invoke<void>("vercel_cancel", { projectId });
export const vercelDeployments = (projectId: number) => invoke<{ lijst?: VercelVersie[]; fout?: string }>("vercel_deployments", { projectId });
export const vercelRollback = (projectId: number, deploymentId: string, bevestigd: boolean) => invoke<VercelUitkomst>("vercel_rollback", { projectId, deploymentId, bevestigd });
export const vercelBuildSummary = (projectId: number) => invoke<{ soort?: string; regels?: string[]; fout?: string }>("vercel_build_summary", { projectId });
export const vercelEnvList = (projectId: number) => invoke<VercelEnv[]>("vercel_env_list", { projectId });
export const vercelEnvSet = (projectId: number, naam: string, waarde: string, soort: "openbaar" | "server", omgevingen: string[], bevestigd: boolean) => invoke<VercelUitkomst>("vercel_env_set", { projectId, naam, waarde, soort, omgevingen, bevestigd });
export const vercelEnvRemove = (projectId: number, naam: string) => invoke<void>("vercel_env_remove", { projectId, naam });
export const vercelEnvSupabase = (projectId: number, bevestigd: boolean) => invoke<VercelUitkomst>("vercel_env_supabase", { projectId, bevestigd });
export const vercelDomainAdd = (projectId: number, domein: string) => invoke<{ naam?: string; geverifieerd?: boolean; regels?: { type: string; naam: string; waarde: string }[]; fout?: string }>("vercel_domain_add", { projectId, domein });
export const vercelDomainCheck = (projectId: number, domein: string) => invoke<{ naam?: string; geverifieerd?: boolean; regels?: { type: string; naam: string; waarde: string }[]; fout?: string }>("vercel_domain_check", { projectId, domein });
export const vercelUnlink = (projectId: number) => invoke<void>("vercel_unlink", { projectId });

// ---------- bijwerken van Studio zelf ----------
export interface UpdateInfo {
  status: "actueel" | "beschikbaar" | "niet_ingesteld" | "dev" | "fout";
  versie_nu: string;
  nieuw: string | null;
  notities: string | null;
  datum: string | null;
}
export const updateCheck = () => invoke<UpdateInfo>("update_check");
export const updateInstall = () => invoke<void>("update_install");

// ---------- In de appwinkel (Google Play en App Store) ----------
export interface WinkelAppData {
  app_naam: string;
  android_id: string;
  ios_id: string;
  categorie_play: string;
  categorie_apple: string;
  contact_email: string;
  website: string;
  privacy_url: string;
  support_url: string;
  leeftijd_ingevuld: boolean;
  heeft_login: boolean;
  demo_account_gezet: boolean;
  bevestigd: Record<string, boolean>;
  talen: string[];
}
export type WinkelPuntStatus = "klaar" | "let_op" | "ontbreekt" | "handmatig";
export interface WinkelPunt {
  id: string;
  status: WinkelPuntStatus;
  detail: Record<string, unknown> | null;
}
export interface WinkelStand {
  winkel: "play" | "appstore";
  punten: WinkelPunt[];
  klaar: number;
  totaal: number;
}
export interface WinkelKaart {
  id: string;
  winkels: ("play" | "appstore")[];
  antwoord: "ja" | "nee" | "controleer";
  redenen: string[];
}
export interface WinkelBevinding {
  code: string;
  ernst: "fout" | "let_op";
  detail: string | null;
}
export interface WinkelOverzicht {
  data: WinkelAppData;
  winkels: WinkelStand[];
  invulhulp: { signalen: { permissies: string[]; pakketten: string[]; onderwerpen: string[] }; kaarten: WinkelKaart[] };
  veilig: WinkelBevinding[];
  versie: { naam: string; build: number } | null;
  nodig: Record<string, { kosten: string; bron: string; geverifieerd: boolean }>;
  spec: { versie: number; datum: string; talen: string[]; app_id: unknown };
}
export interface WinkelTelling {
  aantal: number;
  min: number;
  max: number;
  eenheid: "tekens" | "bytes";
  oordeel: "goed" | "te_kort" | "te_lang" | "leeg";
}
export interface WinkelVersie {
  id: number;
  tekst: string;
  status: "concept" | "goedgekeurd" | "vervangen";
  bron: "ai" | "gebruiker";
  at: number;
}
export interface WinkelVeldStand {
  veld: string;
  officieel: string;
  goedgekeurd: WinkelVersie | null;
  concept: WinkelVersie | null;
  telling: WinkelTelling | null;
  min: number;
  max: number;
  eenheid: "tekens" | "bytes";
  geverifieerd: boolean;
  bron: string;
}
export const winkelsOverzicht = (projectId: number) => invoke<WinkelOverzicht>("winkels_overzicht", { projectId });
export const winkelsBewaar = (projectId: number, data: WinkelAppData) => invoke<{ ok?: boolean; fout?: string; veld?: string; code?: string }>("winkels_bewaar", { projectId, data });
export const winkelsAppIdVoorstel = (domein: string, naam: string) => invoke<{ voorstel: string; android: { geldig: boolean; code: string; let_op: string | null }; ios: { geldig: boolean; code: string; let_op: string | null } }>("winkels_app_id_voorstel", { domein, naam });
export const winkelsVersieOphogen = (projectId: number, hoe: "build" | "patch" | "minor" | "major") => invoke<{ oud?: string; nieuw?: string; fout?: string }>("winkels_versie_ophogen", { projectId, hoe });
export const winkelsTeksten = (projectId: number, winkel: string, taal: string) => invoke<WinkelVeldStand[]>("winkels_teksten", { projectId, winkel, taal });
export const winkelsTekstConcept = (projectId: number, winkel: string, taal: string, veld: string, tekst: string) => invoke<{ id?: number; fout?: string }>("winkels_tekst_concept", { projectId, winkel, taal, veld, tekst });
export const winkelsTekstGoedkeuren = (projectId: number, id: number) => invoke<{ ok?: boolean; fout?: string }>("winkels_tekst_goedkeuren", { projectId, id });
export const winkelsTekstOntgrendel = (projectId: number, winkel: string, taal: string, veld: string) => invoke<{ ok?: boolean; fout?: string }>("winkels_tekst_ontgrendel", { projectId, winkel, taal, veld });
export const winkelsTekstGeschiedenis = (projectId: number, winkel: string, taal: string, veld: string) => invoke<WinkelVersie[]>("winkels_tekst_geschiedenis", { projectId, winkel, taal, veld });

// ---------- systeemcheck (eerste start en Hulp) ----------
export interface SysteemPunt {
  id: "node" | "git" | "ai" | "internet" | "schijf" | "rechten";
  status: "ok" | "let_op" | "fout";
  detail: string | null;
}
export interface SysteemRapport {
  punten: SysteemPunt[];
  klaar: boolean;
}
export const systemCheck = () => invoke<SysteemRapport>("system_check");

// ---------- de route van idee tot app ----------
export const routeFeiten = (projectId: number) => invoke<import("./route").RouteFeiten>("route_feiten", { projectId });
