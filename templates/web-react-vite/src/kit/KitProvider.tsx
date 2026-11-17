import type { ReactNode } from "react";

// Studio vervangt dit bestand als je een uiterlijk (kit) kiest.
export default function KitProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
