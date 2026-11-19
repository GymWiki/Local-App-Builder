import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { supaState, type SupaState } from "@/lib/api";

const LEEG: SupaState = { gekoppeld: false, naam: "", referentie: "", regio: "", niveau: "voorzichtig", volledig_resterend: null, volledig_secs: 3600 };

/** De Supabase-koppeling van een project (niveau, project, resterende tijd van volledige controle). Ververst bij elke melding van Rust. */
export function useSupa(projectId: number) {
  const [state, setState] = useState<SupaState>(LEEG);
  const [geladen, setGeladen] = useState(false);
  const alive = useRef(true);

  const ververs = useCallback(async () => {
    try {
      const s = await supaState(projectId);
      if (alive.current && s && typeof s === "object") {
        setState(s);
        setGeladen(true);
      }
    } catch {
      /* zonder koppeling werkt de rest van Studio gewoon */
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve(supaState(projectId))
.then(
      (s) => {
        if (alive.current && s && typeof s === "object") {
          setState(s);
          setGeladen(true);
        }
      },
      () => undefined,
    );
    let off: (() => void) | undefined;
    void listen<{ project_id: number }>("supa-changed", (e) => {
      if (e.payload?.project_id === projectId) void ververs();
    })
      .then((u) => {
        if (alive.current) off = u;
        else u();
      })
      .catch(() => undefined);
    // "Volledige controle" loopt vanzelf af; kijk elke 30 seconden of het nog geldt.
    const t = setInterval(() => void ververs(), 30_000);
    return () => {
      alive.current = false;
      off?.();
      clearInterval(t);
    };
  }, [projectId, ververs]);

  return { state, geladen, ververs };
}

/** Formatteert resterende seconden als "1 uur 5 min" of "12 min". */
export function tijdTekst(sec: number): string {
  const m = Math.max(0, Math.ceil(sec / 60));
  if (m >= 60) return `${Math.floor(m / 60)} uur ${m % 60} min`;
  return `${m} min`;
}
