import { useTranslation } from "react-i18next";
import { MoveIcon } from "lucide-react";
import type { Model } from "flexlayout-react";
import type { PanelId } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bestemmingenVoor, verplaats } from "./modelActions";

interface Props {
  model: Model;
  id: PanelId;
}

/** Verplaats een paneel zonder te slepen: ook voor het toetsenbord en voor wie slepen lastig vindt. */
export default function MovePanelMenu({ model, id }: Props) {
  const { t } = useTranslation();
  const naam = t(`werkruimte.paneel.${id}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={t("werkruimte.verplaats.knop", { naam })} data-testid={`verplaats-${id}`}>
          <MoveIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel>{t("werkruimte.verplaats.titel", { naam })}</DropdownMenuLabel>
        {bestemmingenVoor(model, id).map((b) => (
          <DropdownMenuItem key={b} onSelect={() => verplaats(model, id, b)}>
            {t(`werkruimte.verplaats.${b}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
