import { useSyncExternalStore } from "react";

/** Is de media query nu waar? (bijv. de breedte voor "chat links, preview rechts") */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener?.("change", notify);
      return () => mq?.removeEventListener?.("change", notify);
    },
    () => (window.matchMedia ? window.matchMedia(query).matches : true),
    () => true,
  );
}
