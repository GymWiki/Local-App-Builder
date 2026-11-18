import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { chatSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

/** De appwinkel (Android en iPhone) bestaat nog niet: een nette pagina die uitlegt wat er komt en laat de AI alvast helpen. */
export default function AppwinkelPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  async function vraag() {
    try {
      await chatSend(w.project.id, t("appwinkel.nu.prompt"));
      toast.success(t("appwinkel.nu.verstuurd"));
    } catch (e) {
      w.onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }
  return (
    <Frame titel={t("appwinkel.titel")} badge={t("appwinkel.badge")} uitleg={t("appwinkel.uitleg")}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("appwinkel.nodig.titel")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-6 text-base">
            {(["een", "twee", "drie", "vier"] as const).map((k) => (
              <li key={k}>{t(`appwinkel.nodig.${k}`)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("appwinkel.nu.titel")}</CardTitle>
          <CardDescription className="text-base">{t("appwinkel.nu.uitleg")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void vraag()}>
            {t("appwinkel.nu.knop")}
          </Button>
        </CardContent>
      </Card>
    </Frame>
  );
}
