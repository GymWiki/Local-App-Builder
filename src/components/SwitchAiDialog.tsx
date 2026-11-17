import { useTranslation } from "react-i18next";
import type { Account, Provider } from "../lib/api";
import type { SessionInfo } from "../lib/api";

interface Props {
  accounts: Account[];
  current: SessionInfo;
  onCancel: () => void;
  onPick: (provider: Provider, accountId: number | null) => void;
}

const PROVIDERS: Provider[] = ["claude", "gemini"];

export default function SwitchAiDialog({ accounts, current, onCancel, onPick }: Props) {
  const { t } = useTranslation();
  const options = PROVIDERS.flatMap((p) => [
    { provider: p, account: null as Account | null },
    ...accounts.filter((a) => a.provider === p).map((a) => ({ provider: p, account: a })),
  ]).filter((o) => !(o.provider === current.provider && (o.account?.id ?? null) === current.account_id));

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/50">
      <div role="dialog" aria-label={t("wissel.titel")} className="w-[28rem] space-y-4 rounded-lg bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{t("wissel.titel")}</h2>
        <p className="text-sm text-muted-foreground">{t("wissel.uitleg")}</p>
        <p className="rounded bg-warning/10 p-2 text-sm text-warning">{t("wissel.tip")}</p>
        <ul className="space-y-1">
          {options.map((o) => (
            <li key={`${o.provider}-${o.account?.id ?? "sys"}`}>
              <button
                onClick={() => onPick(o.provider, o.account?.id ?? null)}
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {t(`provider.${o.provider}`)} · {o.account?.label ?? t("terminal.systeemstandaard")}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button onClick={onCancel} className="rounded px-3 py-2 text-sm hover:bg-muted">
            {t("nieuw.annuleer")}
          </button>
        </div>
      </div>
    </div>
  );
}
