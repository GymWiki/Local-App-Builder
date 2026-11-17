import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DownloadIcon, ShieldCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { chatSend, exportProject, kiesZipBestand, runtime, type Project, type SecurityFinding, type SecurityReport } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  project: Project;
  onError: (msg: string) => void;
}

/** Tabblad Publiceren: je project downloaden. */
export default function PublishPanel({ project, onError }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [checking, setChecking] = useState(false);

  async function download() {
    try {
      const dest = await kiesZipBestand(`${project.naam}.zip`);
      if (!dest) return;
      setBusy(true);
      const r = await exportProject(project.id, dest);
      toast.success(t("publiceren.export.klaar", { aantal: r.files, pad: r.path }));
      setNotes([
        ...(r.skipped_secrets.length ? [t("publiceren.export.geheimen", { lijst: r.skipped_secrets.join(", ") })] : []),
        ...(r.skipped_large.length ? [t("publiceren.export.groot", { lijst: r.skipped_large.join(", ") })] : []),
      ]);
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setChecking(true);
    try {
      setReport(await runtime<SecurityReport>(project.id, "security.check"));
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setChecking(false);
    }
  }

  async function fix(f: SecurityFinding) {
    const params = { bestand: f.file, regel: f.line ? `, ${t("publiceren.veilig.regel", { regel: f.line })}` : "", detail: f.detail };
    const key = f.code === "api_key" || f.code === "private_key" ? "geheim" : f.code === "env_in_git" || f.code === "secret_file_in_git" ? "gitbestand" : f.code === "secret_in_export" ? "uitvoer" : f.code === "password" ? "wachtwoord" : "regels";
    try {
      await chatSend(project.id, t(`publiceren.veilig.prompt.${key}`, params));
      toast.success(t("publiceren.veilig.verstuurd"));
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <section aria-label={t("publiceren.titel")} className="max-w-3xl space-y-5 p-6">
        <h2 className="text-2xl font-semibold">{t("publiceren.titel")}</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("publiceren.export.titel")}</CardTitle>
            <CardDescription className="text-base">{t("publiceren.export.uitleg")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-base">
            <p>{t("publiceren.export.van_jou")}</p>
            <p className="text-muted-foreground">{t("publiceren.export.niet_mee")}</p>
            {notes.map((n) => (
              <Alert key={n} role="status" className="border-warning/50 bg-warning/10">
                <AlertDescription className="text-foreground">{n}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
          <CardFooter>
            <Button disabled={busy} onClick={() => void download()}>
              <DownloadIcon aria-hidden="true" />
              {busy ? t("publiceren.export.bezig") : t("publiceren.export.knop")}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("publiceren.veilig.titel")}</CardTitle>
            <CardDescription className="text-base">{t("publiceren.veilig.uitleg")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-base">
            {report && (
              <p role="status" className={report.findings.length ? "font-medium text-warning" : "font-medium text-success"}>
                {report.findings.length === 0 ? t("publiceren.veilig.schoon", { aantal: report.scanned }) : t("publiceren.veilig.gevonden", { aantal: report.findings.length })}
              </p>
            )}
            {report && report.findings.length > 0 && (
              <>
                <p className="text-muted-foreground">{t("publiceren.veilig.waarschuwing")}</p>
                <ul className="space-y-3">
                  {report.findings.map((f) => (
                    <li key={`${f.code}:${f.file}:${f.line ?? ""}:${f.detail}`}>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Badge variant={f.severity === "hoog" ? "destructive" : "secondary"}>{t(`publiceren.veilig.${f.severity}`)}</Badge>
                            {t(`publiceren.veilig.codes.${f.code}.titel`)}
                          </CardTitle>
                          <CardDescription className="text-base">{t(`publiceren.veilig.codes.${f.code}.uitleg`)}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 break-words text-sm text-muted-foreground">
                            {f.file}
                            {f.line ? ` (${t("publiceren.veilig.regel", { regel: f.line })})` : ""} · {f.detail}
                          </span>
                          <Button size="sm" onClick={() => void fix(f)}>
                            {t("publiceren.veilig.oplossen")}
                          </Button>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="outline" disabled={checking} onClick={() => void check()}>
              <ShieldCheckIcon aria-hidden="true" />
              {checking ? t("publiceren.veilig.bezig") : t("publiceren.veilig.knop")}
            </Button>
          </CardFooter>
        </Card>
      </section>
    </ScrollArea>
  );
}
