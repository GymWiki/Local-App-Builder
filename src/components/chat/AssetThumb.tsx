import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { chatAssetData } from "../../lib/api";

interface Props {
  projectId: number;
  path: string;
  name: string;
  kind: string;
  size?: "klein" | "groot";
}

/** Miniatuur van een bijlage (afbeelding) of een naamlabel (document). */
export default function AssetThumb({ projectId, path, name, kind, size = "klein" }: Props) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "image") return;
    let off = false;
    chatAssetData(projectId, path)
      .then((d) => !off && setSrc(d))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [projectId, path, kind]);
  const box = size === "groot" ? "h-24 w-24" : "h-16 w-16";
  if (src) return <img src={src} alt={t("chat.bijlage.alt", { naam: name })} className={`${box} rounded-lg border border-zinc-600 object-cover`} />;
  return (
    <span title={name} className={`flex ${box} flex-col items-center justify-center gap-1 rounded-lg border border-zinc-600 bg-zinc-800 px-1 text-center text-xs text-zinc-200`}>
      <span aria-hidden="true">{kind === "image" ? "🖼" : "📄"}</span>
      <span className="w-full truncate">{name}</span>
    </span>
  );
}
