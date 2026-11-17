import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { createAccount, deleteAccount, type Account } from "@/lib/api";
import LoginModal from "./LoginModal";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  accounts: Account[];
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}

export default function AccountsScreen({ accounts, onChanged, onError }: Props) {
  const { t } = useTranslation();
  const [loginFor, setLoginFor] = useState<Account | null>(null);
  const [removeFor, setRemoveFor] = useState<Account | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        provider: z.enum(["claude", "gemini"]),
        label: z.string().trim().min(1, t("accounts.fout.labelLeeg")).max(60, t("accounts.fout.labelLang")),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const { register, control, handleSubmit, reset, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { provider: "claude", label: "" },
  });
  const { errors, isSubmitting } = formState;

  async function add(v: Values) {
    try {
      await createAccount(v.provider, v.label.trim());
      reset({ provider: v.provider, label: "" });
      await onChanged();
    } catch (err) {
      onError(String(err));
    }
  }

  async function remove(a: Account) {
    setRemoveFor(null);
    try {
      await deleteAccount(a.id);
      await onChanged();
    } catch (err) {
      onError(String(err));
    }
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <section className="space-y-6 p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("accounts.titel")}</h1>
          <p className="max-w-2xl text-base text-muted-foreground">{t("accounts.privacy")}</p>
        </header>

        <form onSubmit={(e) => void handleSubmit(add)(e)} noValidate className="max-w-2xl">
          <FieldGroup className="flex-row flex-wrap items-start gap-3">
            <Field className="w-auto">
              <FieldLabel htmlFor="account-provider">{t("accounts.provider")}</FieldLabel>
              <Controller
                control={control}
                name="provider"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="account-provider" className="min-w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">{t("provider.claude")}</SelectItem>
                      <SelectItem value="gemini">{t("provider.gemini")}</SelectItem>
                      <SelectItem value="codex" disabled>
                        {t("provider.codex")} ({t("accounts.nogNiet")})
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field className="min-w-48 flex-1" data-invalid={!!errors.label}>
              <FieldLabel htmlFor="account-label">{t("accounts.label")}</FieldLabel>
              <Input id="account-label" placeholder={t("accounts.labelVoorbeeld")} maxLength={60} aria-invalid={!!errors.label} {...register("label")} />
              <FieldError>{errors.label?.message}</FieldError>
            </Field>
            <Button type="submit" disabled={isSubmitting} className="mt-7">
              {t("accounts.toevoegen")}
            </Button>
          </FieldGroup>
        </form>

        {accounts.length === 0 ? (
          <p className="text-base text-muted-foreground">{t("accounts.leeg")}</p>
        ) : (
          <ul className="max-w-2xl space-y-3">
            {accounts.map((a) => (
              <li key={a.id}>
                <Card size="sm">
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <Badge variant="secondary">{t(`provider.${a.provider}`)}</Badge>
                        {a.label}
                      </div>
                      <div className="truncate text-sm text-muted-foreground" title={a.profile_dir}>
                        {a.profile_dir}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => setLoginFor(a)}>
                        {t("accounts.inloggen")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoveFor(a)}>
                        {t("sidebar.verwijder")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {loginFor && <LoginModal account={loginFor} onClose={() => setLoginFor(null)} />}

        <AlertDialog open={removeFor !== null} onOpenChange={(o) => !o && setRemoveFor(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("accounts.verwijderTitel")}</AlertDialogTitle>
              <AlertDialogDescription className="whitespace-pre-line">{removeFor ? t("accounts.bevestigVerwijder", { label: removeFor.label, pad: removeFor.profile_dir }) : ""}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("accounts.annuleer")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => removeFor && void remove(removeFor)}>{t("sidebar.verwijder")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </ScrollArea>
  );
}
