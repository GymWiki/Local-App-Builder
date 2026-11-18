import { useCallback, useEffect, useRef, useState } from "react";
import { chatHistory, kitCurrent, lastChecks, projectFlags, projectFlagSet, projectPages, projectSignals, runtime, type Checkpoint, type McpInfo, type PreviewInfo, type Project, type ProjectSignals } from "@/lib/api";
import { geenSignalen, type Signalen } from "@/lib/menu";
import type { WorkspaceCtx } from "./workspace-context";

/** Verzamelt de signalen voor voortgang en menu uit het project en houdt ze actueel (bij elke gebeurtenis van de runtime en bij verversen). */
export function useProjectSignals(project: Project, mcp: McpInfo | null, preview: PreviewInfo | null, tick: number) {
  const [signalen, setSignalen] = useState<Signalen>(geenSignalen);
  const [ruw, setRuw] = useState<ProjectSignals | null>(null);
  const [vlaggen, setVlaggen] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
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
      };
      setRuw(s);
      setVlaggen(val(flags, {}));
      setSignalen(next);
    })();
  }, [project.id, tick, up, draait, nonce]);

  const ververs = useCallback(() => setNonce((n) => n + 1), []);
  const setVlag: WorkspaceCtx["setVlag"] = useCallback(
    async (key, value) => {
      await projectFlagSet(project.id, key, value);
      setNonce((n) => n + 1);
    },
    [project.id],
  );

  return { signalen, ruw, vlaggen, ververs, setVlag };
}
