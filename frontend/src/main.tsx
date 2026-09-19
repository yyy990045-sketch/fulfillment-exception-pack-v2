import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app.js";
import "./styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("frontend_root_not_found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
