import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useReveal } from "../../lib/useReveal";
import styles from "./DemoSection.module.css";

// Carrega MapLibre + parsers geográficos só quando a demo se aproxima da viewport,
// mantendo o carregamento inicial da página leve.
const MapDemo = lazy(() => import("../demo/MapDemo"));

function DemoSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skelPanel} />
      <div className={styles.skelStage}>
        <div className={styles.skelMap}>
          <span className={styles.skelSpinner} />
          <span className={styles.skelText}>Carregando demonstração interativa…</span>
        </div>
      </div>
    </div>
  );
}

export default function DemoSection() {
  const ref = useReveal<HTMLDivElement>();
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          obs.disconnect();
        }
      },
      { rootMargin: "400px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className={styles.section} id="demo" aria-labelledby="demo-title">
      <div className="vt-container vt-container-wide">
        <div ref={ref} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Demonstração interativa</span>
          <h2 id="demo-title" className={styles.title}>
            Da geometria do imóvel ao valor estimado
          </h2>
          <p className={styles.lede}>
            Informe a área de três formas (arquivo geográfico, ponto no mapa ou imóvel de
            exemplo) e veja o pipeline coletar dados abertos, homogeneizar atributos e
            devolver uma estimativa preliminar. Tudo no seu navegador.
          </p>
        </div>
        <div ref={sentinel}>
          {show ? (
            <Suspense fallback={<DemoSkeleton />}>
              <MapDemo />
            </Suspense>
          ) : (
            <DemoSkeleton />
          )}
        </div>
      </div>
    </section>
  );
}
