export interface ScanFinding {
  file: string;
  line: number;
  col: number;
  rule: "kleur" | "pixels" | "lettertype" | "native" | "bibliotheek";
  message: string;
  fix: string;
}
export interface ScanConfig {
  vervangNative?: Record<string, string>;
  verbodenImports?: string[];
}
export const SCAN_EXT: RegExp;
export const SKIP: RegExp;
export const RULE_TITLES: Record<string, string>;
export function stripComments(text: string, isCss: boolean): string;
export function scanSource(file: string, text: string, cfg?: ScanConfig): ScanFinding[];
