import { useEffect, useState } from "react";

/** Roteamento por hash (compatível com GitHub Pages, sem servidor). */
export function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function navigate(to: string) {
  if (window.location.hash !== to) window.location.hash = to;
}
