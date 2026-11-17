import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createAccount, deleteAccount, type Account, type Provider } from "../lib/api";
import LoginModal from "./LoginModal";

interface Props {
  accounts: Account[];
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}

export default function AccountsScreen({ accounts, onChanged, onError }: Props) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<Provider>("claude");
  const [label, setLabel] = useState("");
  const [loginFor, setLoginFor] = useState<Account | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await createAccount(provider, label.trim());
      setLabel("");
      await onChanged();
    } catch (err) {
      onError(String(err));
    }
  }

  async function remove(a: Account) {
    if (!window.confirm(t("accounts.bevestigVerwijder", { label: a.label, pad: a.profile_dir }))) return;
    try {
      await deleteAccount(a.id);
      await onChanged();
    } catch (err) {
      onError(String(err));
    }
  }

  return (
    <section className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-1 text-xl font-semibold">{t("accounts.titel")}</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">{t("accounts.privacy")}</p>

      <form onSubmit={(e) => void add(e)} className="mb-8 flex max-w-2xl flex-wrap items-end gap-3 text-sm">
        <label>
          {t("accounts.provider")}
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="mt-1 block rounded border border-border bg-background px-3 py-2"
          >
            <option value="claude">{t("provider.claude")}</option>
            <option value="gemini">{t("provider.gemini")}</option>
            <option value="codex" disabled>
              {t("provider.codex")} ({t("accounts.nogNiet")})
            </option>
          </select>
        </label>
        <label className="min-w-48 flex-1">
          {t("accounts.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("accounts.labelVoorbeeld")}
            maxLength={60}
            className="mt-1 block w-full rounded border border-border bg-background px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={!label.trim()}
          className="rounded bg-primary text-primary-foreground px-3 py-2 font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {t("accounts.toevoegen")}
        </button>
      </form>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("accounts.leeg")}</p>
      ) : (
        <ul className="max-w-2xl divide-y divide-border rounded border border-border">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  {t(`provider.${a.provider}`)} · {a.label}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={a.profile_dir}>
                  {a.profile_dir}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => setLoginFor(a)} className="rounded bg-primary text-primary-foreground px-3 py-1 hover:bg-primary/90">
                  {t("accounts.inloggen")}
                </button>
                <button onClick={() => void remove(a)} className="rounded border border-border px-3 py-1 hover:bg-muted">
                  {t("sidebar.verwijder")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {loginFor && <LoginModal account={loginFor} onClose={() => setLoginFor(null)} />}
    </section>
  );
}
