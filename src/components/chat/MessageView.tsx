import AssetThumb from "./AssetThumb";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../lib/api";
import ActionCard from "./ActionCard";
import ErrorCard from "./ErrorCard";
import FormattedText from "./formatText";
import LoopAlertCard from "./LoopAlertCard";

interface Props {
  message: ChatMessage;
  live: boolean;
  technical: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpenAccounts: () => void;
  loop?: { active: boolean; onRestore: (hash: string, title: string) => Promise<void> | void; onDiscuss: () => void; onOtherAi: () => void };
}

export default function MessageView({ message, live, technical, canRetry, onRetry, onOpenAccounts, loop }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  switch (message.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div data-testid="bubble-user" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-700 px-5 py-3 text-lg leading-relaxed text-white">
            {Array.isArray(p.attachments) && p.attachments.length > 0 && (
              <ul aria-label={t("chat.bijlage.lijst")} className="mb-2 flex flex-wrap gap-2">
                {p.attachments.map((a: { path: string; name: string; kind: string }) => (
                  <li key={a.path}>
                    <AssetThumb projectId={message.project_id} path={a.path} name={a.name} kind={a.kind} size="groot" />
                  </li>
                ))}
              </ul>
            )}
            {p.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="flex justify-start">
          <div data-testid="bubble-ai" className="max-w-[90%] rounded-2xl rounded-bl-sm bg-zinc-800 px-5 py-3 text-lg leading-relaxed text-zinc-100">
            <FormattedText text={p.text ?? ""} />
          </div>
        </div>
      );
    case "action":
      return <ActionCard message={message} live={live} technical={technical} />;
    case "permission":
      return (
        <div data-testid="permission-record" className="px-2 text-sm text-zinc-400">
          🔒 {t(`chat.toestemming.${p.state === "allowed" ? "toegestaan" : p.state === "denied" ? "geweigerd" : p.state === "expired" ? "verlopen" : "titel"}`)}
          {technical && p.detail ? ` — ${String(p.detail).slice(0, 80)}` : ""}
        </div>
      );
    case "error":
      return <ErrorCard message={message} technical={technical} canRetry={canRetry} onRetry={onRetry} onOpenAccounts={onOpenAccounts} />;
    case "version":
      return (
        <div data-testid="version-line" className="flex items-center gap-2 px-2 text-sm text-zinc-300">
          <span aria-hidden="true">💾</span>
          <span>{t("chat.versieOpgeslagen", { titel: p.title })}</span>
        </div>
      );
    case "loop_alert":
      return loop ? (
        <LoopAlertCard message={message} active={loop.active} onRestore={loop.onRestore} onDiscuss={loop.onDiscuss} onOtherAi={loop.onOtherAi} />
      ) : null;
    case "divider":
      return (
        <div role="separator" className="flex items-center gap-3 py-2 text-sm text-zinc-400">
          <span className="h-px flex-1 bg-zinc-700" />
          <span>{p.kind === "switched" ? t("chat.scheiding.gewisseld", { ai: `${p.provider}${p.label ? ` · ${p.label}` : ""}` }) : t("chat.scheiding.nieuw")}</span>
          <span className="h-px flex-1 bg-zinc-700" />
        </div>
      );
    default:
      return null; // "notice" (terugval) wordt in het paneel zelf getoond
  }
}
