import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  label: string;
  uitleg: string;
  bereik: "alle" | "dit";
  children: ReactNode;
  /** Als er een standaard te herstellen is: de actie en of de huidige waarde al de standaard is. */
  herstel?: { onReset: () => void; isStandaard: boolean };
  extra?: ReactNode;
}

/** Eén instelling: label, uitleg van één zin, voor wie hij geldt, de keuze zelf en "Standaard herstellen". */
export default function Rij({ id, label, uitleg, bereik, children, herstel, extra }: Props) {
  const { t } = useTranslation();
  return (
    <section data-instelling={id} aria-labelledby={`${id}-label`} className="space-y-2 border-b border-border pb-5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-label`} className="text-lg font-semibold">
          {label}
        </h3>
        <Badge variant="secondary" data-testid={`${id}-bereik`}>
          {t(`inst.bereik.${bereik}`)}
        </Badge>
      </div>
      <p className="text-base text-muted-foreground">{uitleg}</p>
      <div>{children}</div>
      {extra}
      {herstel && (
        <Button variant="ghost" size="sm" disabled={herstel.isStandaard} onClick={herstel.onReset} data-testid={`${id}-herstel`}>
          {t("inst.herstel")}
        </Button>
      )}
    </section>
  );
}
