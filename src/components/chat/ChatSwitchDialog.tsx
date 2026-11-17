import { useTranslation } from "react-i18next";
import type { Account, Provider } from "../../lib/api";

interface Props {
  accounts: Account[];
  onCancel: () => void;
  onPick: (provider: Provider, accountId: number | null) => void;
}

const PROVIDERS: Provider[] = ["claude", "gemini"];

export default function ChatSwitchDialog({ accounts, onCancel, onPick }: Props) {
  const { t } = useTranslation();
  const options = PROVIDERS.flatMap((p) => [{ provider: p, account: null as Account | null }, ...accounts.filter((a) => a.provider === p).map((a) => ({ provider: p, account: a }))]);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-label={t("chat.wisselDialoog.titel")} className="w-full max-w-md space-y-4 rounded-xl bg-zinc-900 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold">{t("chat.wisselDialoog.titel")}</h2>
        <p className="text-base text-zinc-300">{t("chat.wisselDialoog.uitleg")}</p>
        <p className="rounded-lg bg-amber-950 p-3 text-base text-amber-200">{t("chat.wisselDialoog.tip")}</p>
        <ul className="space-y-1">
          {options.map((o) => (
            <li key={`${o.provider}-${o.account?.id ?? "sys"}`}>
              <button onClick={() => onPick(o.provider, o.account?.id ?? null)} className="min-h-11 w-full rounded-lg px-4 text-left text-lg hover:bg-zinc-800">
                {t(`provider.${o.provider}`)} · {o.account?.label ?? t("chat.geenAccount")}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button onClick={onCancel} className="min-h-11 rounded-lg px-4 hover:bg-zinc-800">
            {t("nieuw.annuleer")}
          </button>
        </div>
      </div>
    </div>
  );
}
