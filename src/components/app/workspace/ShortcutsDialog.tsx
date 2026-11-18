import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const SNELTOETSEN: { id: "chat" | "eigenschappen" | "links" | "groot" | "volgende" | "vorige" | "wissel"; toets: string }[] = [
  { id: "chat", toets: "Ctrl + Shift + G" },
  { id: "eigenschappen", toets: "Ctrl + Shift + E" },
  { id: "links", toets: "Ctrl + Shift + L" },
  { id: "groot", toets: "Ctrl + Shift + M" },
  { id: "volgende", toets: "Ctrl + ]" },
  { id: "vorige", toets: "Ctrl + [" },
  { id: "wissel", toets: "F6" },
];

interface Props {
  onClose: () => void;
}

/** Overzicht van de sneltoetsen in de werkruimte. */
export default function ShortcutsDialog({ onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("werkruimte.sneltoetsen.titel")}</DialogTitle>
          <DialogDescription>{t("werkruimte.sneltoetsen.uitleg")}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-base">
          {SNELTOETSEN.map((s) => (
            <div key={s.id} className="flex items-baseline justify-between gap-4">
              <dt>{t(`werkruimte.sneltoetsen.${s.id}`)}</dt>
              <dd>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-sm whitespace-nowrap">{s.toets}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-base text-muted-foreground">{t("werkruimte.sneltoetsen.grepen")}</p>
        <DialogFooter>
          <Button onClick={onClose}>{t("werkruimte.sneltoetsen.sluit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
