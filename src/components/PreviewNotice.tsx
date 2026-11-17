import { useTranslation } from "react-i18next";
import { CheckCircle2Icon, XIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  projectName: string;
  onView: () => void;
  onClose: () => void;
}

/** Melding dat er voor het eerst iets previewbaars is. */
export default function PreviewNotice({ projectName, onView, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Alert role="status" data-testid="preview-notice" className="rounded-none border-0 border-b border-success/40 bg-success/10">
      <CheckCircle2Icon aria-hidden="true" className="text-success" />
      <AlertDescription className="flex items-center justify-between gap-3 text-base text-foreground">
        <span>{t("notice.beschikbaar", { naam: projectName })}</span>
        <span className="flex gap-2">
          <Button size="sm" onClick={onView}>
            {t("notice.bekijk")}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t("notice.sluit")} onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
