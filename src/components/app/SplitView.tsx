import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";

interface Props {
  left: ReactNode;
  right: ReactNode;
  /** Unieke naam: Studio onthoudt hierop de breedte die de gebruiker koos. */
  id: string;
}

/** Links het gesprek of de instellingen, rechts de preview. Op een smal scherm alleen links. */
export default function SplitView({ left, right, id }: Props) {
  const wide = useMediaQuery("(min-width: 1024px)");
  if (!wide) return <div className="min-h-0 min-w-0 flex-1">{left}</div>;
  return (
    <ResizablePanelGroup id={id} orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel id={`${id}-links`} defaultSize={50} minSize={30} className="min-w-0">
        {left}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id={`${id}-rechts`} defaultSize={50} minSize={25} className="min-w-0">
        <div className="flex h-full min-h-0 min-w-0 flex-col">{right}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
