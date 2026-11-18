import { useTranslation } from "react-i18next";
import AppearancePanel from "@/components/kits/AppearancePanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "../workspace-context";

/** Het uiterlijk van de app (uiterlijk kiezen, lettertype, afronding, ruimte), met daaronder het logo en icoon dat nog niet bestaat. */
export default function UiterlijkPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  return (
    <ScrollArea className="h-full">
      <AppearancePanel key={w.project.id} projectId={w.project.id} firstRun={w.project.template !== "leeg"} onError={w.onError} />
      <div className="px-6 pb-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-lg">{t("uiterlijkExtra.titel")}</CardTitle>
              <Badge variant="secondary">{t("uiterlijkExtra.badge")}</Badge>
            </div>
            <CardDescription className="text-base">{t("uiterlijkExtra.uitleg")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </ScrollArea>
  );
}
