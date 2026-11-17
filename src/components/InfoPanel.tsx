import { useTranslation } from "react-i18next";
import type { Account, McpInfo, Project } from "@/lib/api";
import ActivityPanel from "./ActivityPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  project: Project | null;
  accounts: Account[];
  onDefaultAccount: (accountId: number | null) => void | Promise<void>;
  onClose: () => void;
  mcp?: McpInfo | null;
  tick?: number;
  onError?: (msg: string) => void;
  /** Op de rustige Maken-weergave alleen tonen op brede schermen. */
  quietUnlessWide?: boolean;
}

export default function InfoPanel({ project, accounts, onDefaultAccount, onClose, mcp = null, tick = 0, onError, quietUnlessWide = false }: Props) {
  const { t } = useTranslation();
  const rows: [string, string][] = project
    ? [
        [t("info.naam"), project.naam],
        [t("info.pad"), project.pad],
        [t("info.template"), project.template],
        [t("info.aangemaakt"), project.created_at],
      ]
    : [];

  const SYSTEM = "__systeem__";
  return (
    <aside className={`w-72 shrink-0 border-l border-border bg-card ${quietUnlessWide ? "hidden 2xl:block" : ""}`}>
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <h2 className="text-sm tracking-wide text-muted-foreground uppercase">{t("info.titel")}</h2>
          {project ? (
            <div className="space-y-5">
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
                <Label htmlFor="standaard-account">{t("info.standaardAccount")}</Label>
                <Select value={project.default_account_id != null ? String(project.default_account_id) : SYSTEM} onValueChange={(v) => void onDefaultAccount(v === SYSTEM ? null : Number(v))}>
                  <SelectTrigger id="standaard-account" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM}>{t("terminal.systeemstandaard")}</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {t(`provider.${a.provider}`)} · {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ActivityPanel project={project} mcp={mcp} tick={tick} onError={onError ?? (() => undefined)} />
              <Button variant="outline" className="h-auto min-h-11 w-full py-2 whitespace-normal" onClick={onClose}>
                {t("info.sluit")}
              </Button>
            </div>
          ) : (
            <p className="text-base text-muted-foreground">{t("info.geenSelectie")}</p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
