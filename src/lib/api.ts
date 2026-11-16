import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface Project {
  id: number;
  naam: string;
  pad: string;
  template: string;
  created_at: string;
}

export const listProjects = () => invoke<Project[]>("list_projects");

export const createProject = (naam: string, bovenliggendePad: string, template?: string) =>
  invoke<Project>("create_project", { naam, bovenliggendePad, template });

export const deleteProject = (id: number) => invoke<void>("delete_project", { id });

export async function kiesMap(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
