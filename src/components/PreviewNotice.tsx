import { useTranslation } from "react-i18next";

interface Props {
  projectName: string;
  onView: () => void;
  onClose: () => void;
}

/** Melding dat er voor het eerst iets previewbaars is. */
export default function PreviewNotice({ projectName, onView, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div role="status" data-testid="preview-notice" className="flex items-center justify-between gap-3 bg-success/60 px-4 py-2 text-sm">
      <span>{t("notice.beschikbaar", { naam: projectName })}</span>
      <span className="flex gap-2">
        <button onClick={onView} className="rounded bg-success px-3 py-1 font-medium text-success-foreground hover:bg-success/90">
          {t("notice.bekijk")}
        </button>
        <button onClick={onClose} aria-label={t("notice.sluit")} className="rounded px-2 py-1 hover:bg-success">
          ×
        </button>
      </span>
    </div>
  );
}
