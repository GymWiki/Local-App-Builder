import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { githubState, type GhState } from "@/lib/api";

const LEEG: GhState = { werkt: false, account: null, link: null, versies: 0, nieuw: 0, bezig: false };
export interface Voortgang {
  stap: string;
  klaar: number;
  totaal: number;
}

/** De GitHub-back-up van een project. Ververst bij elke melding van Rust en bij een wijziging van de koppeling. */
export function useGithub(projectId: number, tick = 0) {
  const [state, setState] = useState<GhState>(LEEG);
  const [geladen, setGeladen] = useState(false);
  const [voortgang, setVoortgang] = useState<Voortgang | null>(null);
  const alive = useRef(true);

  const ververs = useCallback(async () => {
    try {
      const s = await githubState(projectId);
      if (alive.current && s && typeof s === "object") {
        setState(s);
        setGeladen(true);
      }
    } catch {
      /* zonder GitHub werkt de rest van Studio gewoon */
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve(githubState(projectId)).then(
      (s) => {
        if (alive.current && s && typeof s === "object") {
          setState(s);
          setGeladen(true);
        }
      },
      () => undefined,
    );
    const offs: (() => void)[] = [];
    const volg = <T,>(naam: string, f: (p: T) => void) =>
      void listen<T>(naam, (e) => f(e.payload))
        .then((u) => (alive.current ? offs.push(u) : u()))
        .catch(() => undefined);
    volg<{ project_id: number; stap: string; klaar: number; totaal: number }>("github-voortgang", (p) => {
      if (p.project_id !== projectId) return;
      if (p.stap === "gewijzigd" || p.stap === "klaar") {
        setVoortgang(null);
        void ververs();
      } else setVoortgang({ stap: p.stap, klaar: p.klaar, totaal: p.totaal });
    });
    volg("connect-changed", () => void ververs());
    return () => {
      alive.current = false;
      offs.forEach((o) => o());
    };
  }, [projectId, ververs, tick]);

  return { state, geladen, voortgang, ververs };
}
