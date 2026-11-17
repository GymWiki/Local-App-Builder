import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, LoaderIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Props {
  message: ChatMessage;
  /** Nog bezig (de AI werkt nu)? Anders tonen we een "bezig"-kaart uit een oude sessie als klaar. */
  live: boolean;
  /** "Technisch"-stand: details staan standaard open. */
  technical: boolean;
}

/** Eén ding dat de AI deed ("Pagina gemaakt: index.html"), met uitklapbare details. */
export default function ActionCard({ message, live, technical }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  const [open, setOpen] = useState(technical);
  const state: "running" | "done" | "error" = p.state === "running" && !live ? "done" : p.state;
  const kind: string = p.kind;
  const params = p.params ?? {};

  let title: string;
  if (kind === "run_checks" && p.fixed) title = t("chat.actie.run_checks_fixed");
  else if (kind === "run_checks" && state === "error") title = t("chat.actie.run_checks_error");
  else if ((kind === "file_created" || kind === "file_edited") && params.page) title = t(`chat.actie.${kind}_page`, { file: params.file });
  else if (kind === "save_version" && !params.message) title = t("chat.actie.save_version_leeg");
  else title = String(t(`chat.actie.${kind}`, { ...params, defaultValue: t("chat.actie.other") }));

  const Icon = state === "running" ? LoaderIcon : state === "error" ? AlertTriangleIcon : CheckIcon;
  const tone = state === "error" ? "ring-warning bg-warning/10" : p.fixed ? "ring-success/50 bg-success/10" : "";
  const hasDetails = !!(p.detail || p.summary);

  return (
    <Collapsible open={open && hasDetails} onOpenChange={setOpen} asChild>
      <Card data-testid="action-card" data-state={state} size="sm" className={`gap-0 py-0 ${tone}`}>
        <CardContent className="px-4 py-2 text-base">
          <div className="flex items-center gap-3">
            <Icon aria-hidden="true" className={`size-5 shrink-0 ${state === "running" ? "animate-spin" : ""}`} />
            <span className="flex-1">
              {title}
              <span className="sr-only">{state === "running" ? ` — ${t("chat.actieBezig")}` : state === "error" ? ` — ${t("chat.actieMislukt")}` : ` — ${t("chat.actieKlaar")}`}</span>
            </span>
            {hasDetails && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="xs" aria-expanded={open}>
                  {open ? t("chat.verberg") : t("chat.details")}
                  <ChevronDownIcon aria-hidden="true" className={open ? "rotate-180" : ""} />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
          {state === "error" && !p.fixed && <p className="mt-1 text-sm text-warning">{t("chat.actieMislukt")}</p>}
          <CollapsibleContent>
            {hasDetails && (
              <pre data-testid="action-details" className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">
                {[p.detail, p.summary].filter(Boolean).join("\n\n")}
              </pre>
            )}
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
