import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import FormattedText from "./formatText";

interface Props {
  message: ChatMessage;
  technical: boolean;
  onAnswer: (allow: boolean) => void;
}

/** Toestemmingsvraag in gewone taal met Ja en Nee. Gevaarlijke acties krijgen een duidelijke waarschuwing en "Nee" als standaardfocus. */
export default function PermissionDialog({ message, technical, onAnswer }: Props) {
  const { t } = useTranslation();
  const p = message.payload;
  const [open, setOpen] = useState(technical);
  const danger = p.danger === true;
  const kind: string = p.kind;
  const params = p.params ?? {};
  const focusFirst = useRef<HTMLButtonElement>(null);

  const isPlan = p.plan_exit === true;
  const question = String(p.outside_project ? t("chat.toestemming.vraag.buiten") : t(`chat.toestemming.vraag.${kind}`, { defaultValue: t("chat.toestemming.vraag.generic") }));
  const explain = String(t(`chat.toestemming.uitleg.${kind}`, { ...params, defaultValue: t("chat.toestemming.uitleg.generic") }));

  return (
    // Alleen "Ja" of "Nee" sluit dit venster; Escape en klikken ernaast doen niets, zodat er nooit per ongeluk iets wordt toegestaan.
    <AlertDialog open>
      <AlertDialogContent
        size="default"
        className={`sm:max-w-lg ring-2 ${danger ? "ring-destructive" : "ring-primary"}`}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusFirst.current?.focus();
        }}
      >
        <AlertDialogHeader className="text-left">
          <div className="text-sm uppercase tracking-wide text-muted-foreground">{t("chat.toestemming.titel")}</div>
          <AlertDialogTitle className="text-xl">{isPlan ? t("chat.toestemming.planTitel") : question}</AlertDialogTitle>
          <AlertDialogDescription className="text-lg text-foreground">{isPlan ? t("chat.toestemming.planUitleg") : explain}</AlertDialogDescription>
        </AlertDialogHeader>

        {isPlan && (
          <ScrollArea data-testid="plan-text" className="max-h-64 rounded-lg bg-muted p-4 text-base">
            <FormattedText text={String(p.detail ?? "")} />
          </ScrollArea>
        )}
        {p.outside_project && <p className="text-base text-warning">{t("chat.toestemming.buitenProject")}</p>}
        {danger && (
          <Alert variant="destructive" role="note">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription>{t("chat.toestemming.gevaar")}</AlertDescription>
          </Alert>
        )}
        {p.detail && !isPlan && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="link" size="sm" className="px-0">
                {t("chat.toestemming.details")}
                <ChevronDownIcon aria-hidden="true" className={open ? "rotate-180" : ""} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre data-testid="perm-details" className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground">
                {p.detail}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        <AlertDialogFooter>
          <Button ref={danger ? focusFirst : undefined} variant="outline" size="lg" className="min-w-24" onClick={() => onAnswer(false)}>
            {isPlan ? t("chat.toestemming.planNee") : t("chat.toestemming.nee")}
          </Button>
          <Button ref={danger ? undefined : focusFirst} variant={danger ? "destructive" : "default"} size="lg" className="min-w-24 font-semibold" onClick={() => onAnswer(true)}>
            {isPlan ? t("chat.toestemming.planJa") : t("chat.toestemming.ja")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
