import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "@/components/app/theme-provider";
import { SettingsProvider } from "@/components/app/settings-provider";
import { ConnectionsProvider } from "@/components/app/connect/connections-provider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <ConnectionsProvider>
          <App />
        </ConnectionsProvider>
      </SettingsProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
