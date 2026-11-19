import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  titel: string;
  uitleg?: string;
  /** Bijvoorbeeld "Komt binnenkort". */
  badge?: string;
  children?: ReactNode;
}

/** Vaste opmaak van een paneel: titel, één zin uitleg en daaronder de inhoud. */
export default function Frame({ titel, uitleg, badge, children }: Props) {
  return (
    <ScrollArea className="h-full [&>[data-slot=scroll-area-viewport]>div]:!block">
      <div className="space-y-5 p-5">
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{titel}</h2>
            {badge && <Badge variant="secondary">{badge}</Badge>}
          </div>
          {uitleg && <p className="text-base text-muted-foreground">{uitleg}</p>}
        </header>
        {children}
      </div>
    </ScrollArea>
  );
}
