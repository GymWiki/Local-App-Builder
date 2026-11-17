import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRoundIcon, PlusIcon, SettingsIcon, XIcon } from "lucide-react";
import { deleteProject, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

interface Props {
  projects: Project[];
  selectedId: number | null;
  accountsActive: boolean;
  onAccounts: () => void;
  settingsActive?: boolean;
  onSettings?: () => void;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDeleted: (id: number) => void | Promise<void>;
  onError: (msg: string) => void;
}

/** Projectenlijst, "Nieuw project", accounts en instellingen. Projecten verwijderen haalt ze alleen uit de lijst. */
export default function AppSidebar({ projects, selectedId, accountsActive, settingsActive = false, onSettings, onSelect, onNew, onAccounts, onDeleted, onError }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Project | null>(null);

  async function remove(p: Project) {
    setTarget(null);
    try {
      await deleteProject(p.id);
      await onDeleted(p.id);
    } catch (e) {
      onError(t("fout.algemeen", { bericht: String(e) }));
    }
  }

  return (
    <>
      <Sidebar collapsible="none" className="w-64 shrink-0 border-r border-sidebar-border">
        <SidebarHeader className="gap-3 p-4">
          <div className="text-xl font-semibold">{t("app.naam")}</div>
          <Button onClick={onNew} className="w-full">
            <PlusIcon aria-hidden="true" />
            {t("sidebar.nieuwProject")}
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-sm">{t("sidebar.projecten")}</SidebarGroupLabel>
            <SidebarMenu>
              {projects.length === 0 && <li className="px-2 py-2 text-base text-muted-foreground">{t("sidebar.leeg")}</li>}
              {projects.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton size="lg" isActive={p.id === selectedId} title={p.naam} onClick={() => onSelect(p.id)} className="text-base">
                    <span className="truncate">{p.naam}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction showOnHover aria-label={`${t("sidebar.verwijder")}: ${p.naam}`} title={t("sidebar.verwijder")} onClick={() => setTarget(p)} className="top-1.5">
                    <XIcon aria-hidden="true" />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" isActive={accountsActive} aria-current={accountsActive} onClick={onAccounts} className="text-base">
                <KeyRoundIcon aria-hidden="true" />
                {t("accounts.titel")}
              </SidebarMenuButton>
            </SidebarMenuItem>
            {onSettings && (
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" isActive={settingsActive} aria-current={settingsActive} onClick={onSettings} className="text-base">
                  <SettingsIcon aria-hidden="true" />
                  {t("sidebar.instellingen")}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sidebar.verwijderTitel")}</AlertDialogTitle>
            <AlertDialogDescription>{target ? t("sidebar.bevestigVerwijder", { naam: target.naam }) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.annuleer")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => target && void remove(target)}>{t("sidebar.verwijderKnop")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
