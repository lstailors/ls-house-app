import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@ls/design/src/index.css";
import "@alts/styles/alts-pos.css";
import App from "./App";
import { initSentry } from "@alts/lib/sentry";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
