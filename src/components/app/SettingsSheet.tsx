import { useTranslation } from "react-i18next";
import type { Account } from "@/lib/api";
import SettingsView from "@/components/app/settings/SettingsView";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  onAccountsChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}

/** Instellingen voor alle projecten, vanaf het homescherm. Dezelfde onderdelen als in de werkruimte, zonder "Mijn project". */
export default function SettingsSheet({ open, onClose, accounts, onAccountsChanged, onError }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-2xl">{t("instellingen.titel")}</SheetTitle>
          <SheetDescription>{t("instellingen.beschrijving")}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <SettingsView scope="app" accounts={accounts} onAccountsChanged={onAccountsChanged} onError={onError} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
