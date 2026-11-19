import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { renameProject, type Project } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface Props {
  project: Project;
  onClose: () => void;
  onRenamed: (p: Project) => void | Promise<void>;
}

const VERBODEN = /[\\/:*?"<>|]/;

/** Naam van een project wijzigen. Alleen de naam in Studio verandert, de map op schijf niet. */
export default function RenameProjectDialog({
  project,
  onClose,
  onRenamed,
}: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const schema = useMemo(
    () =>
      z.object({
        naam: z
          .string()
          .trim()
          .min(1, t("nieuw.fout.naamLeeg"))
          .max(60, t("nieuw.fout.naamLang"))
          .refine((v) => !VERBODEN.test(v), t("nieuw.fout.naamTekens")),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { naam: project.naam },
  });
  const { errors, isSubmitting } = formState;

  async function submit(v: Values) {
    setError(null);
    try {
      await onRenamed(await renameProject(project.id, v.naam.trim()));
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => void handleSubmit(submit)(e)}
          noValidate
          className="space-y-5"
        >
          <DialogHeader>
            <DialogTitle>{t("home.hernoem.titel")}</DialogTitle>
            <DialogDescription>{t("home.hernoem.uitleg")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!errors.naam}>
            <FieldLabel htmlFor="hernoem-naam">
              {t("home.hernoem.label")}
            </FieldLabel>
            <Input
              id="hernoem-naam"
              autoFocus
              aria-invalid={!!errors.naam}
              aria-describedby={errors.naam ? "hernoem-fout" : undefined}
              {...register("naam")}
            />
            {errors.naam && (
              <FieldError id="hernoem-fout">{errors.naam.message}</FieldError>
            )}
            <FieldDescription className="sr-only">
              {t("home.hernoem.uitleg")}
            </FieldDescription>
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription role="alert">{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("nieuw.annuleer")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t("home.hernoem.knop")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
