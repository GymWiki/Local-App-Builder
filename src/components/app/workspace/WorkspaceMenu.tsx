import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, WrenchIcon } from "lucide-react";
import { GEVORDERD, zichtbareItems, verborgenItems, type ItemStatus, type MenuId, type Signalen } from "@/lib/menu";
import type { PanelId } from "@/lib/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICONEN, TOETSEN } from "./menuIcons";

interface Props {
  projectNaam: string;
  signalen: Pick<Signalen, "heeftDatabase" | "needsData">;
  vlaggen: Record<string, string>;
  status: Partial<Record<MenuId, ItemStatus>>;
  /** Het paneel dat nu zichtbaar is (voor `aria-current`). */
  actief: ReadonlySet<PanelId>;
  ingeklapt: boolean;
  onToggleIngeklapt: () => void;
  onOpen: (id: PanelId) => void;
  onHome: () => void;
  onVoegToe: (id: MenuId) => void;
}

function Punt({ status }: { status?: ItemStatus }) {
  const { t } = useTranslation();
  if (!status || status.punt === "leeg") return null;
  const tekst = t(`menu.status.${status.punt}`);
  return status.punt === "klaar" ? (
    <span className="ml-auto inline-flex items-center text-success" data-testid="punt-klaar" title={tekst}>
      <CheckIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">{tekst}</span>
    </span>
  ) : (
    <span className="ml-auto inline-flex items-center text-warning" data-testid="punt-actie" title={tekst}>
      <CircleAlertIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">{tekst}</span>
    </span>
  );
}

