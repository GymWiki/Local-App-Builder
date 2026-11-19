/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Welke versie draait er? Versie uit package.json, de commit van deze map en het moment van bouwen (bij elke start van de dev-server nieuw). */
function buildInfo() {
  const git = (a: string) => {
    try {
      return execSync(`git ${a}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;
  const hash = git("rev-parse --short HEAD") || "onbekend";
  return { version, commit: git("status --porcelain") ? `${hash}+wijzigingen` : hash, tijd: new Date().toISOString() };
}
const BUILD = buildInfo();

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Zet de buildgegevens ook in de pagina zelf, zodat een script (en `scripts/dev-check.mjs`) kan zien welke server er draait.
    { name: "studio-build-meta", transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta name="studio-build" content="${BUILD.version}|${BUILD.commit}|${BUILD.tijd}" />`) },
  ],
  define: { __STUDIO_VERSION__: JSON.stringify(BUILD.version), __STUDIO_COMMIT__: JSON.stringify(BUILD.commit), __STUDIO_BUILD_TIME__: JSON.stringify(BUILD.tijd) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], globals: true, exclude: ["mcp-server/**", "node_modules/**", "src-tauri/**"] },
});
