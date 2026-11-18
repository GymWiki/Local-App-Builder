import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  connectDisconnect,
  connectOpen,
  connectTest,
  type DienstId,
  type KoppelInfo,
} from "@/lib/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConnections } from "./connections-provider";
import VerbindDialoog from "./VerbindDialoog";

interface Props {
  id: DienstId;
  /** De gebruiker is verbonden (of was het al en klikt door): ga verder met wat hij deed. */
  onConnected?: (info: KoppelInfo) => void;
  /** Voor de wizard "Alles verbinden": open meteen de dialoog. */
  startOpen?: boolean;
  onDialoogGesloten?: () => void;
  /** De dialoog is geopend (de plek kan de knop dan laten staan tot hij weer dicht is). */
  onDialoogGeopend?: () => void;
}

/**
 * De Verbinden-knop van één dienst. Toestanden: niet gekoppeld, bezig, gekoppeld (met een klein menu) en verlopen.
 * Is de koppeling er al, dan toont de knop alleen de accountnaam met een ✓.
 */
export default function VerbindKnop({
  id,
  onConnected,
  startOpen = false,
  onDialoogGesloten,
  onDialoogGeopend,
}: Props) {
  const [dialoog, setDialoog] = useState(startOpen);
  // De dialoog staat los van de knop, zodat hij blijft staan als de knop verandert (bijvoorbeeld van "niet gekoppeld" naar "gekoppeld").
  return (
    <>
      <Knop
        id={id}
        onOpen={() => {
          setDialoog(true);
          onDialoogGeopend?.();
        }}
      />
      <VerbindDialoog
        id={id}
        open={dialoog}
        onClose={() => {
          setDialoog(false);
          onDialoogGesloten?.();
        }}
        onConnected={onConnected}
      />
    </>
  );
}

function Knop({ id, onOpen }: { id: DienstId; onOpen: () => void }) {
  const { t } = useTranslation();
  const { van, ververs } = useConnections();
  const k = van(id);
  const dienst = t(`koppelingen.${id}.naam`);
  const [ontkoppel, setOntkoppel] = useState<{ beheer_url: string } | null>(
    null,
  );
  const [vraag, setVraag] = useState(false);
  const status = k?.status ?? "niet_gekoppeld";

  const verlopen = status === "verlopen" || status === "fout";
  const knop =
    status === "werkt" ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            data-testid={`verbind-${id}`}
            data-status="werkt"
            aria-label={t("koppelingen.knop.menu", { dienst })}
          >
            <CheckIcon className="text-success" aria-hidden="true" />
            {t("koppelingen.knop.gekoppeldAls", {
              dienst,
              account: k?.account ?? "",
            })}
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() =>
              void connectTest(id)
                .then(ververs)
                .catch(() => undefined)
            }
          >
            {t("koppelingen.knop.test")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpen}>
            {t("koppelingen.knop.opnieuw")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setVraag(true)}
          >
            {t("koppelingen.knop.ontkoppel")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button
        data-testid={`verbind-${id}`}
        data-status={status}
        variant={verlopen ? "destructive" : "default"}
        onClick={onOpen}
      >
        {status === "bezig" ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
        ) : verlopen ? (
          <TriangleAlertIcon aria-hidden="true" />
        ) : null}
        {status === "bezig"
          ? t("koppelingen.knop.bezig")
          : verlopen
            ? t("koppelingen.knop.opnieuw")
            : t("koppelingen.knop.verbind", { dienst })}
      </Button>
    );
  // De twee bevestigingen staan altijd op dezelfde plek, ook als de knop na het ontkoppelen verandert.
  return (
    <>
      {knop}
      <AlertDialog open={vraag} onOpenChange={setVraag}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("koppelingen.ontkoppel.titel", { dienst })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("koppelingen.ontkoppel.uitleg", { dienst })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-base text-muted-foreground">
            {t("koppelingen.ontkoppel.zelfIntrekken", { dienst })}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("koppelingen.knop.annuleer")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              data-testid="ontkoppel-bevestig"
              onClick={async () => {
                setVraag(false);
                try {
                  const r = await connectDisconnect(id);
                  setOntkoppel({ beheer_url: r.beheer_url });
                } catch {
                  /* de lijst ververst hieronder; de status blijft zichtbaar */
                }
                await ververs();
              }}
            >
              {t("koppelingen.knop.ontkoppel")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!ontkoppel}
        onOpenChange={(o) => !o && setOntkoppel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("koppelingen.ontkoppel.klaar", { dienst })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("koppelingen.ontkoppel.zelfIntrekken", { dienst })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                ontkoppel &&
                void connectOpen(ontkoppel.beheer_url).catch(() => undefined)
              }
            >
              {t("koppelingen.ontkoppel.link", { dienst })}
            </Button>
            <AlertDialogCancel>{t("koppelingen.knop.klaar")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
