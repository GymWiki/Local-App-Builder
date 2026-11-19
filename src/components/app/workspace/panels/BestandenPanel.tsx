import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { assetsDelete, assetsList, chatAttach, type AssetInfo } from "@/lib/api";
import { checkFile, pastedName, readBase64 } from "@/components/app/chat/files";
import AssetThumb from "@/components/app/chat/AssetThumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "../workspace-context";
import EmptyState from "./EmptyState";
import Frame from "./Frame";

/** De map ‘assets’ van het project: toevoegen (kiezen of slepen), miniaturen en verwijderen met bevestiging. */
export default function BestandenPanel() {
  const { t } = useTranslation();
  const w = useWorkspace();
  const [lijst, setLijst] = useState<AssetInfo[] | null>(null);
  const [verwijder, setVerwijder] = useState<AssetInfo | null>(null);
  const [sleep, setSleep] = useState(false);
  const kiezer = useRef<HTMLInputElement>(null);
  const { project, onError, verversSignalen } = w;

  const laad = useCallback(() => {
    assetsList(project.id)
      .then(setLijst)
      .catch(() => setLijst([]));
  }, [project.id]);
  useEffect(laad, [laad, w.tick]);

  async function voegToe(files: File[]) {
    for (const file of files.slice(0, 10)) {
      const naam = pastedName(file, Date.now() % 100000);
      const c = checkFile(naam, file.size);
      if (!c.ok) {
        onError(c.reason === "size" ? t("chat.bijlage.teGroot", { naam, max: c.max }) : t("chat.bijlage.typeNiet", { naam }));
        continue;
      }
      try {
        const opgeslagen = await chatAttach(project.id, naam, await readBase64(file));
        toast.success(t("bestanden.toegevoegd", { naam: opgeslagen.name }));
      } catch (e) {
        onError(t("bestanden.mislukt", { naam, reden: String(e) }));
      }
    }
    laad();
    verversSignalen();
  }

  function laatLos(e: DragEvent) {
    e.preventDefault();
    setSleep(false);
    void voegToe(Array.from(e.dataTransfer?.files ?? []));
  }

  async function bevestigVerwijder() {
    const a = verwijder;
    setVerwijder(null);
    if (!a) return;
    try {
      await assetsDelete(project.id, a.pad);
      toast.success(t("bestanden.verwijderd", { naam: a.naam }));
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    }
    laad();
    verversSignalen();
  }

  const kies = () => kiezer.current?.click();

  return (
    <div
      className={`h-full ${sleep ? "outline outline-4 -outline-offset-4 outline-primary" : ""}`}
      data-testid="bestanden"
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setSleep(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setSleep(false)}
      onDrop={laatLos}
    >
      <Frame titel={t("bestanden.titel")} uitleg={t("bestanden.uitleg")}>
        {/* Verborgen bestandskiezer: shadcn heeft hiervoor geen onderdeel; de zichtbare knop is een <Button>. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <input
          ref={kiezer}
          type="file"
          multiple
          hidden
          data-testid="bestanden-input"
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json"
          onChange={(e) => {
            void voegToe(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Button onClick={kies}>
          <UploadIcon aria-hidden="true" />
          {t("bestanden.toevoegen")}
        </Button>
        {sleep && (
          <p role="note" className="text-base font-semibold text-primary">
            {t("bestanden.sleep")}
          </p>
        )}
        {lijst && lijst.length === 0 && <EmptyState icon={<ImageIcon className="size-10" />} titel={t("bestanden.leeg.titel")} uitleg={t("bestanden.leeg.uitleg")} knop={t("bestanden.leeg.knop")} onKnop={kies} />}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3" data-testid="bestandenlijst">
          {(lijst ?? []).map((a) => (
            <li key={a.pad} className="relative flex flex-col items-center gap-1 rounded-lg border border-border p-2">
              <AssetThumb projectId={project.id} path={a.pad} name={a.naam} kind={a.soort} size="groot" />
              <span className="w-full truncate text-center text-sm" title={a.naam}>
                {a.naam}
              </span>
              <span className="text-xs text-muted-foreground">{t("bestanden.grootte", { kb: Math.max(1, Math.round(a.grootte / 1024)) })}</span>
              <Button variant="ghost" size="icon-sm" aria-label={t("bestanden.verwijder", { naam: a.naam })} onClick={() => setVerwijder(a)} className="absolute top-1 right-1">
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </Frame>
      <AlertDialog open={verwijder !== null} onOpenChange={(o) => !o && setVerwijder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bestanden.bevestig.titel")}</AlertDialogTitle>
            <AlertDialogDescription>{verwijder ? t("bestanden.bevestig.uitleg", { naam: verwijder.naam }) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("bestanden.bevestig.annuleer")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void bevestigVerwijder()}>{t("bestanden.bevestig.knop")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
