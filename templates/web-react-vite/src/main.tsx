import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./kit";
import KitProvider from "./kit/KitProvider";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KitProvider>
      <App />
    </KitProvider>
  </StrictMode>,
);
