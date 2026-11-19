import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { createProject, kiesMap, type Project } from "@/lib/api";
import { useSettings } from "@/components/app/settings-provider";
import { Button } from "@/components/ui/button";
import FoutBanner from "@/components/app/FoutBanner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  onClose: () => void;
  onCreated: (p: Project) => void | Promise<void>;
}

/** "Beschrijf je idee" (leeg project) en "Begin met een voorbeeld" (kant-en-klare startprojecten die in een minuut draaien). */
export const SOORTEN = ["leeg", "web-react-vite", "start-takenlijst", "start-portfolio", "start-webshop", "start-kassa"] as const;
const VOORBEELDEN = SOORTEN.filter((k) => k !== "leeg");
const VERBODEN = /[\\/:*?"<>|]/;

export default function NewProjectDialog({ onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        naam: z.string().trim().min(1, t("nieuw.fout.naamLeeg")).max(60, t("nieuw.fout.naamLang")).refine((v) => !VERBODEN.test(v), t("nieuw.fout.naamTekens")),
        map: z.string().min(1, t("nieuw.fout.mapLeeg")),
        soort: z.enum(SOORTEN),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;

  const { register, control, handleSubmit, setValue, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { naam: "", map: settings.default_project_dir, soort: "leeg" },
  });
  const { errors, isSubmitting } = formState;
  const naam = useWatch({ control, name: "naam" });
  const map = useWatch({ control, name: "map" });

  async function submit(v: Values) {
    setError(null);
    try {
      await onCreated(await createProject(v.naam.trim(), v.map, v.soort));
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <form onSubmit={(e) => void handleSubmit(submit)(e)} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{t("nieuw.titel")}</DialogTitle>
            <DialogDescription className="sr-only">{t("nieuw.titel")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.naam}>
              <FieldLabel htmlFor="nieuw-naam">{t("nieuw.naam")}</FieldLabel>
              <Input id="nieuw-naam" autoFocus aria-invalid={!!errors.naam} {...register("naam")} />
              <FieldError>{errors.naam?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel id="nieuw-soort">{t("nieuw.soort")}</FieldLabel>
              <Controller
                control={control}
                name="soort"
                render={({ field }) => (
                  <RadioGroup aria-labelledby="nieuw-soort" value={field.value} onValueChange={field.onChange} className="gap-3">
                    <FieldLabel htmlFor="soort-leeg" className="cursor-pointer rounded-lg border border-input p-3 has-data-checked:border-primary has-data-checked:bg-accent">
                      <Field orientation="horizontal">
                        <RadioGroupItem id="soort-leeg" value="leeg" aria-labelledby="soort-leeg-titel" />
                        <div>
                          <div id="soort-leeg-titel" className="font-medium">{t("nieuw.soortLeeg")}</div>
                          <FieldDescription>{t("nieuw.soortLeegUitleg")}</FieldDescription>
                        </div>
                      </Field>
                    </FieldLabel>
                    <p className="pt-1 text-sm font-medium text-muted-foreground" data-testid="nieuw-voorbeelden-kop">
                      {t("nieuw.voorbeeldKop")}
                    </p>
                    {VOORBEELDEN.map((k) => (
                      <FieldLabel key={k} htmlFor={`soort-${k}`} className="cursor-pointer rounded-lg border border-input p-3 has-data-checked:border-primary has-data-checked:bg-accent">
                        <Field orientation="horizontal">
                          <RadioGroupItem id={`soort-${k}`} value={k} aria-labelledby={`soort-${k}-titel`} />
                          <div>
                            <div id={`soort-${k}-titel`} className="font-medium">{t(k === "web-react-vite" ? "nieuw.soortWeb" : `nieuw.voorbeeld.${k}.titel`)}</div>
                            <FieldDescription>{t(k === "web-react-vite" ? "nieuw.soortWebUitleg" : `nieuw.voorbeeld.${k}.uitleg`)}</FieldDescription>
                          </div>
                        </Field>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                )}
              />
            </Field>

            <Field data-invalid={!!errors.map}>
              <FieldLabel>{t("nieuw.map")}</FieldLabel>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => void kiesMap(settings.default_project_dir || undefined).then((m) => m && setValue("map", m, { shouldValidate: true }))}>
                  {t("nieuw.kiesMap")}
                </Button>
                <span className="min-w-0 truncate text-muted-foreground">{map || t("nieuw.geenMap")}</span>
              </div>
              {map && naam.trim() && <FieldDescription>{t("nieuw.resultaat", { naam: naam.trim() })}</FieldDescription>}
              <FieldError>{errors.map?.message}</FieldError>
            </Field>
          </FieldGroup>

          {error && (
            <FoutBanner fout={error} inline onSluit={() => setError(null)} />
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("nieuw.annuleer")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("nieuw.bezig") : t("nieuw.maak")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
