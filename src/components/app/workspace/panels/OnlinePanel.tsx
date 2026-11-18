import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, CircleIcon } from "lucide-react";
import { stappen } from "@/lib/menu";
import PublishPanel from "@/components/app/PublishPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "../workspace-context";
import Frame from "./Frame";

function Regel({ klaar, children, id }: { klaar: boolean; children: React.ReactNode; id: string }) {
  return (
    <li data-regel={id} data-klaar={klaar ? "ja" : "nee"} className="flex items-start gap-3 text-base">
      <span className={`mt-0.5 ${klaar ? "text-success" : "text-muted-foreground"}`}>{klaar ? <CheckIcon aria-hidden="true" className="size-5" /> : <CircleIcon aria-hidden="true" className="size-5" />}</span>
      <span>{children}</span>
    </li>
  );
}

/** Checklist en stappen om online te komen, met daaronder de bestaande kopie en veiligheidscheck. Sleutels verschijnen pas als ze nodig zijn. */
export default function OnlinePanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [veilig, setVeilig] = useState(false);
  const [kopie, setKopie] = useState(false);
  const voorbeeld = stappen(w.signalen)[1].klaar;
  const online = w.signalen.online;
  // Een plek kiezen kan pas nadat de rest klaar is; pas dan hebben we een inlogsleutel nodig.
  const sleutelsNodig = voorbeeld && veilig && kopie;

  return (
    <Frame titel={t("online.titel")} uitleg={t("online.uitleg")}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("online.checklist.titel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2" data-testid="online-checklist">
            <Regel id="voorbeeld" klaar={voorbeeld}>
              {t("online.checklist.voorbeeld")}
            </Regel>
            <Regel id="veilig" klaar={veilig}>
              {t("online.checklist.veilig")}
            </Regel>
            <Regel id="kopie" klaar={kopie}>
              {t("online.checklist.kopie")}
            </Regel>
            <Regel id="plek" klaar={online}>
              {t("online.checklist.plek")}
            </Regel>
          </ul>
          <p className="text-base text-muted-foreground">{t("online.nogNiet")}</p>
          <div className="flex items-center gap-3">
            <Checkbox
              id="online-klaar"
              checked={online}
              onCheckedChange={(c) => {
                void w.setVlag("online_gezet", c === true ? "1" : null).then(() => c === true && toast.success(t("online.klaarMelding")));
              }}
            />
            <Label htmlFor="online-klaar" className="min-h-9 flex-1 text-base">
              {t("online.checklist.klaar")}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">{t("online.terugdraaien")}</p>
        </CardContent>
      </Card>

      {sleutelsNodig && (
        <Card data-testid="online-sleutels">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-lg">{t("online.sleutels.titel")}</CardTitle>
              <Badge variant="secondary">{t("appwinkel.badge")}</Badge>
            </div>
            <CardDescription className="text-base">{t("online.sleutels.uitleg")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-base">{t("online.sleutels.binnenkort")}</p>
            <Button variant="outline" disabled>
              {t("online.sleutels.test")}
            </Button>
            <p className="text-sm text-muted-foreground">{t("online.sleutels.later")}</p>
          </CardContent>
        </Card>
      )}

      <PublishPanel project={w.project} onError={w.onError} inline onChecked={(schoon) => setVeilig(schoon)} onExported={() => setKopie(true)} />
    </Frame>
  );
}
