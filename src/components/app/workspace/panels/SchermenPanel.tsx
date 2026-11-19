import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTextIcon, LayoutTemplateIcon } from "lucide-react";
import { projectPages, type PageInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "../workspace-context";
import EmptyState from "./EmptyState";
import Frame from "./Frame";

/** De pagina's van de app. Een klik toont de pagina in het voorbeeld. */
export default function SchermenPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [paginas, setPaginas] = useState<PageInfo[] | null>(null);
  useEffect(() => {
    let off = false;
    projectPages(w.project.id)
      .then((p) => !off && setPaginas(p))
      .catch(() => !off && setPaginas([]));
    return () => {
      off = true;
    };
  }, [w.project.id, w.tick]);

  function toon(p: PageInfo) {
    w.openPaneel("preview");
    w.control.current?.navigate(p.pad);
  }

  return (
    <Frame titel={t("schermen.titel")} uitleg={t("schermen.uitleg")}>
      {paginas && paginas.length === 0 && <EmptyState icon={<LayoutTemplateIcon className="size-10" />} titel={t("schermen.leeg.titel")} uitleg={t("schermen.leeg.uitleg")} knop={t("schermen.leeg.knop")} onKnop={w.focusGesprek} />}
      <ul className="space-y-2" data-testid="schermenlijst">
        {(paginas ?? []).map((p) => (
          <li key={p.pad}>
            <Button variant="outline" className="h-auto w-full justify-start gap-3 py-3 text-left" aria-label={t("schermen.open", { naam: p.naam })} onClick={() => toon(p)}>
              <FileTextIcon aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-semibold">{p.naam}</span>
                <span className="block truncate text-sm font-normal text-muted-foreground">{t("schermen.pad", { pad: p.pad })}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
