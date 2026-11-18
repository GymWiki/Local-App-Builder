import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PickedElement } from "../pick";

interface Props {
  selection: PickedElement | null;
}

/** Pagina en plek van het gekozen onderdeel. Zonder keuze: een korte uitleg. */
export default function StructuurPanel({ selection }: Props) {
  const { t } = useTranslation();
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">
          {t("werkruimte.structuur.titel")}
        </h2>
        {!selection ? (
          <p className="text-base text-muted-foreground">
            {t("werkruimte.structuur.geenSelectie")}
          </p>
        ) : (
          <div className="space-y-3 text-base">
            <div>
              <div className="text-sm text-muted-foreground">
                {t("werkruimte.structuur.pagina")}
              </div>
              <div className="break-all">{selection.path}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">
                {t("werkruimte.structuur.plek")}
              </div>
              <ol className="mt-1 space-y-1">
                {selection.breadcrumb.map((b, i) => (
                  <li
                    key={`${i}-${b.selector}`}
                    style={{ paddingLeft: `${i * 0.75}rem` }}
                    className={
                      i === selection.breadcrumb.length - 1
                        ? "font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {b.label}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
