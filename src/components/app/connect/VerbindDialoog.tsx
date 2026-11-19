import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2Icon, CopyIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { connectCancel, connectOpen, connectPaste, connectStart, type DienstId, type KoppelInfo, type KoppelStart } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useConnections } from "./connections-provider";

interface Props {
  id: DienstId;
  open: boolean;
  onClose: () => void;
  /** Wordt aangeroepen zodra de koppeling werkt (de gebruiker keert terug naar wat hij deed). */
  onConnected?: (info: KoppelInfo) => void;
  /** Voor "Alles verbinden": voortgang en een knop om deze dienst over te slaan, in de dialoog zelf. */
  reeks?: { nu: number; totaal: number; onOverslaan: () => void };
}

/** De inlog-wizard in gewone taal: kiest zelf de methode (inloggen via de dienst of een sleutel plakken). */
export default function VerbindDialoog(props: Props) {
  // De inhoud wordt bij elke keer openen opnieuw opgebouwd, zodat er geen oude invoer of fout achterblijft.
  return props.open ? <Wizard {...props} /> : null;
}

function Wizard({ id, onClose, onConnected, reeks }: Props) {
  const { t } = useTranslation();
  const { van, ververs } = useConnections();
  const k = van(id);
  const dienst = t(`koppelingen.${id}.naam`);
  const [start, setStart] = useState<KoppelStart | null>(null);
  const [lokaleFout, setLokaleFout] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [toon, setToon] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [gekopieerd, setGekopieerd] = useState(false);
  const [geplakt, setGeplakt] = useState(false);
  const gemeld = useRef(false);

  // Een nieuwe poging starten (voor inloggen via de dienst begint dat het wachten; voor een sleutel toont het de stappen).
  useEffect(() => {
    let weg = false;
    connectStart(id)
      .then(async (s) => {
        await ververs(); // eerst de nieuwe status ophalen, zodat een oude "werkt" niet als gelukt telt
        if (!weg) setStart(s);
      })
      .catch((e) => !weg && setLokaleFout(String(e)));
    return () => {
      weg = true;
    };
  }, [id, ververs]);

  const oauth = !!start && start.soort !== "plakken";
  const klaar = geplakt || (oauth && k?.status === "werkt" && !k.bezig);
  const fout = lokaleFout ?? (oauth && k?.fout && !k.bezig && k.status !== "werkt" ? k.fout : null);

  // Zodra het gelukt is, mag de gebruiker verder met wat hij deed (één keer melden).
  useEffect(() => {
    if (klaar && k && !gemeld.current) {
      gemeld.current = true;
      onConnected?.(k);
    }
  }, [klaar, k, onConnected]);

  const sluit = () => {
    if (!klaar) void connectCancel(id).catch(() => undefined);
    void ververs();
    onClose();
  };

  const plak = async () => {
    setBezig(true);
    setLokaleFout(null);
    try {
      await connectPaste(id, token);
      setToken("");
      await ververs();
      setGeplakt(true);
    } catch (e) {
      setLokaleFout(String(e));
    } finally {
      setBezig(false);
    }
  };

  const kopieer = async (tekst: string) => {
    try {
      await navigator.clipboard.writeText(tekst);
      setGekopieerd(true);
      setTimeout(() => setGekopieerd(false), 2000);
    } catch {
      /* geen toegang tot het klembord: de tekst blijft zichtbaar */
    }
  };
  const open_ = (url: string) => void connectOpen(url).catch((e) => setLokaleFout(String(e)));
  const foutTekst = (c: string) => t(`koppelingen.fout.${c}`, { defaultValue: t("koppelingen.fout.onverwacht") });

  return (
    <Dialog open onOpenChange={(o) => !o && sluit()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid={`verbind-dialoog-${id}`}>
        {reeks && (
          <div data-testid="reeks-voortgang" className="space-y-1">
            <p className="text-sm font-semibold">{t("koppelingen.overzicht.voortgang", { nu: reeks.nu, totaal: reeks.totaal })}</p>
            <Progress value={(reeks.nu / reeks.totaal) * 100} aria-label={t("koppelingen.overzicht.voortgang", { nu: reeks.nu, totaal: reeks.totaal })} />
          </div>
        )}
        <DialogHeader>
          <DialogTitle>{klaar ? t("koppelingen.dialoog.gelukt", { dienst }) : t("koppelingen.dialoog.titel", { dienst })}</DialogTitle>
          <DialogDescription>{klaar ? t("koppelingen.dialoog.geluktAccount", { account: k?.account ?? "" }) : t("koppelingen.dialoog.intro", { dienst })}</DialogDescription>
        </DialogHeader>

        {klaar ? (
          <div className="flex items-center gap-3 text-lg" role="status">
            <CheckCircle2Icon className="size-8 text-success" aria-hidden="true" />
            <span>{t("koppelingen.dialoog.geluktAccount", { account: k?.account ?? "" })} ✓</span>
          </div>
        ) : (
          <div className="space-y-4">
            {k && (
              <Collapsible className="text-base text-muted-foreground">
                <CollapsibleTrigger asChild>
                  <Button variant="link" className="h-auto px-0">
                    {t("koppelingen.dialoog.rechtenTitel")}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {k.rechten.map((r) => (
                      <li key={r}>{t(`koppelingen.${id}.rechten.${r}`)}</li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}

            {start?.soort === "apparaat" && (
              <div className="space-y-3" data-testid="apparaat-code">
                <p className="text-base">{t("koppelingen.dialoog.codeTitel", { dienst })}</p>
                <p className="rounded-xl border-2 border-primary bg-accent px-4 py-4 text-center font-mono text-4xl font-semibold tracking-widest" aria-label={start.user_code.split("").join(" ")}>
                  {start.user_code}
                </p>
                <p className="text-base text-muted-foreground">{t("koppelingen.dialoog.codeUitleg")}</p>
                <p className="text-sm text-muted-foreground">{t("koppelingen.dialoog.codeGeldig", { minuten: Math.round(start.expires_in / 60) })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => open_(start.verification_uri)}>
                    <ExternalLinkIcon aria-hidden="true" />
                    {t("koppelingen.knop.open")}
                  </Button>
                  <Button variant="outline" onClick={() => void kopieer(start.user_code)}>
                    <CopyIcon aria-hidden="true" />
                    {gekopieerd ? t("koppelingen.knop.gekopieerd") : t("koppelingen.knop.kopieerCode")}
                  </Button>
                </div>
              </div>
            )}

            {start?.soort === "browser" && (
              <div className="space-y-3" data-testid="browser-wacht">
                <p className="text-base">{t("koppelingen.dialoog.wachtOpBrowser", { dienst })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => open_(start.url)}>
                    <ExternalLinkIcon aria-hidden="true" />
                    {t("koppelingen.knop.open")}
                  </Button>
                  <Button variant="outline" onClick={() => void kopieer(start.url)}>
                    <CopyIcon aria-hidden="true" />
                    {gekopieerd ? t("koppelingen.knop.gekopieerd") : t("koppelingen.knop.kopieerLink")}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">{t("koppelingen.dialoog.browserNiet")}</p>
              </div>
            )}

            {start?.soort === "plakken" && k && (
              <div className="space-y-4" data-testid="plakken">
                <p className="text-base text-muted-foreground">{t("koppelingen.dialoog.plakIntro", { dienst })}</p>
                <ol className="space-y-4 text-base">
                  <li className="space-y-2">
                    <p className="font-semibold">1. {t("koppelingen.dialoog.stap1", { dienst })}</p>
                    <Button variant="outline" size="sm" onClick={() => open_(k.links.signup)}>
                      <ExternalLinkIcon aria-hidden="true" />
                      {t("koppelingen.dialoog.stap1Knop", { dienst })}
                    </Button>
                  </li>
                  <li className="space-y-2">
                    <p className="font-semibold">2. {t("koppelingen.dialoog.stap2")}</p>
                    <p className="text-muted-foreground">{t(`koppelingen.${id}.stap2`)}</p>
                    <Button variant="outline" size="sm" onClick={() => open_(k.links.token_page)}>
                      <ExternalLinkIcon aria-hidden="true" />
                      {t("koppelingen.dialoog.sleutelPaginaKnop")}
                    </Button>
                  </li>
                  <li className="space-y-2">
                    <p className="font-semibold">3. {t("koppelingen.dialoog.stap3")}</p>
                    <Field>
                      <FieldLabel htmlFor={`sleutel-${id}`}>{t("koppelingen.dialoog.veldLabel")}</FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id={`sleutel-${id}`}
                          type={toon ? "text" : "password"}
                          autoComplete="off"
                          spellCheck={false}
                          value={token}
                          placeholder={t("koppelingen.dialoog.veldPlaats")}
                          onChange={(e) => setToken(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && token.trim() && void plak()}
                        />
                        <Button variant="outline" size="icon" aria-label={toon ? t("koppelingen.knop.verberg") : t("koppelingen.knop.toon")} aria-pressed={toon} onClick={() => setToon((v) => !v)}>
                          {toon ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                        </Button>
                      </div>
                    </Field>
                  </li>
                </ol>
              </div>
            )}

            {!start && !fout && (
              <p className="flex items-center gap-2 text-base text-muted-foreground" role="status">
                <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
                {t("koppelingen.knop.bezig")}
              </p>
            )}
            {fout && (
              <Alert variant="destructive" data-testid="verbind-fout">
                <AlertDescription>{foutTekst(fout)}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {klaar ? (
            <Button onClick={sluit}>{t("koppelingen.knop.klaar")}</Button>
          ) : (
            <>
              {reeks && (
                <Button variant="ghost" onClick={reeks.onOverslaan}>
                  {t("koppelingen.knop.overslaan")}
                </Button>
              )}
              <Button variant="outline" onClick={sluit}>
                {t("koppelingen.knop.annuleer")}
              </Button>
              {start?.soort === "plakken" && (
                <Button disabled={!token.trim() || bezig} onClick={() => void plak()}>
                  {bezig ? t("koppelingen.knop.bezig") : t("koppelingen.knop.verbinden")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
