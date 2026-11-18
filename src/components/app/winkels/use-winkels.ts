import { useCallback, useEffect, useRef, useState } from "react";
import { winkelsOverzicht, type WinkelOverzicht } from "@/lib/api";

/** Het overzicht van de appwinkel voor een project (gegevens, klaar-check, invulhulp, controle). Ververst op verzoek en bij een nieuwe `tick`. */
export function useWinkels(projectId: number, tick = 0) {
  const [o, setO] = useState<WinkelOverzicht | null>(null);
  const alive = useRef(true);

  const ververs = useCallback(async () => {
    try {
      const r = await winkelsOverzicht(projectId);
      if (alive.current && r && typeof r === "object") setO(r);
    } catch {
      /* zonder overzicht blijft het scherm op de vorige stand staan */
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve(winkelsOverzicht(projectId)).then(
      (r) => alive.current && r && typeof r === "object" && setO(r),
      () => undefined,
    );
    return () => {
      alive.current = false;
    };
  }, [projectId, tick]);

  return { overzicht: o, ververs };
}
