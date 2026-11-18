import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlugIcon } from "lucide-react";
import { chatSend, type ChatMessage, type DienstId } from "@/lib/api";
import VerbindKnop from "@/components/app/connect/VerbindKnop";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DIENSTEN: DienstId[] = ["github", "vercel", "supabase"];

/** De AI stelt een koppeling voor. De gebruiker verbindt altijd zelf; daarna kan hij de AI laten doorgaan. */
export default function ConnectOfferCard({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const id = message.payload.provider as DienstId;
  const [verbonden, setVerbonden] = useState(false);
  if (!DIENSTEN.includes(id)) return null;
  const dienst = t(`koppelingen.${id}.naam`);
  return (
    <Card data-testid="connect-offer" className="gap-0 border-2 border-primary py-0">
      <CardContent className="space-y-3 px-5 py-4">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <PlugIcon aria-hidden="true" className="size-5" />
          {t("koppelingen.kaart.titel", { dienst })}
        </p>
        {typeof message.payload.reason === "string" && message.payload.reason && (
          <p className="text-base text-muted-foreground">
            {t("koppelingen.kaart.redenVoorloop")} {message.payload.reason}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <VerbindKnop id={id} onConnected={() => setVerbonden(true)} />
          {verbonden && (
            <Button variant="outline" onClick={() => void chatSend(message.project_id, t("koppelingen.kaart.doorgaan", { dienst })).catch(() => undefined)}>
              {t("koppelingen.knop.verder")}
            </Button>
          )}
        </div>
        {verbonden && <p className="text-base">{t("koppelingen.kaart.verbonden", { dienst })}</p>}
      </CardContent>
    </Card>
  );
}
