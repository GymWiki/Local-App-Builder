import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyRoundIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
  CloudDownloadIcon,
} from "lucide-react";
import { projectThumbnailGet, type PreviewInfo, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ProjectCard, { projectStatus } from "./ProjectCard";
import RenameProjectDialog from "./RenameProjectDialog";
import RemoveProjectDialog from "./RemoveProjectDialog";
import OphalenDialoog from "@/components/app/github/OphalenDialoog";

type Sort = "laatst" | "naam";

interface Props {
  projects: Project[];
  previews: Record<number, PreviewInfo | null>;
  /** Verandert als een miniatuur is bijgewerkt, zodat de kaarten hem opnieuw ophalen. */
  thumbnailNonce?: number;
  onOpen: (id: number) => void;
  onNew: () => void;
  onAccounts: () => void;
  onSettings: () => void;
  onRenamed: (p: Project) => void | Promise<void>;
  onRemove: (p: Project) => void | Promise<void>;
  /** Een project is van GitHub opgehaald en moet geopend worden. */
  onImported?: (p: Project) => void | Promise<void>;
}

export function sortProjects(list: Project[], sort: Sort): Project[] {
  const copy = [...list];
  if (sort === "naam")
    return copy.sort((a, b) =>
      a.naam.localeCompare(b.naam, "nl", { sensitivity: "base" }),
    );
  return copy.sort(
    (a, b) =>
      (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") || b.id - a.id,
  );
}

/** Homescherm: een raster met projectkaarten, zoeken, sorteren en een kaart om een nieuw project te maken. */
export default function HomeScreen({
  projects,
  previews,
  thumbnailNonce = 0,
  onOpen,
  onNew,
  onAccounts,
  onSettings,
  onRenamed,
  onRemove,
  onImported,
}: Props) {
  const { t } = useTranslation();
  const [zoek, setZoek] = useState("");
  const [sort, setSort] = useState<Sort>("laatst");
  const [thumbs, setThumbs] = useState<Record<number, string | null>>({});
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const [ophalen, setOphalen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    for (const p of projects) {
      projectThumbnailGet(p.id)
        .then(
          (d) =>
            !cancelled &&
            setThumbs((m) => (m[p.id] === d ? m : { ...m, [p.id]: d })),
        )
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [projects, thumbnailNonce]);

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLocaleLowerCase("nl");
    return sortProjects(projects, sort).filter(
      (p) => !q || p.naam.toLocaleLowerCase("nl").includes(q),
    );
  }, [projects, zoek, sort]);

  const header = (
    <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
      <div className="text-xl font-semibold">{t("app.naam")}</div>
      <div className="flex gap-2">
        {onImported && (
          <Button variant="ghost" data-testid="home-ophalen" onClick={() => setOphalen(true)}>
            <CloudDownloadIcon aria-hidden="true" />
            {t("github.ophalen.knopHome")}
          </Button>
        )}
        <Button variant="ghost" onClick={onAccounts}>
          <KeyRoundIcon aria-hidden="true" />
          {t("accounts.titel")}
        </Button>
        <Button variant="ghost" onClick={onSettings}>
          <SettingsIcon aria-hidden="true" />
          {t("sidebar.instellingen")}
        </Button>
      </div>
    </div>
  );

  if (projects.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="home">
        {header}
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-3xl font-semibold">{t("home.leeg.titel")}</h1>
            <p className="text-lg text-muted-foreground">
              {t("home.leeg.uitleg")}
            </p>
            <Button size="lg" onClick={onNew}>
              <PlusIcon aria-hidden="true" />
              {t("home.leeg.knop")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="home">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("home.titel")}</h1>
            <p className="text-base text-muted-foreground">
              {t("home.uitleg")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                aria-label={t("home.zoek")}
                placeholder={t("home.zoekPlaceholder")}
                className="pl-10"
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label={t("home.sorteer")} className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="laatst">
                  {t("home.sorteerLaatst")}
                </SelectItem>
                <SelectItem value="naam">{t("home.sorteerNaam")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-5">
            <li>
              <Card className="relative h-full min-h-48 items-center justify-center border-2 border-dashed bg-transparent p-4 text-center shadow-none focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/50">
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={onNew}
                  className="h-auto flex-col gap-2 whitespace-normal after:absolute after:inset-0"
                >
                  <PlusIcon aria-hidden="true" className="size-8" />
                  <span className="text-lg font-semibold">
                    {t("home.nieuw")}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {t("home.nieuwUitleg")}
                  </span>
                </Button>
              </Card>
            </li>
            {zichtbaar.map((p) => (
              <li key={p.id}>
                <ProjectCard
                  project={p}
                  thumbnail={thumbs[p.id] ?? null}
                  status={projectStatus(p, previews[p.id])}
                  onOpen={() => onOpen(p.id)}
                  onRename={() => setRenaming(p)}
                  onRemove={() => setRemoving(p)}
                />
              </li>
            ))}
          </ul>
          {zichtbaar.length === 0 && zoek.trim() && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 text-base text-muted-foreground"
            >
              <span>{t("home.geenResultaat", { zoek: zoek.trim() })}</span>
              <Button variant="outline" size="sm" onClick={() => setZoek("")}>
                <XIcon aria-hidden="true" />
                {t("home.wisZoek")}
              </Button>
            </div>
          )}
        </div>
      </div>
      {renaming && (
        <RenameProjectDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={async (p) => {
            setRenaming(null);
            await onRenamed(p);
          }}
        />
      )}
      {ophalen && onImported && (
        <OphalenDialoog
          onClose={() => setOphalen(false)}
          onImported={async (p) => {
            setOphalen(false);
            await onImported(p);
          }}
        />
      )}
      <RemoveProjectDialog
        project={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={(p) => {
          setRemoving(null);
          void onRemove(p);
        }}
      />
    </div>
  );
}
