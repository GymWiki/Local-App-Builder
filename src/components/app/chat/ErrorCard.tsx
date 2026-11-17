import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Props {
  message: ChatMessage;
  technical: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpenAccounts: () => void;
}

/** Een fout in mensentaal, met een knop om het opnieuw te proberen en de technische details uitklapbaar. */
export default function ErrorCard({ message, technical, canRetry, onRetry, onOpenAccounts }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(technical);
  const code: string = message.payload.code ?? "unknown";
  const tech: string = message.payload.technical ?? "";
  const known = t(`chat.fout.${code}.titel`, { defaultValue: "" });
  const base = known ? code : "unknown";

  return (
    <Alert variant="destructive" data-testid="error-card" className="border-destructive/50 bg-destructive/10">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle className="text-base font-semibold">{t(`chat.fout.${base}.titel`)}</AlertTitle>
      <AlertDescription className="space-y-3 text-base text-foreground">
        <p>{t(`chat.fout.${base}.uitleg`)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {canRetry && message.payload.retry !== false && <Button onClick={onRetry}>{t("chat.fout.opnieuw")}</Button>}
          {code === "not_logged_in" && (
            <Button variant="outline" onClick={onOpenAccounts}>
              {t("chat.fout.not_logged_in.knop")}
            </Button>
          )}
          {tech && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" aria-expanded={open}>
                  {t("chat.fout.technisch")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre data-testid="error-details" className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">
                  {tech}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
