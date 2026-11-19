import { SparklesIcon, UserIcon, LockIcon, SaveIcon } from "lucide-react";
import AssetThumb from "./AssetThumb";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "@/lib/api";
import ActionCard from "./ActionCard";
import ErrorCard from "./ErrorCard";
import FormattedText from "./formatText";
import LoopAlertCard from "./LoopAlertCard";
import GebruikRegel from "./GebruikRegel";
import ConnectOfferCard from "./ConnectOfferCard";

interface Props {
  message: ChatMessage;
  live: boolean;
  technical: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpenAccounts: () => void;
  usage?: { active: boolean; onSplit: () => void };
  loop?: { active: boolean; onRestore: (hash: string, title: string) => Promise<void> | void; onDiscuss: () => void; onNewApproach: () => void; onOtherAi: () => void };
}

export default function MessageView({ message, live, technical, canRetry, onRetry, onOpenAccounts, loop, usage }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  switch (message.kind) {
    case "user":
      return (
        <div className="flex items-end justify-end gap-2">
          <Card data-testid="bubble-user" className="max-w-[85%] gap-0 rounded-br-sm bg-primary py-0 text-primary-foreground ring-0">
            <CardContent className="px-5 py-3 text-lg leading-relaxed whitespace-pre-wrap">
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
            </CardContent>
          </Card>
          <Avatar aria-hidden="true" className="size-9 shrink-0">
            <AvatarFallback>
              <UserIcon />
            </AvatarFallback>
          </Avatar>
        </div>
      );
    case "connect_offer":
      return <ConnectOfferCard message={message} />;
    case "assistant":
      return (
        <div className="flex items-end justify-start gap-2">
          <Avatar aria-hidden="true" className="size-9 shrink-0">
            <AvatarFallback className="bg-accent text-accent-foreground">
              <SparklesIcon />
            </AvatarFallback>
          </Avatar>
          <Card data-testid="bubble-ai" className="max-w-[90%] gap-0 rounded-bl-sm bg-muted py-0 text-foreground ring-0">
            <CardContent className="px-5 py-3 text-lg leading-relaxed">
              <FormattedText text={p.text ?? ""} />
            </CardContent>
          </Card>
        </div>
      );
    case "action":
      return <ActionCard message={message} live={live} technical={technical} />;
    case "permission":
      return (
        <div data-testid="permission-record" className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-4" /> {t(`chat.toestemming.${p.state === "allowed" ? "toegestaan" : p.state === "denied" ? "geweigerd" : p.state === "expired" ? "verlopen" : "titel"}`)}
          {technical && p.detail ? ` — ${String(p.detail).slice(0, 80)}` : ""}
        </div>
      );
    case "error":
      return <ErrorCard message={message} technical={technical} canRetry={canRetry} onRetry={onRetry} onOpenAccounts={onOpenAccounts} />;
    case "version":
      return (
        <div data-testid="version-line" className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <SaveIcon aria-hidden="true" className="size-4" />
          <span>{t("chat.versieOpgeslagen", { titel: p.title })}</span>
        </div>
      );
    case "usage":
      return usage ? <GebruikRegel message={message} active={usage.active} onSplit={usage.onSplit} /> : null;
    case "loop_alert":
      return loop ? (
        <LoopAlertCard message={message} active={loop.active} onRestore={loop.onRestore} onDiscuss={loop.onDiscuss} onNewApproach={loop.onNewApproach} onOtherAi={loop.onOtherAi} />
      ) : null;
    case "divider":
      return (
        <div role="separator" className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
          <Separator className="flex-1" />
          <span>{p.kind === "switched" ? t("chat.scheiding.gewisseld", { ai: `${p.provider}${p.label ? ` · ${p.label}` : ""}` }) : t("chat.scheiding.nieuw")}</span>
          <Separator className="flex-1" />
        </div>
      );
    default:
      return null; // "notice" (terugval) wordt in het paneel zelf getoond
  }
}
