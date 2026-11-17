import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cliStatus, type CliStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  status: CliStatus;
  /** Wordt aangeroepen als de CLI na hercontrole wél gevonden is. */
  onInstalled: (s: CliStatus) => void;
}

export default function InstallGuide({ status, onInstalled }: Props) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);
  const [stillMissing, setStillMissing] = useState(false);

  async function recheck() {
    setBusy(true);
    try {
      const s = await cliStatus(current.provider);
      setCurrent(s);
      setStillMissing(!s.installed);
      if (s.installed) onInstalled(s);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="install-guide" className="mx-auto my-6 max-w-xl">
      <CardHeader>
        <CardTitle className="text-lg">{t("cli.nietGevonden", { naam: t(`provider.${current.provider}`) })}</CardTitle>
        <CardDescription className="text-base">{t("cli.uitleg")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-base">
        <ul className="space-y-2">
          {current.install_steps.map((s) => (
            <li key={s.label}>
              <div className="text-muted-foreground">{s.label}</div>
              <code className="block rounded-lg bg-muted px-3 py-2 font-mono select-all">{s.command}</code>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t("cli.herstart")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void recheck()} disabled={busy}>
            {t("cli.opnieuw")}
          </Button>
          <Button variant="link" asChild>
            <a href={current.docs_url} target="_blank" rel="noreferrer">
              {t("cli.docs")}
            </a>
          </Button>
          {stillMissing && (
            <span role="status" className="text-warning">
              {t("cli.nogSteedsNiet")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
