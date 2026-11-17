import { useTranslation } from "react-i18next";

export type CommunicationMode = "simple" | "technical";
export type PermissionMode = "always" | "important";

interface Props {
  communication: CommunicationMode;
  permission: PermissionMode;
  onCommunication: (v: CommunicationMode) => void;
  onPermission: (v: PermissionMode) => void;
}

function Choice({ name, value, checked, title, text, onChange }: { name: string; value: string; checked: boolean; title: string; text: string; onChange: () => void }) {
  return (
    <label className={`flex cursor-pointer gap-4 rounded-xl border-2 p-4 ${checked ? "border-indigo-500 bg-indigo-950/40" : "border-zinc-700 hover:bg-zinc-900"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1.5 h-5 w-5" />
      <span>
        <span className="block text-lg font-semibold">{title}</span>
        <span className="block text-base text-zinc-300">{text}</span>
      </span>
    </label>
  );
}

export default function SettingsScreen({ communication, permission, onCommunication, onPermission }: Props) {
  const { t } = useTranslation();
  return (
    <section className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-semibold">{t("instellingen.titel")}</h1>

      <fieldset className="mb-8 max-w-2xl space-y-3">
        <legend className="mb-2 text-lg font-semibold">{t("instellingen.taal.titel")}</legend>
        <Choice name="communicatie" value="simple" checked={communication === "simple"} title={t("instellingen.taal.eenvoudig")} text={t("instellingen.taal.eenvoudigUitleg")} onChange={() => onCommunication("simple")} />
        <Choice name="communicatie" value="technical" checked={communication === "technical"} title={t("instellingen.taal.technisch")} text={t("instellingen.taal.technischUitleg")} onChange={() => onCommunication("technical")} />
        <p className="text-base text-zinc-400">{t("instellingen.taal.toelichting")}</p>
      </fieldset>

      <fieldset className="max-w-2xl space-y-3">
        <legend className="mb-2 text-lg font-semibold">{t("instellingen.toestemming.titel")}</legend>
        <Choice name="toestemming" value="always" checked={permission === "always"} title={t("instellingen.toestemming.altijd")} text={t("instellingen.toestemming.altijdUitleg")} onChange={() => onPermission("always")} />
        <Choice name="toestemming" value="important" checked={permission === "important"} title={t("instellingen.toestemming.belangrijk")} text={t("instellingen.toestemming.belangrijkUitleg")} onChange={() => onPermission("important")} />
        <p className="text-base text-zinc-400">{t("instellingen.toestemming.toelichting")}</p>
      </fieldset>
    </section>
  );
}
