import { useEffect, useState } from "react";
import styles from "./Nav.module.css";

const LINKS = [
  { href: "#produto", label: "Produto" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#publico", label: "Para quem" },
  { href: "#precos", label: "Preços" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={scrolled ? styles.navScrolled : styles.nav}>
      <div className={`vt-container ${styles.inner}`}>
        <a href="#top" className={styles.brand} aria-label="Valor de Terras — início">
          <img src="/favicon.svg" alt="" className={styles.mark} width={30} height={30} />
          <span className={styles.brandText}>
            Valor<span className={styles.brandAccent}>de</span>Terras
          </span>
        </a>

        <nav className={styles.links} aria-label="Navegação principal">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={styles.link}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className={styles.actions}>
          <a href="#demo" className={`vt-btn vt-btn-primary ${styles.cta}`}>
            Testar a demo
          </a>
        </div>

        <button
          className={styles.burger}
          aria-label="Abrir menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {open && (
        <div className={styles.mobile}>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className={styles.mobileLink}>
              {l.label}
            </a>
          ))}
          <a href="#demo" onClick={() => setOpen(false)} className="vt-btn vt-btn-primary">
            Testar a demo
          </a>
        </div>
      )}
    </header>
  );
}
