import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";
import { createAccount, listAccounts, type Account, type Provider } from "@/lib/api";
import LoginModal from "@/components/LoginModal";
import { useSettings } from "@/components/app/settings-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import Systeemcheck from "./Systeemcheck";

const NIVEAUS = ["always", "important", "autonomous"] as const;
const TOTAAL = 3;

/**
 * Het eerste-startscherm in drie stappen: (1) welkom, (2) systeemcheck en je AI kiezen en inloggen, (3) hoeveel de AI zelf mag doen.
 * Niets blokkeert: elke stap kan met "Later doen" worden overgeslagen, en alles is later te veranderen bij Instellingen.
 */
export default function EersteStart({ onAccountsGewijzigd }: { onAccountsGewijzigd?: () => void }) {
  const { t } = useTranslation();
  const { settings, geladen, set } = useSettings();
  const [stap, setStap] = useState(1);
  const [niveau, setNiveau] = useState<(typeof NIVEAUS)[number]>(settings.permission_mode);
  const [login, setLogin] = useState<Account | null>(null);
  const [fout, setFout] = useState(false);

  if (!geladen || settings.eerste_start_klaar) return null;

  async function inloggen(provider: Provider) {
    setFout(false);
    try {
      const bestaand = (await listAccounts()).find((a) => a.provider === provider);
      const acc = bestaand ?? (await createAccount(provider, t("eerstestart.accountNaam")));
      onAccountsGewijzigd?.();
      setLogin(acc);
    } catch {
      setFout(true);
    }
  }

  async function klaar(metNiveau: boolean) {
    if (metNiveau) await set("permission_mode", niveau);
    await set("eerste_start_klaar", true);
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && void klaar(false)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="eerste-start" data-stap={stap} aria-describedby="eerste-uitleg">
          <DialogHeader>
            <p className="text-sm text-muted-foreground" data-testid="eerste-stap">
              {t("eerstestart.stap", { nu: stap, totaal: TOTAAL })}
            </p>
            <DialogTitle className="text-2xl">{stap === 1 ? t("eerstestart.welkom.titel") : stap === 2 ? t("eerstestart.ai.titel") : t("eerstestart.niveau.titel")}</DialogTitle>
            <DialogDescription id="eerste-uitleg" className="text-base">
              {stap === 1 ? t("eerstestart.welkom.een") : stap === 2 ? t("eerstestart.ai.uitleg") : t("eerstestart.niveau.uitleg")}
            </DialogDescription>
          </DialogHeader>

          {stap === 1 && (
            <ul className="list-disc space-y-2 pl-6 text-base" data-testid="eerste-welkom">
              <li>{t("eerstestart.welkom.twee")}</li>
              <li>{t("eerstestart.welkom.drie")}</li>
            </ul>
          )}

          {stap === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <ul className="space-y-2" data-testid="eerste-ai">
                  {(["claude", "gemini"] as const).map((p) => (
                    <li key={p} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <span className="text-base font-medium">{t(`eerstestart.ai.${p}`)}</span>
                      <Button variant="outline" data-testid={`eerste-login-${p}`} onClick={() => void inloggen(p)}>
                        {t("eerstestart.ai.inloggen")}
                      </Button>
                    </li>
                  ))}
                  <li className="px-3 text-sm text-muted-foreground">{t("eerstestart.ai.codex")}</li>
                </ul>
                <p className="text-sm text-muted-foreground">{t("eerstestart.ai.kostenAi")}</p>
                {fout && (
                  <Alert variant="destructive">
                    <AlertDescription>{t("eerstestart.ai.fout")}</AlertDescription>
                  </Alert>
                )}
              </div>
              <Systeemcheck />
            </div>
          )}

          {stap === 3 && (
            <div className="space-y-3">
              <RadioGroup value={niveau} onValueChange={(v) => setNiveau(v as (typeof NIVEAUS)[number])} className="space-y-2" aria-label={t("eerstestart.niveau.titel")}>
                {NIVEAUS.map((n) => (
                  <div key={n} className="flex items-start gap-3 rounded-lg border p-3">
                    <RadioGroupItem value={n} id={`niveau-${n}`} className="mt-1" />
                    <Label htmlFor={`niveau-${n}`} className="flex-1 flex-col items-start gap-0 text-base">
                      <span className="font-semibold">{t(`eerstestart.niveau.${n}.titel`)}</span>
                      <span className="block text-sm font-normal text-muted-foreground">{t(`eerstestart.niveau.${n}.uitleg`)}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {niveau === "autonomous" && (
                <Alert className="border-warning/50 bg-warning/10" data-testid="eerste-waarschuwing">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertDescription className="text-base text-foreground">{t("eerstestart.niveau.autonomous.waarschuwing")}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" data-testid="eerste-later" onClick={() => void klaar(false)}>
              {t("eerstestart.overslaan")}
            </Button>
            <span className="flex gap-2">
              {stap > 1 && (
                <Button variant="outline" onClick={() => setStap(stap - 1)}>
                  {t("eerstestart.terug")}
                </Button>
              )}
              {stap < TOTAAL ? (
                <Button size="lg" data-testid="eerste-volgende" onClick={() => setStap(stap + 1)}>
                  {t("eerstestart.volgende")}
                </Button>
              ) : (
                <Button size="lg" data-testid="eerste-klaar" onClick={() => void klaar(true)}>
                  {t("eerstestart.klaar")}
                </Button>
              )}
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {login && <LoginModal account={login} onClose={() => setLogin(null)} />}
    </>
  );
}
