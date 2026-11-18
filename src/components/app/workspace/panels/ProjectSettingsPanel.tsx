import { useTranslation } from "react-i18next";
import type { Account, Project } from "@/lib/api";
import SettingsScreen, {
  type CommunicationMode,
  type PermissionMode,
} from "@/components/SettingsScreen";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const SYSTEM = "__systeem__";

export interface SettingsProps {
  communication: CommunicationMode;
  permission: PermissionMode;
  loopThreshold: number;
  onLoopThreshold: (n: number) => void;
  onCommunication: (v: CommunicationMode) => void;
  onPermission: (v: PermissionMode) => void;
}

interface Props extends SettingsProps {
  project: Project;
  accounts: Account[];
  onDefaultAccount: (accountId: number | null) => void | Promise<void>;
}

/** Eerst gegevens en het standaardaccount van dit project, daaronder de instellingen voor alle projecten. */
export default function ProjectSettingsPanel({
  project,
  accounts,
  onDefaultAccount,
  ...settings
}: Props) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t("werkruimte.project.naam"), project.naam],
    [t("werkruimte.project.map"), project.pad],
    [t("werkruimte.project.soort"), project.template],
    [t("werkruimte.project.aangemaakt"), project.created_at],
  ];
  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-5">
        <h2 className="text-lg font-semibold">
          {t("werkruimte.project.titel")}
        </h2>
        <Card size="sm">
          <CardContent>
            <dl className="space-y-3 text-base">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm text-muted-foreground">{k}</dt>
                  <dd className="break-all">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="space-y-2">
          <Label htmlFor="standaard-account">
            {t("werkruimte.project.standaard")}
          </Label>
          <Select
            value={
              project.default_account_id != null
                ? String(project.default_account_id)
                : SYSTEM
            }
            onValueChange={(v) =>
              void onDefaultAccount(v === SYSTEM ? null : Number(v))
            }
          >
            <SelectTrigger id="standaard-account" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM}>
                {t("terminal.systeemstandaard")}
              </SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {t(`provider.${a.provider}`)} · {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <h2 className="text-lg font-semibold">
          {t("werkruimte.project.algemeen")}
        </h2>
      </div>
      <SettingsScreen {...settings} />
    </ScrollArea>
  );
}
