import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { chatSend } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ICONEN } from "../sections";
import type { PanelId } from "@/lib/layout";

interface Props {
  id: "componenten" | "database" | "koppelingen";
  projectId: number;
  onError: (msg: string) => void;
}

/** Plek voor een onderdeel dat nog niet is gebouwd: legt eerlijk uit wat er komt en laat de AI er alvast bij helpen. */
export default function PlaceholderPanel({ id, projectId, onError }: Props) {
  const { t } = useTranslation();
  const Icon = ICONEN[id as PanelId]!;
  async function vraag() {
    try {
      await chatSend(
        projectId,
        t(`werkruimte.plaatshouder.prompt${id[0].toUpperCase()}${id.slice(1)}`),
      );
      toast.success(t("werkruimte.plaatshouder.verstuurd"));
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }
  const body: ReactNode = (
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {t(`werkruimte.paneel.${id}`)}
        </h2>
        <Badge variant="secondary">
          {t("werkruimte.plaatshouder.binnenkort")}
        </Badge>
      </div>
      <p className="text-base text-muted-foreground">
        {t(`werkruimte.plaatshouder.${id}`)}
      </p>
      <Button variant="outline" onClick={() => void vraag()}>
        {t("werkruimte.plaatshouder.vraagAi")}
      </Button>
    </div>
  );
  return <ScrollArea className="h-full">{body}</ScrollArea>;
}
