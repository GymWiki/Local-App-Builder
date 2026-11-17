import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { exportProject, kiesZipBestand, type Project } from "@/lib/api";
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
      </section>
    </ScrollArea>
  );
}
