import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createProject, kiesMap, type Project } from "../lib/api";

interface Props {
  onClose: () => void;
  onCreated: (p: Project) => void | Promise<void>;
}

export default function NewProjectDialog({ onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [naam, setNaam] = useState("");
  const [map, setMap] = useState<string | null>(null);
  const [soort, setSoort] = useState<"leeg" | "web-react-vite">("leeg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!map) return;
    setBusy(true);
    setError(null);
    try {
      await onCreated(await createProject(naam.trim(), map, soort));
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-foreground/50">
      <form
        onSubmit={(e) => void submit(e)}
        role="dialog"
        aria-label={t("nieuw.titel")}
        className="w-[28rem] space-y-4 rounded-lg bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{t("nieuw.titel")}</h2>
        <label className="block text-sm">
          {t("nieuw.naam")}
          <input
            autoFocus
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2"
          />
        </label>
        <div role="radiogroup" aria-label={t("nieuw.soort")} className="space-y-2 text-sm">
          {(["leeg", "web-react-vite"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={soort === k}
              onClick={() => setSoort(k)}
              className={`block w-full rounded border px-3 py-2 text-left ${soort === k ? "border-primary bg-accent" : "border-border hover:bg-muted"}`}
            >
              <span className="font-medium">{t(k === "leeg" ? "nieuw.soortLeeg" : "nieuw.soortWeb")}</span>
              <span className="block text-muted-foreground">{t(k === "leeg" ? "nieuw.soortLeegUitleg" : "nieuw.soortWebUitleg")}</span>
            </button>
          ))}
        </div>
        <div className="text-sm">
          <div className="mb-1">{t("nieuw.map")}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void kiesMap().then((m) => m && setMap(m))}
              className="rounded border border-border px-3 py-1.5 hover:bg-muted"
            >
              {t("nieuw.kiesMap")}
            </button>
            <span className="min-w-0 truncate text-muted-foreground">{map ?? t("nieuw.geenMap")}</span>
          </div>
          {map && naam.trim() && <p className="mt-2 text-muted-foreground">{t("nieuw.resultaat", { naam: naam.trim() })}</p>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm hover:bg-muted">
            {t("nieuw.annuleer")}
          </button>
          <button
            type="submit"
            disabled={busy || !naam.trim() || !map}
            className="rounded bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? t("nieuw.bezig") : t("nieuw.maak")}
          </button>
        </div>
      </form>
    </div>
  );
}
