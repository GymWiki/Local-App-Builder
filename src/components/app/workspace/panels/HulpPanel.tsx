import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { chatSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import Systeemcheck from "@/components/app/eerstestart/Systeemcheck";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

/** Uitleg in gewone taal, korte voorbeelden en een veld om de AI een vraag te stellen. De AI verandert er niets aan. */
export default function HulpPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [vraag, setVraag] = useState("");
  const [bezig, setBezig] = useState(false);

  async function stel() {
    if (!vraag.trim()) return;
    setBezig(true);
    try {
      await chatSend(w.project.id, t("hulp.vraag.prompt", { vraag: vraag.trim() }));
      toast.success(t("hulp.vraag.verstuurd"));
      setVraag("");
    } catch (e) {
      w.onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setBezig(false);
    }
  }

  return (
    <Frame titel={t("hulp.titel")} uitleg={t("hulp.uitleg")}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("hulp.zo.titel")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-6 text-base">
            {(["een", "twee", "drie", "vier"] as const).map((k) => (
              <li key={k}>{t(`hulp.zo.${k}`)}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <section className="space-y-2" aria-label={t("hulp.voorbeelden.titel")}>
        <h3 className="text-lg font-semibold">{t("hulp.voorbeelden.titel")}</h3>
        <ul className="flex flex-wrap gap-2">
          {(["a", "b", "c", "d"] as const).map((k) => (
            <li key={k}>
              <Button variant="outline" size="sm" className="h-auto whitespace-normal rounded-full py-2 text-left" onClick={() => setVraag(t(`hulp.voorbeelden.${k}`))}>
                {t(`hulp.voorbeelden.${k}`)}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2" aria-label={t("hulp.vraag.titel")}>
        <Field>
          <FieldLabel htmlFor="hulp-vraag" className="text-lg font-semibold">
            {t("hulp.vraag.label")}
          </FieldLabel>
          <Textarea id="hulp-vraag" rows={3} value={vraag} placeholder={t("hulp.vraag.plaats")} onChange={(e) => setVraag(e.target.value)} />
        </Field>
        <Button disabled={!vraag.trim() || bezig} onClick={() => void stel()}>
          {t("hulp.vraag.knop")}
        </Button>
      </section>
      <Card>
        <CardContent className="pt-6">
          <Systeemcheck />
        </CardContent>
      </Card>
    </Frame>
  );
}
