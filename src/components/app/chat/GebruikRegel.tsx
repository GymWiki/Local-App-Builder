import { useTranslation } from "react-i18next";
import type { ChatMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fmt = (v: number) => v.toLocaleString("nl-NL");

/** Eén rustige regel onder een klus: hoeveel AI-gebruik het kostte (echte cijfers van de AI), en bij een grote klus een voorstel. */
export default function GebruikRegel({ message, active, onSplit }: { message: ChatMessage; active: boolean; onSplit: () => void }) {
  const { t } = useTranslation();
  const p = message.payload;
  const groot = p.groot === true;
  return (
    <div data-testid="gebruik-regel" className="space-y-2 text-sm text-muted-foreground">
      <p>{t("chat.gebruik.regel", { totaal: fmt(n(p.totaal)), nieuw: fmt(n(p.nieuw)), hergebruikt: fmt(n(p.hergebruikt)) })}</p>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            {t("chat.gebruik.uitleg")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p>{t("chat.gebruik.tekst")}</p>
        </CollapsibleContent>
      </Collapsible>
      {groot && (
        <div className="space-y-2 rounded-lg border border-warning bg-warning/10 p-3 text-base text-foreground" data-testid="gebruik-groot">
          <p>{t("chat.gebruik.groot", { beurten: n(p.beurten) })}</p>
          {active && (
            <Button size="sm" onClick={onSplit}>
              {t("chat.gebruik.splits")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
