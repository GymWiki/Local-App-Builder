import { useTranslation } from "react-i18next";
import type { Project } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  project: Project | null;
  onCancel: () => void;
  onConfirm: (p: Project) => void;
}

/** Een project uit de lijst halen. Er worden nooit bestanden gewist; dat zegt de tekst ook. */
export default function RemoveProjectDialog({
  project,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={project !== null} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("home.verwijder.titel")}</AlertDialogTitle>
          <AlertDialogDescription>
            {project ? t("home.verwijder.uitleg", { naam: project.naam }) : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("nieuw.annuleer")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => project && onConfirm(project)}>
            {t("home.verwijder.knop")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
