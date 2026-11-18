// Draait vóór `tauri dev` (beforeDevCommand). Is poort 1420 al bezet, dan stopt het met een duidelijke fout,
// zodat Studio nooit stilletjes een oude Vite-server van een andere map of een eerdere sessie gebruikt.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";

const POORT = 1420;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function proces() {
  try {
    if (process.platform === "win32") return execSync(`netstat -ano | findstr :${POORT}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return execSync(`lsof -nP -iTCP:${POORT} -sTCP:LISTEN`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function bezet() {
  for (const host of ["127.0.0.1", "::1"]) {
    const vrij = await new Promise((res) => {
      const s = net.createServer();
      s.once("error", (e) => res(e.code !== "EADDRINUSE"));
      s.once("listening", () => s.close(() => res(true)));
      s.listen(POORT, host);
    });
    if (!vrij) return true;
  }
  return false;
}

if (await bezet()) {
  let wie;
  try {
    const html = await (await fetch(`http://localhost:${POORT}/`, { signal: AbortSignal.timeout(1500) })).text();
    const m = html.match(/<meta name="studio-build" content="([^"]*)"/);
    wie = m ? `Die server meldt: versie/commit/tijd = ${m[1]}.` : "Die server is geen (nieuwe) Studio-server: hij meldt geen buildgegevens.";
  } catch {
    wie = "Er antwoordt iets op die poort, maar het is niet te zien wat.";
  }
  console.error(`
FOUT: poort ${POORT} is al in gebruik.
Studio zou nu een OUDE server kunnen tonen (bijvoorbeeld een Vite-server van een eerdere sessie of een andere map). Daarom stop ik.
${wie}
Deze map is versie ${pkg.version}. Sluit het andere programma (of het oude "tauri dev"-venster) en start opnieuw.
${proces() ? `\nWie de poort gebruikt:\n${proces()}\n` : ""}`);
  process.exit(1);
}
console.log(`Poort ${POORT} is vrij. Studio ${pkg.version} wordt gestart.`);
