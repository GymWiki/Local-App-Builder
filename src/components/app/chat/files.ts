/** Beperkingen voor bijlagen (de Rust-kant controleert alles nog eens; dit is om snel te kunnen waarschuwen). */
export const MAX_FILES = 6;
export const MAX_IMAGE_MB = 10;
export const MAX_DOC_MB = 5;
const IMAGE = ["png", "jpg", "jpeg", "gif", "webp"];
const DOC = ["pdf", "txt", "md", "csv", "json"];

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
}

export type Check = { ok: true } | { ok: false; reason: "type" | "size"; max?: number };

export function checkFile(name: string, size: number): Check {
  const e = extOf(name);
  const isImg = IMAGE.includes(e);
  if (!isImg && !DOC.includes(e)) return { ok: false, reason: "type" };
  const max = isImg ? MAX_IMAGE_MB : MAX_DOC_MB;
  return size > max * 1024 * 1024 ? { ok: false, reason: "size", max } : { ok: true };
}

/** Leest een bestand als base64 (zonder "data:"-voorvoegsel). */
export function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("lezen mislukt"));
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}

/** Geplakte schermafbeeldingen hebben vaak geen naam ("image.png"); geef ze een duidelijke. */
export function pastedName(file: File, n: number): string {
  const e = extOf(file.name) || (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
  return file.name && extOf(file.name) && file.name !== `image.${e}` ? file.name : `plaatje-${n}.${e}`;
}
