import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { connectList, type DienstId, type KoppelInfo } from "@/lib/api";

interface State {
  lijst: KoppelInfo[];
  /** De koppeling van één dienst (of `undefined` zolang de lijst nog laadt). */
  van: (id: DienstId) => KoppelInfo | undefined;
  ververs: () => Promise<void>;
}

const Ctx = createContext<State>({ lijst: [], van: () => undefined, ververs: async () => undefined });
export const useConnections = () => useContext(Ctx);

/** Houdt de status van alle koppelingen bij; Rust meldt elke verandering (`connect-changed`). Bevat nooit een token. */
export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [lijst, setLijst] = useState<KoppelInfo[]>([]);
  const alive = useRef(true);

  const ververs = useCallback(async () => {
    try {
      const l = await connectList();
      if (alive.current && Array.isArray(l)) setLijst(l);
    } catch {
      /* zonder koppelingen werkt de rest van Studio gewoon */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    // Eerste keer laden en daarna bij elke melding van Rust; `ververs` zet de toestand pas als het antwoord er is.
    void connectList().then(
      (l) => alive.current && Array.isArray(l) && setLijst(l),
      () => undefined,
    );
    let off: (() => void) | undefined;
    void listen("connect-changed", () => void ververs())
      .then((u) => {
        if (alive.current) off = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
      off?.();
    };
  }, [ververs]);

  const waarde = useMemo(() => ({ lijst, van: (id: DienstId) => lijst.find((k) => k.id === id), ververs }), [lijst, ververs]);
  return <Ctx.Provider value={waarde}>{children}</Ctx.Provider>;
}
