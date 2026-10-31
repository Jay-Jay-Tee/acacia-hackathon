import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { restoreRightColumnWidth } from "./lib/layout";

restoreRightColumnWidth(); // before first render, so the rail and panel open at the saved width

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
