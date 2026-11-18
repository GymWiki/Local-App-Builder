import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  chatAttach,
  chatBusy,
  chatHistory,
  chatModeSet,
  chatRetry,
  chatSend,
  chatStop,
  chatSwitch,
  chatTarget,
  cliStatus,
  permissionAnswer,
  runtime,
  type Account,
  type ChatMessage,
  type ChatMode,
  type ChatOut,
  type ChatStatus,
  type ChatTarget,
  type SavedAsset,
  type CliStatus,
  type Project,
  type Provider,
  type RestoreResult,
} from "@/lib/api";
import InstallGuide from "@/components/InstallGuide";
import ChatSwitchDialog from "./ChatSwitchDialog";
import VersionsDialog from "./VersionsDialog";
import MessageView from "./MessageView";
import AssetThumb from "./AssetThumb";
import ImproveDialog from "./ImproveDialog";
import { WandSparklesIcon } from "lucide-react";
import {
  CircleDotIcon,
  LoaderIcon,
  PaperclipIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { checkFile, MAX_FILES, pastedName, readBase64 } from "./files";
import PermissionDialog from "./PermissionDialog";

interface Props {
  project: Project;
  accounts: Account[];
  /** "Technisch"-stand: ruwe details staan standaard open. */
  technical: boolean;
  onOpenAdvanced: () => void;
  onOpenAccounts: () => void;
  onError: (msg: string) => void;
}

import starter from "@/data/starter.json";

/** Vaste snelle acties onder het gesprek; de teksten staan in src/data/starter.json. */
const QUICK = starter.snelleActies;

export default function ChatPanel({
  project,
  accounts,
  technical,
  onOpenAdvanced,
  onOpenAccounts,
  onError,
}: Props) {
  const { t } = useTranslation();
  const id = project.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("build");
  const [missing, setMissing] = useState<CliStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [improving, setImproving] = useState<string | null>(null);
  const [pending, setPending] = useState<SavedAsset[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const fail = useCallback(
    (e: unknown) => onError(t("fout.algemeen", { bericht: String(e) })),
    [onError, t],
  );

  // Geschiedenis, doel-AI en of er al iets bezig is: bij het (her)openen van het project.
  useEffect(() => {
    let cancelled = false;
    Promise.all([chatTarget(id), chatHistory(id), chatBusy(id)])
      .then(([tg, h, b]) => {
        if (cancelled) return;
        setTarget(tg);
        setMode(tg.mode ?? "build");
        setMessages(h);
        setBusy(b);
        setStatus(b ? "thinking" : "idle");
        setFallback(
          h.some((m) => m.kind === "notice" && m.payload.kind === "fallback") &&
            h.at(-1)?.kind === "notice",
        );
      })
      .catch((e) => !cancelled && fail(e));
    return () => {
      cancelled = true;
    };
  }, [id, fail]);

  // Live gebeurtenissen van de AI.
  useEffect(() => {
    const un = listen<ChatOut>("chat-out", (e) => {
      const ev = e.payload;
      if (ev.project_id !== id) return;
      if (ev.type === "message")
        setMessages((m) =>
          m.some((x) => x.id === ev.message.id) ? m : [...m, ev.message],
        );
      else if (ev.type === "update")
        setMessages((m) =>
          m.map((x) => (x.id === ev.message.id ? ev.message : x)),
        );
      else if (ev.type === "status") {
        setStatus(ev.state);
        setBusy(ev.busy);
      } else if (ev.type === "fallback") setFallback(true);
      else if (ev.type === "mode") setMode(ev.mode);
    });
    return () => void un.then((f) => f());
  }, [id]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, status]);

  async function send(body: string, fromProposal = false) {
    const trimmed = body.trim();
    const files = body === text || fromProposal ? pending : [];
    if (
      (!trimmed && files.length === 0) ||
      !target?.structured ||
      uploading > 0
    )
      return;
    try {
      const st = await cliStatus(target.provider);
      if (!st.installed) return setMissing(st);
      setMissing(null);
      setText("");
      setPending([]);
      if (files.length > 0)
        await chatSend(
          id,
          trimmed,
          files.map((f) => f.path),
        );
      else await chatSend(id, trimmed);
    } catch (e) {
      fail(e);
    }
  }

  // Bestanden toevoegen (slepen, plakken of kiezen): elk wordt eerst gecontroleerd en dan in assets/ van het project bewaard.
  async function addFiles(files: File[]) {
    let count = pending.length;
    for (const file of files) {
      const name = pastedName(file, Date.now() % 100000);
      if (count >= MAX_FILES) {
        onError(t("chat.bijlage.teVeel", { max: MAX_FILES }));
        break;
      }
      const c = checkFile(name, file.size);
      if (!c.ok) {
        onError(
          c.reason === "size"
            ? t("chat.bijlage.teGroot", { naam: name, max: c.max })
            : t("chat.bijlage.typeNiet", { naam: name }),
        );
        continue;
      }
      count++;
      setUploading((n) => n + 1);
      try {
        const saved = await chatAttach(id, name, await readBase64(file));
        setPending((p) => [...p, saved]);
      } catch (e) {
        count--;
        onError(t("chat.bijlage.mislukt", { naam: name, reden: String(e) }));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer?.files ?? []));
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return; // gewone tekst plakken werkt zoals altijd
    e.preventDefault();
    void addFiles(files);
  }

  async function chooseMode(m: ChatMode) {
    if (m === mode) return;
    setMode(m);
    try {
      await chatModeSet(id, m);
    } catch (e) {
      fail(e);
    }
  }

  // Uit de bug-lus: eerst overleggen in plaats van verder bouwen.
  async function discuss() {
    try {
      await chatModeSet(id, "plan");
      setMode("plan");
      await chatSend(id, t("chat.lus.overlegPrompt"));
    } catch (e) {
      fail(e);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  }

  async function switchTo(provider: Provider, accountId: number | null) {
    setSwitching(false);
    try {
      setFallback(false);
      setTarget(await chatSwitch(id, provider, accountId));
    } catch (e) {
      fail(e);
    }
  }

  const lastLoopId = [...messages]
    .reverse()
    .find((x) => x.kind === "loop_alert")?.id;
  const asked =
    messages.find(
      (m) => m.kind === "permission" && m.payload.state === "asked",
    ) ?? null;
  const aiName = target ? t(`provider.${target.provider}`) : "";
  const unavailable = target && (!target.structured || fallback);

  return (
    <section
      aria-label={t("chat.titel")}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden bg-background [container-type:size] ${dragging ? "outline outline-4 -outline-offset-4 outline-primary" : ""}`}
      onDragOver={(e) => {
        if (unavailable || !e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(e) => (unavailable ? e.preventDefault() : onDrop(e))}
    >
      {dragging && (
        <div
          role="note"
          data-testid="drop-hint"
          className="pointer-events-none absolute inset-x-0 top-1/3 z-10 mx-auto w-fit rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground shadow-lg"
        >
          {t("chat.bijlage.sleep")}
        </div>
      )}
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-base text-muted-foreground">
          <span className="sr-only">{t("chat.titel")} </span>
          {target && (
            <>
              {aiName}
              {target.account_label ? ` · ${target.account_label}` : ""}
            </>
          )}
        </h2>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowVersions(true)}
          >
            {t("versies.knop")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSwitching(true)}
          >
            {t("chat.wissel")}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenAdvanced}>
            {t("chat.technisch")}
          </Button>
        </div>
      </header>

      <ScrollArea
        role="log"
        aria-live="polite"
        aria-label={t("chat.geschiedenis")}
        className="min-h-24 flex-1"
      >
        <div className="space-y-3 px-5 py-4">
          {messages.length === 0 && !unavailable && (
            <section aria-label={t("chat.start.titel")} className="space-y-3">
              <p className="text-lg text-muted-foreground">{t("chat.leeg")}</p>
              <h3 className="text-lg font-semibold">{t("chat.start.titel")}</h3>
              <p className="text-base text-muted-foreground">
                {t("chat.start.uitleg")}
              </p>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {starter.voorbeelden.map((v) => (
                  <li key={v.id}>
                    <Button
                      variant="outline"
                      className="h-auto w-full flex-col items-start gap-1 py-3 text-left whitespace-normal"
                      aria-label={`${t("chat.start.knop")}: ${v.titel}`}
                      onClick={() => void send(v.prompt)}
                    >
                      <span className="font-semibold">{v.titel}</span>
                      <span className="text-sm font-normal text-muted-foreground">
                        {v.uitleg}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {messages.map((m) => (
            <MessageView
              key={m.id}
              message={m}
              live={busy}
              technical={technical}
              canRetry={
                !busy &&
                m.id ===
                  [...messages].reverse().find((x) => x.kind === "error")?.id
              }
              onRetry={() => void chatRetry(id).catch(fail)}
              onOpenAccounts={onOpenAccounts}
              loop={{
                active: m.id === lastLoopId && !busy,
                onRestore: async (hash) => {
                  await runtime<RestoreResult>(id, "git.restore", { hash });
                },
                onDiscuss: () => void discuss(),
                onOtherAi: () => setSwitching(true),
              }}
            />
          ))}
          {missing && (
            <InstallGuide
              status={missing}
              onInstalled={() => setMissing(null)}
            />
          )}
          {unavailable && (
            <Alert
              data-testid="terminal-fallback"
              role="note"
              className="space-y-3 border-warning bg-warning/10 p-5 text-lg"
            >
              <AlertTitle className="font-semibold">
                {t("chat.terugval.titel")}
              </AlertTitle>
              <AlertDescription className="space-y-3 text-lg text-foreground">
                <p>
                  {fallback && target?.structured
                    ? t("chat.terugval.uitlegFout")
                    : t("chat.terugval.uitleg", { ai: aiName })}
                </p>
                <Button onClick={onOpenAdvanced}>{t("chat.technisch")}</Button>
              </AlertDescription>
            </Alert>
          )}
          <div ref={end} />
        </div>
      </ScrollArea>

      <div
        role="status"
        aria-live="polite"
        data-testid="status-line"
        className={`flex items-center gap-3 border-t border-border px-5 py-2 text-base text-muted-foreground ${busy ? "" : "[@container(max-height:560px)]:sr-only"}`}
      >
        {busy ? (
          <LoaderIcon aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <CircleDotIcon aria-hidden="true" className="size-4" />
        )}
        <span>
          {t(
            `chat.status.${busy ? status : status === "done" ? "done" : "idle"}`,
          )}
        </span>
        {busy && (
          <Button
            variant="outline"
            size="xs"
            className="ml-auto"
            onClick={() => void chatStop(id)}
          >
            <SquareIcon aria-hidden="true" />
            {t("chat.stop")}
          </Button>
        )}
      </div>

      {messages.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto px-5 pb-2 [@container(max-height:620px)]:hidden"
          role="group"
          aria-label={t("chat.snel.titel")}
        >
          {QUICK.map((a) => (
            <Button
              key={a.id}
              variant="outline"
              size="sm"
              className="shrink-0 rounded-full"
              disabled={!!unavailable}
              onClick={() => void send(a.prompt)}
            >
              {a.label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 rounded-full"
            disabled={!!unavailable}
            onClick={() => void send(t("chat.snelPrompt.veranderd"))}
          >
            {t("chat.snel.veranderd")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 pt-3">
        <span className="text-base text-muted-foreground [@container(max-height:560px)]:hidden">
          {t("chat.modus.kop")}
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="default"
          role="radiogroup"
          aria-label={t("chat.modus.label")}
          value={mode}
          disabled={!!unavailable}
          onValueChange={(v) => v && void chooseMode(v as ChatMode)}
          spacing={0}
        >
          {(["plan", "build"] as const).map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              title={t(`chat.modus.${m}Uitleg`)}
              className="px-4 text-base data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-accent-foreground"
            >
              {t(`chat.modus.${m}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {mode === "plan" && (
          <span data-testid="plan-banner" className="text-sm text-warning">
            {t("chat.modus.banner")}
          </span>
        )}
      </div>
      {(pending.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          <ul
            aria-label={t("chat.bijlage.lijst")}
            className="flex flex-wrap gap-3"
          >
            {pending.map((a) => (
              <li key={a.path} className="relative">
                <AssetThumb
                  projectId={id}
                  path={a.path}
                  name={a.name}
                  kind={a.kind}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  aria-label={t("chat.bijlage.verwijder", { naam: a.name })}
                  onClick={() =>
                    setPending((p) => p.filter((x) => x.path !== a.path))
                  }
                  className="absolute -top-2 -right-2 rounded-full"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {uploading > 0 && (
            <span role="status" className="text-base text-muted-foreground">
              {t("chat.bijlage.bezig")}
            </span>
          )}
        </div>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-2 p-4">
        {/* Verborgen bestandskiezer: shadcn heeft hiervoor geen onderdeel; de zichtbare knop is een <Button>. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="file-input"
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <label className="sr-only" htmlFor="chat-input">
          {t("chat.invoerLabel")}
        </label>
        <Textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          disabled={!!unavailable}
          rows={2}
          placeholder={
            mode === "plan"
              ? t("chat.modus.placeholderPlan")
              : t("chat.placeholder")
          }
          className="max-h-[min(12rem,30dvh)] min-h-16 w-full min-w-0 resize-none overflow-y-auto text-lg leading-relaxed [field-sizing:content]"
          aria-describedby="chat-hint"
        />
        <p
          id="chat-hint"
          className="text-sm text-muted-foreground [@container(max-height:560px)]:sr-only"
        >
          {t("chat.hint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-label={t("chat.bijlage.kies")}
            title={t("chat.bijlage.kies")}
            disabled={!!unavailable}
            onClick={() => picker.current?.click()}
          >
            <PaperclipIcon aria-hidden="true" />
            <span className="[@container(max-width:480px)]:sr-only">{t("chat.bijlage.knop")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            title={t("chat.verbeter.knopUitleg")}
            disabled={!text.trim() || !!unavailable || !target?.structured}
            onClick={() => setImproving(text.trim())}
          >
            <WandSparklesIcon aria-hidden="true" />
            <span className="[@container(max-width:480px)]:sr-only">{t("chat.verbeter.knop")}</span>
          </Button>
          <Button
            type="submit"
            size="lg"
            className="ml-auto"
            disabled={
              (!text.trim() && pending.length === 0) ||
              uploading > 0 ||
              !!unavailable
            }
          >
            <SendIcon aria-hidden="true" />
            {t("chat.verstuur")}
          </Button>
        </div>
      </form>

      {asked && (
        <PermissionDialog
          message={asked}
          technical={technical}
          onAnswer={(allow) =>
            void permissionAnswer(id, asked.payload.req_id, allow).catch(fail)
          }
        />
      )}
      {improving !== null && (
        <ImproveDialog
          projectId={id}
          original={improving}
          onClose={() => setImproving(null)}
          onUse={(v) => {
            setText(v);
            setImproving(null);
          }}
          onSend={(v) => {
            setImproving(null);
            void send(v, true);
          }}
        />
      )}
      {showVersions && (
        <VersionsDialog
          projectId={id}
          onClose={() => setShowVersions(false)}
          onError={onError}
        />
      )}
      {switching && (
        <ChatSwitchDialog
          accounts={accounts}
          onCancel={() => setSwitching(false)}
          onPick={(p, a) => void switchTo(p, a)}
        />
      )}
    </section>
  );
}
