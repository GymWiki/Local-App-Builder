import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useTheme, type Theme } from "@/components/app/theme-provider";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type CommunicationMode = "simple" | "technical";
export type PermissionMode = "always" | "important";

interface Props {
  communication: CommunicationMode;
  permission: PermissionMode;
  loopThreshold?: number;
  onLoopThreshold?: (n: number) => void;
  onCommunication: (v: CommunicationMode) => void;
  onPermission: (v: PermissionMode) => void;
}

/** Een groep keuzes met titel en uitleg, als shadcn RadioGroup. */
function ChoiceGroup<T extends string>({ legend, name, value, onChange, options, note }: { legend: string; name: string; value: T; onChange: (v: T) => void; options: { value: T; title: string; text: string }[]; note?: string }) {
  return (
    <FieldSet>
      <FieldLegend>{legend}</FieldLegend>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as T)} aria-label={legend} className="gap-3">
        {options.map((o) => (
          <FieldLabel key={o.value} htmlFor={`${name}-${o.value}`} className="cursor-pointer rounded-xl border-2 border-input p-4 has-data-checked:border-primary has-data-checked:bg-accent">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle className="text-lg">{o.title}</FieldTitle>
                <FieldDescription className="text-base">{o.text}</FieldDescription>
              </FieldContent>
              <RadioGroupItem id={`${name}-${o.value}`} value={o.value} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      {note && <FieldDescription className="text-base">{note}</FieldDescription>}
    </FieldSet>
  );
}

export default function SettingsScreen({ communication, permission, loopThreshold = 3, onLoopThreshold, onCommunication, onPermission }: Props) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const schema = z.object({ drempel: z.coerce.number<number>().int(t("instellingen.lus.fout")).min(2, t("instellingen.lus.fout")).max(10, t("instellingen.lus.fout")) });
  type Values = z.input<typeof schema>;
  const { register, control, reset, formState } = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { drempel: loopThreshold } });
  useEffect(() => reset({ drempel: loopThreshold }), [loopThreshold, reset]);

  // Alleen een geldige waarde wordt doorgegeven en bewaard.
  const draft = useWatch({ control, name: "drempel" });
  useEffect(() => {
    const parsed = schema.safeParse({ drempel: draft });
    if (parsed.success && parsed.data.drempel !== loopThreshold) onLoopThreshold?.(parsed.data.drempel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="max-w-2xl space-y-8 p-6">
      <ChoiceGroup<Theme>
        legend={t("instellingen.thema.titel")}
        name="thema"
        value={theme}
        onChange={setTheme}
        options={(["system", "light", "dark"] as Theme[]).map((v) => ({ value: v, title: t(`instellingen.thema.${v}`), text: t(`instellingen.thema.${v}Uitleg`) }))}
      />
      <ChoiceGroup<CommunicationMode>
        legend={t("instellingen.taal.titel")}
        name="communicatie"
        value={communication}
        onChange={onCommunication}
        options={[
          { value: "simple", title: t("instellingen.taal.eenvoudig"), text: t("instellingen.taal.eenvoudigUitleg") },
          { value: "technical", title: t("instellingen.taal.technisch"), text: t("instellingen.taal.technischUitleg") },
        ]}
        note={t("instellingen.taal.toelichting")}
      />
      <ChoiceGroup<PermissionMode>
        legend={t("instellingen.toestemming.titel")}
        name="toestemming"
        value={permission}
        onChange={onPermission}
        options={[
          { value: "always", title: t("instellingen.toestemming.altijd"), text: t("instellingen.toestemming.altijdUitleg") },
          { value: "important", title: t("instellingen.toestemming.belangrijk"), text: t("instellingen.toestemming.belangrijkUitleg") },
        ]}
        note={t("instellingen.toestemming.toelichting")}
      />
      {onLoopThreshold && (
        <FieldSet>
          <FieldLegend>{t("instellingen.lus.titel")}</FieldLegend>
          <Field data-invalid={!!formState.errors.drempel}>
            <FieldLabel htmlFor="lus-drempel">{t("instellingen.lus.label")}</FieldLabel>
            <Input id="lus-drempel" type="number" min={2} max={10} className="w-28 text-lg" aria-invalid={!!formState.errors.drempel} {...register("drempel")} />
            <FieldError>{formState.errors.drempel?.message}</FieldError>
            <FieldDescription className="text-base">{t("instellingen.lus.uitleg")}</FieldDescription>
          </Field>
        </FieldSet>
      )}
    </div>
  );
}
