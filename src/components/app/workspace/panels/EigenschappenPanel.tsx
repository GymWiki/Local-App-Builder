import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Eigenschappen van het gekozen onderdeel. (Wordt in een volgende stap gevuld met de gegevens van de element-kiezer.) */
export default function EigenschappenPanel() {
  const { t } = useTranslation();
  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">{t("eigenschappen.titel")}</h2>
        <p className="text-base text-muted-foreground">
          {t("eigenschappen.uitleg")}
        </p>
      </div>
    </ScrollArea>
  );
}
