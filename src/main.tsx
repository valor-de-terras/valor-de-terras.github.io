import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import App from "./App";

// Recupera-se de chunk velho em cache (após um deploy novo): quando um import dinâmico
// falha ao pré-carregar, recarrega a página uma vez para buscar o index/chunks atuais.
window.addEventListener("vite:preloadError", () => {
  const now = Date.now();
  const last = Number(sessionStorage.getItem("vdt-chunk-reload") || 0);
  if (now - last > 10000) {
    sessionStorage.setItem("vdt-chunk-reload", String(now));
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
