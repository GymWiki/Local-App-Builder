import { useTranslation } from "react-i18next";

/** Onderaan Instellingen: welke versie draait er echt? Versie, commit en bouwtijd (en of het de ontwikkelserver is). */
export default function BuildInfo() {
  const { t } = useTranslation();
  const tijd = new Date(__STUDIO_BUILD_TIME__);
  const leesbaar = Number.isNaN(tijd.getTime()) ? __STUDIO_BUILD_TIME__ : tijd.toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="mt-8 space-y-1 border-t pt-4 text-sm text-muted-foreground" data-testid="build-info">
      <p className="font-medium text-foreground">{t("inst.versie.titel")}</p>
      <p>
        {t("inst.versie.versie")}: <span data-testid="build-versie">{__STUDIO_VERSION__}</span>
      </p>
      <p>
        {t("inst.versie.commit")}: <span className="font-mono" data-testid="build-commit">{__STUDIO_COMMIT__}</span>
      </p>
      <p>
        {t("inst.versie.tijd")}: <span data-testid="build-tijd" data-iso={__STUDIO_BUILD_TIME__}>{leesbaar}</span>
      </p>
      <p>{import.meta.env.DEV ? t("inst.versie.dev") : t("inst.versie.release")}</p>
    </div>
  );
}
