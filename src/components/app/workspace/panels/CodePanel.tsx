import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileIcon } from "lucide-react";
import { projectFileRead, projectFiles, type FileContent, type FileEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "../workspace-context";
import EmptyState from "./EmptyState";
import Frame from "./Frame";

/** Alle bestanden van het project, alleen om te lezen. Geheime bestanden worden niet getoond. Alleen voor gevorderden. */
export default function CodePanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [lijst, setLijst] = useState<FileEntry[] | null>(null);
  const [open, setOpen] = useState<{ pad: string; inhoud: FileContent | null; fout: boolean } | null>(null);
  useEffect(() => {
    let off = false;
    projectFiles(w.project.id)
      .then((f) => !off && setLijst(f))
      .catch(() => !off && setLijst([]));
    return () => {
      off = true;
    };
  }, [w.project.id, w.tick]);

  async function lees(pad: string) {
    setOpen({ pad, inhoud: null, fout: false });
    try {
      setOpen({ pad, inhoud: await projectFileRead(w.project.id, pad), fout: false });
    } catch {
      setOpen({ pad, inhoud: null, fout: true });
    }
  }

  return (
    <Frame titel={t("code.titel")} uitleg={t("code.uitleg")}>
      {lijst && lijst.length === 0 && <EmptyState icon={<FileIcon className="size-10" />} titel={t("code.leeg")} uitleg={t("code.uitleg")} />}
      <ul className="space-y-1" data-testid="bestandslijst">
        {(lijst ?? []).map((f) => (
          <li key={f.pad}>
            <Button variant={open?.pad === f.pad ? "secondary" : "ghost"} size="sm" className="w-full justify-start gap-2 font-mono" onClick={() => void lees(f.pad)}>
              <FileIcon aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">{f.pad}</span>
              <span className="text-xs font-sans text-muted-foreground">{t("code.grootte", { kb: Math.max(1, Math.round(f.grootte / 1024)) })}</span>
            </Button>
          </li>
        ))}
      </ul>
      {open && (
        <section aria-label={open.pad} className="space-y-2">
          <h3 className="font-mono text-base font-semibold">{open.pad}</h3>
          {open.fout && <p className="text-base text-destructive">{t("code.fout")}</p>}
          {open.inhoud && (
            <>
              {open.inhoud.ingekort && <p className="text-sm text-muted-foreground">{t("code.ingekort")}</p>}
              <pre data-testid="bestand-inhoud" className="max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap">
                {open.inhoud.tekst}
              </pre>
            </>
          )}
        </section>
      )}
    </Frame>
  );
}
