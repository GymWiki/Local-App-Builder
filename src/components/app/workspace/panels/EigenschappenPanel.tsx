import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowUpIcon, ChevronDownIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import { sendWish } from "@/lib/pickWish";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PageInfo, PickedElement, PreviewControl } from "../pick";

interface Props {
  projectId: number;
  selection: PickedElement | null;
  page: PageInfo | null;
  control: RefObject<PreviewControl | null>;
  previewRunning: boolean;
  onClear: () => void;
  onError: (msg: string) => void;
}

/** Een thematoken in gewone woorden: `--color-primary` wordt "primary". */
export const tokenNaam = (token: string) => token.replace(/^--(color-|radius-|spacing-|font-)?/, "");

function Rij({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base break-words">{children}</dd>
    </div>
  );
}

function Kleur({ waarde }: { waarde: string }) {
  return <span aria-hidden="true" className="mr-2 inline-block size-4 rounded-sm border border-border align-middle" style={{ background: waarde }} />;
}

/** Een doorzichtige achtergrond is geen instelling om te tonen. */
const TRANSPARANT = /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/;
const KLEUREN = new Set(["color", "background-color", "background"]);

/** Eigenschappen van het gekozen onderdeel (of van de pagina), met een veld om de AI iets te vragen. */
export default function EigenschappenPanel({ projectId, selection, page, control, previewRunning, onClear, onError }: Props) {
  const { t } = useTranslation();
  const [wens, setWens] = useState("");
  const [bezig, setBezig] = useState(false);

  async function verstuur() {
    if (!selection || !wens.trim()) return;
    setBezig(true);
    try {
      await sendWish(projectId, selection, wens, t);
      toast.success(t("eigenschappen.verstuurd"));
      setWens("");
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setBezig(false);
    }
  }

  if (!selection) {
    return (
      <ScrollArea className="h-full">
        <div className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">{t("eigenschappen.titel")}</h2>
          <p className="text-base text-muted-foreground">{t("eigenschappen.uitleg")}</p>
          {previewRunning ? (
            <Button variant="outline" onClick={() => void control.current?.startPick()}>
              <MousePointerClickIcon aria-hidden="true" />
              {t("eigenschappen.kies")}
            </Button>
          ) : (
            <p className="text-base text-muted-foreground">{t("eigenschappen.geenPreview")}</p>
          )}
          <section aria-label={t("eigenschappen.pagina.titel")} className="space-y-2" data-testid="pagina-info">
            <h3 className="text-base font-semibold">{t("eigenschappen.pagina.titel")}</h3>
            {page ? (
              <dl className="space-y-2">
                <Rij label={t("eigenschappen.pagina.naam")}>{page.title || t("eigenschappen.pagina.leeg")}</Rij>
                <Rij label={t("eigenschappen.pagina.pad")}>{page.path}</Rij>
                {page.lang && <Rij label={t("eigenschappen.pagina.taal")}>{page.lang}</Rij>}
                <Rij label={t("eigenschappen.pagina.venster")}>{t("eigenschappen.afmeting", { breed: page.width, hoog: page.height })}</Rij>
                <Rij label={t("eigenschappen.pagina.achtergrond")}>
                  <Kleur waarde={page.background} />
                  {page.background}
                </Rij>
                <Rij label={t("eigenschappen.pagina.tekst")}>
                  <Kleur waarde={page.color} />
                  {page.color}
                </Rij>
                <Rij label={t("eigenschappen.pagina.lettertype")}>{page.fontFamily}</Rij>
              </dl>
            ) : (
              <p className="text-base text-muted-foreground">{t("eigenschappen.pagina.nogNiet")}</p>
            )}
          </section>
        </div>
      </ScrollArea>
    );
  }

  const ouder = selection.breadcrumb.length > 1 ? selection.breadcrumb[selection.breadcrumb.length - 2] : null;
  const soort = t(`eigenschappen.type.${selection.tag}`, { defaultValue: "", tag: selection.tag }) || t("eigenschappen.type.onbekend", { tag: selection.tag });
  const gebruikt = new Set(selection.tokens.map((x) => x.prop));
  if (gebruikt.has("background")) gebruikt.add("background-color");
  const losse = Object.entries(selection.styles).filter(([k]) => ["color", "background", "fontSize", "borderRadius", "padding", "gap"].includes(k));
  const cssNaam = (k: string) => (k === "background" ? "background-color" : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-5" data-testid="eigenschappen-selectie">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-lg font-semibold">{soort}</h2>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <XIcon aria-hidden="true" />
            {t("eigenschappen.wis")}
          </Button>
        </div>
        {selection.hidden && <Badge variant="secondary">{t("eigenschappen.verborgen")}</Badge>}

        <nav aria-label={t("eigenschappen.sectie.plek")} data-testid="breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-1 text-sm">
            {selection.breadcrumb.map((b, i) => (
              <li key={`${i}-${b.selector}`} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">›</span>}
                {i === selection.breadcrumb.length - 1 ? (
                  <span aria-current="true" className="font-semibold">
                    {b.label}
                  </span>
                ) : (
                  <Button variant="link" size="xs" className="h-auto min-h-8 px-1" onClick={() => control.current?.select(b.selector)}>
                    {b.label}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!ouder} title={ouder ? undefined : t("eigenschappen.geenOuder")} onClick={() => ouder && control.current?.select(ouder.selector)}>
            <ArrowUpIcon aria-hidden="true" />
            {t("eigenschappen.ouder")}
          </Button>
          {selection.children.length <= 1 ? (
            <Button variant="outline" size="sm" disabled={selection.children.length === 0} title={selection.children.length === 0 ? t("eigenschappen.geenKind") : undefined} onClick={() => control.current?.select(selection.children[0].selector)}>
              <ChevronDownIcon aria-hidden="true" />
              {t("eigenschappen.kind")}
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ChevronDownIcon aria-hidden="true" />
                  {t("eigenschappen.kind")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {selection.children.map((c) => (
                  <DropdownMenuItem key={c.selector} onSelect={() => control.current?.select(c.selector)}>
                    {c.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <dl className="space-y-3">
          {selection.text && <Rij label={t("eigenschappen.sectie.tekst")}>{selection.text}</Rij>}
          <Rij label={t("eigenschappen.sectie.afmeting")}>{t("eigenschappen.afmeting", { breed: selection.size.width, hoog: selection.size.height })}</Rij>
          <Rij label={t("eigenschappen.sectie.kit")}>{selection.kit ? t(selection.kit.self ? "eigenschappen.kitJa" : "eigenschappen.kitBinnen", { naam: selection.kit.name }) : t("eigenschappen.kitNee")}</Rij>
        </dl>

        <section aria-label={t("eigenschappen.sectie.uiterlijk")} className="space-y-2">
          <h3 className="text-base font-semibold">{t("eigenschappen.sectie.uiterlijk")}</h3>
          {selection.tokens.length === 0 && <p className="text-sm text-muted-foreground">{t("eigenschappen.geenTokens")}</p>}
          <dl className="space-y-2" data-testid="tokens">
            {selection.tokens.map((x) => (
              <Rij key={`${x.prop}-${x.token}`} label={t(`eigenschappen.eigenschap.${x.prop}`, { defaultValue: x.prop })}>
                {tokenNaam(x.token)} <span className="text-sm text-muted-foreground">({x.token})</span>
              </Rij>
            ))}
            {losse
              .filter(([k, v]) => !gebruikt.has(cssNaam(k)) && v && !TRANSPARANT.test(v) && v !== "0px" && v !== "normal")
              .map(([k, v]) => (
                <Rij key={k} label={t(`eigenschappen.eigenschap.${cssNaam(k)}`, { defaultValue: cssNaam(k) })}>
                  {KLEUREN.has(cssNaam(k)) && <Kleur waarde={v} />}
                  {v} <span className="text-sm text-muted-foreground">({t("eigenschappen.losseWaarde")})</span>
                </Rij>
              ))}
          </dl>
        </section>

        <section aria-label={t("eigenschappen.sectie.wens")} className="space-y-2">
          <Field>
            <FieldLabel htmlFor="eigenschappen-wens" className="text-base font-semibold">
              {t("eigenschappen.sectie.wens")}
            </FieldLabel>
            <Input id="eigenschappen-wens" value={wens} placeholder={t("eigenschappen.wensPlaats")} aria-label={t("eigenschappen.wensLabel")} onChange={(e) => setWens(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void verstuur()} />
          </Field>
          <Button disabled={!wens.trim() || bezig} onClick={() => void verstuur()}>
            {t("eigenschappen.verstuur")}
          </Button>
        </section>
      </div>
    </ScrollArea>
  );
}
