import { useTranslation } from "react-i18next";
import { SECTIES, type PanelId } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ICONEN } from "./sections";

interface Props {
  /** Welke onderdelen zijn nu open? */
  open: ReadonlySet<PanelId>;
  onToggle: (id: PanelId) => void;
}

function RailButton({
  id,
  actief,
  onToggle,
}: {
  id: PanelId;
  actief: boolean;
  onToggle: (id: PanelId) => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONEN[id]!;
  const naam = t(`werkruimte.paneel.${id}`);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={actief ? "secondary" : "ghost"}
          size="icon"
          aria-pressed={actief}
          aria-label={
            actief
              ? t("werkruimte.rail.sluit", { naam })
              : t("werkruimte.rail.open", { naam })
          }
          data-testid={`rail-${id}`}
          onClick={() => onToggle(id)}
          className={
            actief
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          }
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{naam}</TooltipContent>
    </Tooltip>
  );
}

/** Smalle iconenbalk links: elk icoon opent of sluit een onderdeel van de werkruimte. Terminal staat onderaan onder "Geavanceerd". */
export default function SectionRail({ open, onToggle }: Props) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("werkruimte.rail.label")}
      data-testid="rail"
      className="flex w-16 shrink-0 flex-col items-center justify-between gap-1 border-r border-border bg-card py-2"
    >
      <div className="flex flex-col items-center gap-1">
        {SECTIES.map((id) => (
          <RailButton
            key={id}
            id={id}
            actief={open.has(id)}
            onToggle={onToggle}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1 border-t border-border pt-2">
        <RailButton
          id="geavanceerd"
          actief={open.has("geavanceerd")}
          onToggle={onToggle}
        />
      </div>
    </nav>
  );
}
