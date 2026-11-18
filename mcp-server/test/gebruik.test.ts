import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeStream, parseGeminiStream, totaalVerwerkt } from "../src/gebruik.js";

const FIX = path.resolve(__dirname, "../../src-tauri/tests/fixtures/claude");
const lees = (n: string) => readFileSync(path.join(FIX, n), "utf8");

describe("AI-gebruik uit stream-json", () => {
  it("leest tokens, cache, kosten en duur uit een echte Claude-opname", () => {
    const g = parseClaudeStream(lees("real_hello_mcp_failed.jsonl"));
    expect(g.bron).toBe("cli");
    expect(g.invoer).toBe(2);
    expect(g.uitvoer).toBe(29);
    expect(g.cacheGeschreven).toBe(41259);
    expect(g.kostenUsd).toBeCloseTo(0.16533, 4);
    expect(g.beurten).toBe(1);
    expect(g.geslaagd).toBe(true);
    expect(totaalVerwerkt(g)).toBe(2 + 29 + 41259);
  });
  it("telt tool-aanroepen en verschillende gelezen bestanden maar één keer per aanroep", () => {
    const regel = (id: string, f: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: f } }] } });
    const t = [regel("a", "/p/x.ts"), regel("a", "/p/x.ts"), regel("b", "/p/x.ts"), regel("c", "/p/y.ts"), "geen json", JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 5, output_tokens: 7 } })].join("\n");
    const g = parseClaudeStream(t);
    expect(g.toolAanroepen).toBe(3);
    expect(g.bestandenGelezen).toBe(2);
    expect(g.invoer).toBe(5);
  });
  it("meldt 'gedeeltelijk' bij een oude opname zonder usage en 'geen' zonder resultaat", () => {
    expect(parseClaudeStream(lees("simple_turn.jsonl")).bron).toBe("gedeeltelijk");
    expect(parseClaudeStream("").bron).toBe("geen");
  });
  it("leest Gemini voorzichtig en noemt het gedeeltelijk", () => {
    const g = parseGeminiStream(JSON.stringify({ type: "result", status: "success", stats: { input_tokens: 10, output_tokens: 3 } }));
    expect(g.bron).toBe("gedeeltelijk");
    expect(g.invoer).toBe(10);
    expect(parseGeminiStream("{}").bron).toBe("geen");
  });
});
