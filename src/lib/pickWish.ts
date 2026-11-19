import type { TFunction } from "i18next";
import { chatSend, runtime } from "@/lib/api";

export interface WishTarget {
  selector: string;
  tag: string;
  text: string;
  path: string;
}

/** Stuurt de wens bij een gekozen onderdeel naar de chat, met een schermafbeelding van dat onderdeel als die te maken is. */
export async function sendWish(projectId: number, target: WishTarget, wish: string, t: TFunction): Promise<void> {
  // Zonder schermafbeelding (bijvoorbeeld geen browser) sturen we de wens toch.
  const path = await runtime<{ path: string }>(projectId, "picker.shot", { selector: target.selector, path: target.path }).then((r) => r.path).catch(() => null);
  const tekst = target.text ? ` (met de tekst ‘${target.text}’)` : "";
  const prompt = t("preview.kies.prompt", { tag: target.tag, selector: target.selector, pad: target.path, tekst, wens: wish.trim(), beeld: path ? t("preview.kies.beeld") : "" });
  await (path ? chatSend(projectId, prompt, [path]) : chatSend(projectId, prompt));
}