function Item({ id, status, actief, ingeklapt, onOpen }: { id: PanelId; status?: ItemStatus; actief: boolean; ingeklapt: boolean; onOpen: (id: PanelId) => void }) {
  const { t } = useTranslation();
  const Icon = ICONEN[id]!;
  const naam = t(`werkruimte.paneel.${id}`);
  const toets = TOETSEN[id];
  const knop = (
    <Button
      variant={actief ? "secondary" : "ghost"}
      aria-current={actief ? "page" : undefined}
      aria-label={ingeklapt ? t("menu.open", { naam }) : undefined}
      data-testid={`menu-${id}`}
      onClick={() => onOpen(id)}
      className={`${ingeklapt ? "size-10 justify-center p-0" : "h-10 w-full justify-start"} ${actief ? "bg-accent text-accent-foreground" : "text-foreground"}`}
    >
      <Icon aria-hidden="true" />
      {!ingeklapt && <span className="min-w-0 flex-1 truncate text-left">{naam}</span>}
      {!ingeklapt && status?.telling != null && status.telling > 0 && (
        <Badge variant="secondary" className="shrink-0" aria-label={t("menu.telling", { aantal: status.telling })}>
          {status.telling}
        </Badge>
      )}
      {!ingeklapt ? <Punt status={status} /> : status && status.punt !== "leeg" ? <span className="sr-only">{t(`menu.status.${status.punt}`)}</span> : null}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{knop}</TooltipTrigger>
      <TooltipContent side="right">
        <div>{naam}</div>
        {status && status.punt !== "leeg" && <div className="text-xs opacity-80">{t(`menu.status.${status.punt}`)}</div>}
        {toets && <div className="text-xs opacity-80">{t("menu.sneltoets", { toets })}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Het linkermenu van de werkruimte: terug, projectnaam, Hulp, de groepen Maken / Delen / Beheer en onderaan "Voor gevorderden". */
export default function WorkspaceMenu({ projectNaam, signalen, vlaggen, status, actief, ingeklapt, onToggleIngeklapt, onOpen, onHome, onVoegToe }: Props) {
  const { t } = useTranslation();
  const [gevorderd, setGevorderd] = useState(false);
  const groepen = zichtbareItems(signalen, vlaggen);
  const verborgen = verborgenItems(signalen, vlaggen);
  const Hulp = ICONEN.hulp!;
  const Terug = ArrowLeftIcon;

  return (
    <nav aria-label={t("menu.label")} data-testid="menu" data-ingeklapt={ingeklapt ? "ja" : "nee"} className={`flex shrink-0 flex-col border-r border-border bg-card ${ingeklapt ? "w-16" : "w-56"}`}>
      <div className={`flex flex-col gap-1 border-b border-border p-2 ${ingeklapt ? "items-center" : ""}`}>
        <div className={`flex gap-1 ${ingeklapt ? "flex-col items-center" : "items-center"}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" onClick={onHome} aria-label={ingeklapt ? t("menu.terug") : undefined} data-testid="menu-terug" className={ingeklapt ? "size-11 justify-center p-0" : "min-w-0 flex-1 justify-start"}>
                <Terug aria-hidden="true" />
                {!ingeklapt && <span className="truncate">{t("menu.terug")}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("menu.terug")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={ingeklapt ? t("menu.klapOpen") : t("menu.klap")} aria-expanded={!ingeklapt} data-testid="menu-klap" onClick={onToggleIngeklapt}>
                {ingeklapt ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftCloseIcon aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{ingeklapt ? t("menu.klapOpen") : t("menu.klap")}</TooltipContent>
          </Tooltip>
        </div>
        <div className={`flex items-center gap-1 ${ingeklapt ? "flex-col" : "justify-between"}`}>
          {!ingeklapt && (
            <h1 className="min-w-0 flex-1 truncate px-3 text-lg font-semibold" title={projectNaam}>
              {projectNaam}
            </h1>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size={ingeklapt ? "icon" : "sm"} aria-label={ingeklapt ? t("menu.hulp") : undefined} data-testid="menu-hulp" onClick={() => onOpen("hulp")}>
                <Hulp aria-hidden="true" />
                {!ingeklapt && t("menu.hulp")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("menu.hulp")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className={`space-y-4 p-2 ${ingeklapt ? "flex flex-col items-center" : ""}`}>
          {groepen.map((g) => (
            <div key={g.id} role="group" aria-label={t(`menu.groep.${g.id}`)} className={`space-y-1 ${ingeklapt ? "flex flex-col items-center" : ""}`}>
              {!ingeklapt ? <div className="px-3 pt-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{t(`menu.groep.${g.id}`)}</div> : <div className="h-px w-8 bg-border" aria-hidden="true" />}
              {g.items.map((id) => (
                <Item key={id} id={id} status={status[id]} actief={actief.has(id)} ingeklapt={ingeklapt} onOpen={onOpen} />
              ))}
            </div>
          ))}
          {verborgen.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" aria-label={ingeklapt ? t("menu.meer.knop") : undefined} data-testid="menu-meer" className={ingeklapt ? "size-11 justify-center p-0" : "w-full justify-start text-muted-foreground"}>
                  <PlusIcon aria-hidden="true" />
                  {!ingeklapt && t("menu.meer.knop")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side={ingeklapt ? "right" : "bottom"}>
                <DropdownMenuLabel>{t("menu.meer.titel")}</DropdownMenuLabel>
                {verborgen.map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => onVoegToe(id)}>
                    {t(`menu.meer.${id}`, { defaultValue: t(`werkruimte.paneel.${id}`) })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ScrollArea>

      <div className={`border-t border-border p-2 ${ingeklapt ? "flex flex-col items-center gap-1" : ""}`}>
        {ingeklapt ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="size-11 justify-center p-0 text-muted-foreground"
                aria-label={t("menu.gevorderd.titel")}
                data-testid="menu-gevorderd"
                onClick={() => {
                  setGevorderd(true);
                  onToggleIngeklapt();
                }}
              >
                <WrenchIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("menu.gevorderd.titel")}</TooltipContent>
          </Tooltip>
        ) : (
          <Collapsible open={gevorderd} onOpenChange={setGevorderd}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="menu-gevorderd" aria-label={gevorderd ? t("menu.gevorderd.dicht") : t("menu.gevorderd.open")} className="w-full justify-start text-muted-foreground">
                <ChevronRightIcon aria-hidden="true" className={gevorderd ? "rotate-90" : ""} />
                {t("menu.gevorderd.titel")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-1">
              <p className="px-3 text-sm text-muted-foreground">{t("menu.gevorderd.uitleg")}</p>
              {GEVORDERD.map((id) => (
                <Item key={id} id={id} actief={actief.has(id)} ingeklapt={false} onOpen={onOpen} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </nav>
  );
}
