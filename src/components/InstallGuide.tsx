import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cliStatus, type CliStatus } from "../lib/api";

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
    <div className="mx-auto max-w-xl space-y-4 p-8 text-sm" data-testid="install-guide">
      <h2 className="text-lg font-semibold">{t("cli.nietGevonden", { naam: t(`provider.${current.provider}`) })}</h2>
      <p className="text-zinc-400">{t("cli.uitleg")}</p>
      <ul className="space-y-2">
        {current.install_steps.map((s) => (
          <li key={s.label}>
            <div className="text-zinc-500">{s.label}</div>
            <code className="block select-all rounded bg-zinc-900 px-3 py-2 font-mono">{s.command}</code>
          </li>
        ))}
      </ul>
      <p className="text-zinc-500">{t("cli.herstart")}</p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => void recheck()}
          disabled={busy}
          className="rounded bg-indigo-600 px-3 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {t("cli.opnieuw")}
        </button>
        <a href={current.docs_url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
          {t("cli.docs")}
        </a>
        {stillMissing && <span role="status" className="text-amber-400">{t("cli.nogSteedsNiet")}</span>}
      </div>
    </div>
  );
}
