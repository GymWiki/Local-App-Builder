import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { runtime, type Checkpoint, type RestoreResult } from "@/lib/api";
import { friendlyTitle, timeAgo } from "@/lib/time";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  projectId: number;
  onClose: () => void;
  onError: (msg: string) => void;
}

/** Tijdlijn met versies. Terugzetten is veilig: Studio bewaart eerst de huidige staat als versie. */
export default function VersionsDialog({ projectId, onClose, onError }: Props) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Checkpoint[] | null>(null);
  const [target, setTarget] = useState<Checkpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    runtime<Checkpoint[]>(projectId, "git.list", { limit: 50 })
      .then((l) => !cancelled && setVersions(l))
      .catch(() => !cancelled && setVersions([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, tick]);

  const restore = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await runtime<RestoreResult>(projectId, "git.restore", { hash: target.hash });
      setDone(r.unchanged ? t("versies.alGelijk") : t("versies.teruggezet", { titel: friendlyTitle(target.message) }));
      setTick((n) => n + 1);
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }, [projectId, target, onError, t]);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("versies.titel")}</DialogTitle>
            <DialogDescription>{t("versies.uitleg")}</DialogDescription>
          </DialogHeader>
          {done && (
            <Alert role="status" className="border-success/40 bg-success/10">
              <AlertDescription className="text-success">{done}</AlertDescription>
            </Alert>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {versions === null ? (
              <div role="status" aria-label={t("versies.laden")} className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <span className="sr-only">{t("versies.laden")}</span>
              </div>
            ) : versions.length === 0 ? (
              <p data-testid="versions-empty" className="text-muted-foreground">
                {t("versies.leeg")}
              </p>
            ) : (
              <ol data-testid="versions-list" className="space-y-2 pr-3">
                {versions.map((v, i) => (
                  <li key={v.hash}>
                    <Card size="sm">
                      <CardHeader>
                        <CardTitle className="truncate text-lg">{friendlyTitle(v.message)}</CardTitle>
                        <CardDescription className="flex items-center gap-2">
                          {timeAgo(v.date)}
                          {i === 0 && <Badge variant="secondary">{t("versies.huidig")}</Badge>}
                        </CardDescription>
                        {i > 0 && (
                          <CardAction>
                            <Button variant="outline" size="sm" onClick={() => setTarget(v)}>
                              {t("versies.terug")}
                            </Button>
                          </CardAction>
                        )}
                      </CardHeader>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              {t("versies.sluit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{target ? t("versies.bevestigTitel", { titel: friendlyTitle(target.message) }) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{t("versies.bevestigUitleg")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("nieuw.annuleer")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void restore()}>
              {t("versies.ja")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
