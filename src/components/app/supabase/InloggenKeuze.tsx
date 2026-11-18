import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { chatSend, supaAuthSkill } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** Optioneel: e-mail-inloggen voor de gebruikers van de app. Er gebeurt niets tot de gebruiker op de knop drukt. */
export default function InloggenKeuze({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" data-testid="inloggen-keuze">
      <h3 className="text-lg font-semibold">{t("gegevens.inloggen.titel")}</h3>
      <p className="text-base text-muted-foreground">{t("gegevens.inloggen.uitleg")}</p>
      <p className="text-sm text-muted-foreground">{t("gegevens.inloggen.uitlegMail")}</p>
      <Button
        variant="outline"
        onClick={() =>
          void supaAuthSkill(projectId, true)
            .then(() => chatSend(projectId, t("gegevens.inloggen.prompt")))
            .then(() => toast.success(t("gegevens.inloggen.verstuurd")))
            .catch(() => undefined)
        }
      >
        {t("gegevens.inloggen.knop")}
      </Button>
    </section>
  );
}
