import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { vercelState, type VercelState } from "@/lib/api";

const LEEG: VercelState = { werkt: false, account: null, project: null, flutter: false, server_deel: false, ontbrekend: [], voorbeeld: null, live: null, laatste: null, bezig: false, nu: 0 };
export interface VercelVoortgang {
  stap: string;
  klaar: number;
  totaal: number;
}

/** De Vercel-gegevens van een project. Ververst bij elke melding van Rust en bij een wijziging van de koppeling. */
export function useVercel(projectId: number, tick = 0) {
  const [state, setState] = useState<VercelState>(LEEG);
  const [geladen, setGeladen] = useState(false);
  const [voortgang, setVoortgang] = useState<VercelVoortgang | null>(null);
  const alive = useRef(true);

  const ververs = useCallback(async () => {
    try {
      const s = await vercelState(projectId);
      if (alive.current && s && typeof s === "object") {
        setState(s);
        setGeladen(true);
      }
    } catch {
      /* zonder Vercel werkt de rest van Studio gewoon */
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve(vercelState(projectId)).then(
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
    volg<{ project_id: number; stap: string; klaar: number; totaal: number }>("vercel-voortgang", (p) => {
      if (p.project_id !== projectId) return;
      if (p.stap === "gewijzigd") {
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
