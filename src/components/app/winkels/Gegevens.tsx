import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { winkelsAppIdVoorstel, winkelsBewaar, winkelsVersieOphogen, type WinkelAppData, type WinkelOverzicht } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Props {
  projectId: number;
  overzicht: WinkelOverzicht;
  onBewaard: () => void;
}

function Veld({ id, label, hulp, waarde, onChange, placeholder, fout }: { id: string; label: string; hulp?: string; waarde: string; onChange: (v: string) => void; placeholder?: string; fout?: string | null }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-base">
        {label}
      </Label>
      <Input id={id} data-testid={id} value={waarde} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" aria-invalid={!!fout} />
      {fout ? <p className="text-sm text-destructive">{fout}</p> : hulp ? <p className="text-sm text-muted-foreground">{hulp}</p> : null}
    </div>
  );
}

/** De gegevens van je app die voor beide winkels gelden: naam, unieke app-naam (ID), contact, links, talen en het versienummer. */
export default function Gegevens({ projectId, overzicht, onBewaard }: Props) {
  const { t } = useTranslation();
  const [d, setD] = useState<WinkelAppData>(overzicht.data);
  const [domein, setDomein] = useState("");
  const [fout, setFout] = useState<{ veld: string; code: string } | null>(null);
  const [voorstel, setVoorstel] = useState<string | null>(null);
  const zet = <K extends keyof WinkelAppData>(k: K, v: WinkelAppData[K]) => setD((x) => ({ ...x, [k]: v }));

  async function bewaar() {
    setFout(null);
    const r = await winkelsBewaar(projectId, d);
    if (r?.ok) {
      toast.success(t("winkels.gegevens.bewaard"));
      onBewaard();
    } else if (r?.fout === "app_id" && r.veld && r.code) setFout({ veld: r.veld, code: r.code });
    else setFout({ veld: "algemeen", code: r?.fout ?? "onverwacht" });
  }

  async function maakVoorstel() {
    const r = await winkelsAppIdVoorstel(domein, d.app_naam);
    setVoorstel(r.voorstel);
  }

  async function ophogen(hoe: "build" | "patch" | "minor") {
    const r = await winkelsVersieOphogen(projectId, hoe);
    if (r.nieuw) toast.success(t("winkels.versie.nieuw", { versie: r.nieuw }));
    else toast.error(t(`winkels.versie.fout.${r.fout ?? "onbekend"}`, { defaultValue: t("winkels.versie.fout.onbekend") }));
    onBewaard();
  }

  const idFout = (veld: string) => (fout?.veld === veld ? t(`winkels.appid.${fout.code}`, { defaultValue: fout.code }) : null);
  return (
    <section className="space-y-4 rounded-xl border-2 border-border p-4" data-testid="winkels-gegevens" aria-labelledby="winkels-gegevens-titel">
      <h3 id="winkels-gegevens-titel" className="text-lg font-semibold">
        {t("winkels.gegevens.titel")}
      </h3>
      <p className="text-base text-muted-foreground">{t("winkels.gegevens.uitleg")}</p>
      <Veld id="wg-naam" label={t("winkels.gegevens.naam")} waarde={d.app_naam} onChange={(v) => zet("app_naam", v)} />

      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <p className="text-base font-medium">{t("winkels.appid.titel")}</p>
        <p className="text-sm text-muted-foreground">{t("winkels.appid.uitleg")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Label htmlFor="wg-domein" className="text-sm">
              {t("winkels.appid.domein")}
            </Label>
            <Input id="wg-domein" data-testid="wg-domein" value={domein} onChange={(e) => setDomein(e.target.value)} placeholder="mijnwinkel.nl" autoComplete="off" />
          </div>
          <Button variant="outline" data-testid="wg-voorstel" onClick={() => void maakVoorstel()}>
            {t("winkels.appid.voorstel")}
          </Button>
        </div>
        {voorstel && (
          <p className="text-base" data-testid="wg-voorstel-tekst">
            {t("winkels.appid.voorstelTekst")}: <span className="font-mono text-sm">{voorstel}</span>{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => setD((x) => ({ ...x, android_id: voorstel, ios_id: voorstel }))}>
              {t("winkels.appid.gebruik")}
            </Button>
          </p>
        )}
      </div>

      <Veld id="wg-android" label={t("winkels.gegevens.androidId")} waarde={d.android_id} onChange={(v) => zet("android_id", v)} placeholder="nl.mijnwinkel.app" fout={idFout("android_id")} hulp={t("winkels.appid.hulpAndroid")} />
      <Veld id="wg-ios" label={t("winkels.gegevens.iosId")} waarde={d.ios_id} onChange={(v) => zet("ios_id", v)} placeholder="nl.mijnwinkel.app" fout={idFout("ios_id")} hulp={t("winkels.appid.hulpIos")} />
      <Veld id="wg-email" label={t("winkels.gegevens.email")} waarde={d.contact_email} onChange={(v) => zet("contact_email", v)} hulp={t("winkels.gegevens.emailHulp")} />
      <Veld id="wg-site" label={t("winkels.gegevens.website")} waarde={d.website} onChange={(v) => zet("website", v)} placeholder="https://" />
      <Veld id="wg-support" label={t("winkels.gegevens.support")} waarde={d.support_url} onChange={(v) => zet("support_url", v)} placeholder="https://" />
      <Veld id="wg-privacy" label={t("winkels.gegevens.privacy")} waarde={d.privacy_url} onChange={(v) => zet("privacy_url", v)} placeholder="https://" hulp={t("winkels.gegevens.privacyHulp")} />
      <Veld id="wg-cat-play" label={t("winkels.gegevens.categoriePlay")} waarde={d.categorie_play} onChange={(v) => zet("categorie_play", v)} />
      <Veld id="wg-cat-apple" label={t("winkels.gegevens.categorieApple")} waarde={d.categorie_apple} onChange={(v) => zet("categorie_apple", v)} />

      <fieldset className="space-y-1">
        <legend className="text-base font-medium">{t("winkels.gegevens.talen")}</legend>
        {["nl", "en"].map((taal) => (
          <div key={taal} className="flex items-center gap-3">
            <Checkbox id={`wg-taal-${taal}`} checked={d.talen.includes(taal)} onCheckedChange={(c) => zet("talen", c === true ? [...new Set([...d.talen, taal])] : d.talen.filter((x) => x !== taal))} />
            <Label htmlFor={`wg-taal-${taal}`} className="min-h-9 text-base">
              {t(`winkels.taal.${taal}`)}
            </Label>
          </div>
        ))}
      </fieldset>
      <div className="flex items-start gap-3">
        <Switch id="wg-login" checked={d.heeft_login} onCheckedChange={(c) => zet("heeft_login", c)} />
        <Label htmlFor="wg-login" className="min-h-9 flex-1 text-base">
          {t("winkels.gegevens.heeftLogin")}
        </Label>
      </div>

      {fout && fout.veld === "algemeen" && (
        <Alert variant="destructive">
          <AlertDescription>{t("winkels.gegevens.fout")}</AlertDescription>
        </Alert>
      )}
      <Button data-testid="wg-bewaar" onClick={() => void bewaar()}>
        {t("winkels.gegevens.bewaar")}
      </Button>

      <div className="space-y-2 border-t pt-3" data-testid="winkels-versie">
        <p className="text-base font-medium">{t("winkels.versie.titel")}</p>
        {overzicht.versie ? (
          <>
            <p className="text-base">
              {t("winkels.versie.nu")}: <span className="font-mono text-sm" data-testid="winkels-versie-nu">{overzicht.versie.naam}+{overzicht.versie.build}</span>
            </p>
            <p className="text-sm text-muted-foreground">{t("winkels.versie.uitleg")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" data-testid="versie-build" onClick={() => void ophogen("build")}>
                {t("winkels.versie.build")}
              </Button>
              <Button variant="outline" data-testid="versie-patch" onClick={() => void ophogen("patch")}>
                {t("winkels.versie.patch")}
              </Button>
              <Button variant="outline" onClick={() => void ophogen("minor")}>
                {t("winkels.versie.minor")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("winkels.versie.geen")}</p>
        )}
      </div>
    </section>
  );
}
