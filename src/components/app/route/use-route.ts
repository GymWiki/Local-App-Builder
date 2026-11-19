import { useCallback, useEffect, useRef, useState } from "react";
import { routeFeiten } from "@/lib/api";
import { bepaalRoute, geenFeiten, type Route, type RouteFeiten } from "@/lib/route";

/** De route van één project. Ververst bij elke nieuwe `tick` (de runtime meldt wijzigingen) en op verzoek. */
export function useRoute(projectId: number, tick: number) {
  const [feiten, setFeiten] = useState<RouteFeiten>(geenFeiten());
  const [geladen, setGeladen] = useState(false);
  const alive = useRef(true);

  const ververs = useCallback(async () => {
    try {
      const f = await routeFeiten(projectId);
      if (alive.current && f && typeof f === "object") {
        setFeiten(f);
        setGeladen(true);
      }
    } catch {
      /* zonder route werkt de rest gewoon */
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve(routeFeiten(projectId)).then(
      (f) => {
        if (alive.current && f && typeof f === "object") {
          setFeiten(f);
          setGeladen(true);
        }
      },
      () => undefined,
    );
    return () => {
      alive.current = false;
    };
  }, [projectId, tick]);

  const route: Route = bepaalRoute(feiten);
  return { route, feiten, geladen, ververs };
}
