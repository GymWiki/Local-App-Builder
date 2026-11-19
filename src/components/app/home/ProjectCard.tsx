import { useTranslation } from "react-i18next";
import {
  FolderIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import type { PreviewInfo, Project } from "@/lib/api";
import type { Route } from "@/lib/route";
import { timeAgo } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ProjectStatus =
  | "running"
  | "starting"
  | "stopping"
  | "error"
  | "stopped"
  | "idle"
  | "nieuw";

/** De status die op de kaart staat: de preview als het project open is, anders "Nieuw" of niets bijzonders. */
export function projectStatus(
  p: Project,
  preview: PreviewInfo | null | undefined,
): ProjectStatus {
  if (preview) return preview.status as ProjectStatus;
  return p.last_used_at ? "idle" : "nieuw";
}

const BADGE: Record<ProjectStatus, string> = {
  running: "bg-success/15 text-success",
  starting: "bg-warning/15 text-warning",
  stopping: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
  stopped: "bg-muted text-muted-foreground",
  idle: "bg-muted text-muted-foreground",
  nieuw: "bg-primary/10 text-primary",
};

interface Props {
  project: Project;
  thumbnail: string | null;
  status: ProjectStatus;
  onOpen: () => void;
  onRename: () => void;
  onRemove: () => void;
  /** Waar het project staat op de route van idee tot app (als die bekend is). */
  route?: Route | null;
}

/** Eén projectkaart op het homescherm: miniatuur, naam, laatst bewerkt, status en een menu. */
export default function ProjectCard({
  project,
  thumbnail,
  status,
  onOpen,
  onRename,
  onRemove,
  route,
}: Props) {
  const { t } = useTranslation();
  const wanneer = project.last_used_at
    ? t("home.laatst", { wanneer: timeAgo(project.last_used_at) })
    : t("home.nooit");
  return (
    <Card
      data-testid="project-card"
      className="relative gap-0 overflow-hidden py-0 transition-shadow focus-within:ring-3 focus-within:ring-ring/50 hover:shadow-md"
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={t("home.miniatuur", { naam: project.naam })}
            className="size-full object-cover object-top"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FolderIcon aria-hidden="true" className="size-10" />
            <span className="text-sm">{t("home.plaatshouder")}</span>
          </div>
        )}
      </div>
      <CardContent className="flex-1 space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-lg leading-snug font-semibold">
            <Button
              variant="link"
              onClick={onOpen}
              title={project.naam}
              aria-label={t("home.kaart", { naam: project.naam })}
              className="h-auto min-w-0 justify-start p-0 text-lg font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline"
            >
              <span className="truncate">{project.naam}</span>
            </Button>
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("home.menu", { naam: project.naam })}
                className="relative z-10 -mt-1 -mr-2 shrink-0"
              >
                <MoreVerticalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpen}>
                {t("home.openen")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRename}>
                <PencilIcon aria-hidden="true" />
                {t("home.hernoemen")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2Icon aria-hidden="true" />
                {t("home.uitLijst")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {route && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-2" data-testid="project-route" data-huidig={route.huidig}>
            <p className="text-sm">
              {route.huidig === "klaar" ? t("home.route.klaar") : t("home.route.stap", { nummer: route.nummer, totaal: route.totaal, naam: t(`route.stap.${route.huidig}.titel`) })}
            </p>
            <Button size="sm" className="relative z-10" data-testid="project-verder" onClick={onOpen}>
              {t("home.route.verder")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{wanneer}</span>
          <Badge data-testid="project-status" className={BADGE[status]}>
            {t(`home.status.${status}`)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
