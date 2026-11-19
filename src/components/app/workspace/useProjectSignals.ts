import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatHistory, kitCurrent, lastChecks, projectFlags, projectFlagSet, projectPages, projectSignals, runtime, type Checkpoint, type McpInfo, type PreviewInfo, type Project, type ProjectSignals } from "@/lib/api";
import { supaSecurityCheck, supaStatus } from "@/lib/api";
import { backupStatus, geenSignalen, type Koppelingen, type Signalen } from "@/lib/menu";
import { useGithub } from "@/components/app/github/use-github";
import { useConnections } from "@/components/app/connect/connections-provider";
import type { WorkspaceCtx } from "./workspace-context";

/** Verzamelt de signalen voor voortgang en menu uit het project en houdt ze actueel (bij elke gebeurtenis van de runtime en bij verversen). */
export function useProjectSignals(project: Project, mcp: McpInfo | null, preview: PreviewInfo | null, tick: number) {
  const [signalen, setSignalen] = useState<Signalen>(geenSignalen);
  const [ruw, setRuw] = useState<ProjectSignals | null>(null);
  const [vlaggen, setVlaggen] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
  const { lijst } = useConnections();
  const koppelingen = useMemo(() => Object.fromEntries(lijst.map((k) => [k.id, k.status])) as Koppelingen, [lijst]);
  const up = mcp?.state === "running" || mcp?.state === "connected";
  const draait = preview?.status === "running";
  const bezig = useRef(0);

  useEffect(() => {
    const ronde = ++bezig.current;
    void (async () => {
      const [sig, flags, hist, vers, chk, kit, pagina] = await Promise.allSettled([
        projectSignals(project.id),
        projectFlags(project.id),
        chatHistory(project.id, 200),
        up ? runtime<Checkpoint[]>(project.id, "git.list", { limit: 50 }) : Promise.resolve([] as Checkpoint[]),
        lastChecks(project.id, 1),
        up ? kitCurrent(project.id) : Promise.resolve(null),
        projectPages(project.id),
      ]);
      if (ronde !== bezig.current) return; // een nieuwere ronde is onderweg
      const val = <T,>(r: PromiseSettledResult<T>, d: T): T => (r.status === "fulfilled" && r.value != null ? r.value : d);
      const s = val(sig, null);
      const next: Signalen = {
        eersteOpdracht: val(hist, []).some((m) => m.kind === "user"),
        projectMdIngevuld: s?.project_md_ingevuld ?? false,
        previewDraait: draait,
        aantalVersies: val(vers, []).length,
        online: val(flags, {}).online_gezet === "1",
        kitGekozen: !!val(kit, null)?.kit,
        checksFalen: val(chk, [])[0]?.ok === false,
        heeftDatabase: s?.heeft_database ?? false,
        needsData: s?.needs_data ?? false,
        aantalFotos: s?.aantal_assets ?? 0,
        aantalSchermen: val(pagina, []).length,
        koppelingen: {},
        databaseProbleem: false,
        backup: "geen",
      };
      setRuw(s);
      setVlaggen(val(flags, {}));
      setSignalen(next);
    })();
  }, [project.id, tick, up, draait, nonce]);

  // Een gekoppeld Supabase-project: gepauzeerd of tabellen zonder beveiliging geven een "!" bij Wat je app onthoudt.
  const [databaseProbleem, setDatabaseProbleem] = useState(false);
  const supaWerkt = koppelingen.supabase === "werkt";
  useEffect(() => {
    if (!supaWerkt) return;
    let weg = false;
    void (async () => {
      try {
        const st = await supaStatus(project.id);
        const d = st?.data as { gekoppeld?: boolean; gepauzeerd?: boolean } | undefined;
        if (!d?.gekoppeld) return !weg && setDatabaseProbleem(false);
        if (d.gepauzeerd) return !weg && setDatabaseProbleem(true);
        const c = await supaSecurityCheck(project.id);
        const ernstig = (c.bevindingen ?? []).some((b) => b.code === "rls_uit" || b.code === "beleid_alles_schrijfbaar");
        if (!weg) setDatabaseProbleem(ernstig);
      } catch {
        /* geen probleem melden bij een tijdelijke storing */
      }
    })();
    return () => {
      weg = true;
    };
  }, [project.id, supaWerkt, tick, nonce]);

  const ververs = useCallback(() => setNonce((n) => n + 1), []);
  const setVlag: WorkspaceCtx["setVlag"] = useCallback(
    async (key, value) => {
      await projectFlagSet(project.id, key, value);
      setNonce((n) => n + 1);
    },
    [project.id],
  );

  // De koppelingen komen uit hun eigen context en veranderen los van de rest; ze worden hier bij de signalen gevoegd.
  const { state: gh } = useGithub(project.id, tick + nonce);
  const backup = useMemo(() => (gh.werkt ? backupStatus(gh, gh.nu) : "geen"), [gh]);
  const metKoppelingen = useMemo(() => ({ ...signalen, koppelingen, databaseProbleem: supaWerkt && databaseProbleem, backup }), [signalen, koppelingen, supaWerkt, databaseProbleem, backup]);
  return { signalen: metKoppelingen, ruw, vlaggen, ververs, setVlag };
}
