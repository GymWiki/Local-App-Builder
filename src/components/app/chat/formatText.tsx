import type { ReactNode } from "react";

/** Eenvoudige opmaak voor AI-antwoorden: alinea's, lijsten, **vet** en `code`. Geen HTML-injectie: alles wordt als React-tekst gerenderd. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("**") ? (
        <strong key={`${keyPrefix}-${i++}`}>{tok.slice(2, -2)}</strong>
      ) : (
        <code key={`${keyPrefix}-${i++}`} className="rounded bg-muted px-1.5 py-0.5 text-[0.95em]">
          {tok.slice(1, -1)}
        </code>
      ),
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function FormattedText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const listLike = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (listLike) {
          const ordered = /^\s*\d+[.)]/.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `b${bi}l${li}`)}</li>);
          return ordered ? (
            <ol key={bi} className="list-decimal space-y-1 pl-6">
              {items}
            </ol>
          ) : (
            <ul key={bi} className="list-disc space-y-1 pl-6">
              {items}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l, `b${bi}l${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
