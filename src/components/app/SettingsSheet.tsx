import { useTranslation } from "react-i18next";
import SettingsScreen, { type CommunicationMode, type PermissionMode } from "@/components/SettingsScreen";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  communication: CommunicationMode;
  permission: PermissionMode;
  loopThreshold: number;
  onLoopThreshold: (n: number) => void;
  onCommunication: (v: CommunicationMode) => void;
  onPermission: (v: PermissionMode) => void;
}

/** Instellingen in een paneel dat van rechts inschuift. */
export default function SettingsSheet({ open, onClose, ...rest }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-2xl">{t("instellingen.titel")}</SheetTitle>
          <SheetDescription>{t("instellingen.beschrijving")}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <SettingsScreen {...rest} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
