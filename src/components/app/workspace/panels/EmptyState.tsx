import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  icon: ReactNode;
  titel: string;
  uitleg: string;
  knop?: string;
  onKnop?: () => void;
}

/** Een lege staat: wat er hier komt, en één ding dat de gebruiker kan doen. */
export default function EmptyState({ icon, titel, uitleg, knop, onKnop }: Props) {
  return (
    <div role="status" data-testid="lege-staat" className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border p-6 text-center">
      <span aria-hidden="true" className="text-muted-foreground">
        {icon}
      </span>
      <h3 className="text-lg font-semibold">{titel}</h3>
      <p className="max-w-md text-base text-muted-foreground">{uitleg}</p>
      {knop && onKnop && <Button onClick={onKnop}>{knop}</Button>}
    </div>
  );
}
