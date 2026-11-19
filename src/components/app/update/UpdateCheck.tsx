import { useEffect, useRef, useState } from "react";
import { updateCheck, type UpdateInfo } from "@/lib/api";
import { useSettings } from "@/components/app/settings-provider";
import UpdateDialoog from "./UpdateDialoog";

/** Bij het openen van Studio: kijken of er een nieuwere versie is (tenzij de gebruiker dat heeft uitgezet) en zo ja de vraag tonen. */
export default function UpdateCheck() {
  const { settings, geladen } = useSettings();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const gedaan = useRef(false);
  const aan = settings.update_check;

  useEffect(() => {
    if (gedaan.current || !geladen) return; // pas als de instellingen gelezen zijn, zodat een 'uit' altijd wordt gerespecteerd
    gedaan.current = true;
    if (!aan) return;
    void Promise.resolve(updateCheck()).then(
      (r) => r?.status === "beschikbaar" && setInfo(r),
      () => undefined, // geen internet of storing: Studio werkt gewoon door
    );
  }, [aan, geladen]);

  return <UpdateDialoog info={info} onClose={() => setInfo(null)} />;
}
