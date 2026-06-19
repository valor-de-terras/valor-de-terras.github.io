import { useState } from "react";
import type { ReactNode } from "react";
import { useReveal } from "../../lib/useReveal";
import styles from "./Faq.module.css";

type QA = {
  id: string;
  q: string;
  a: ReactNode;
};

const ITEMS: QA[] = [
  {
    id: "validade",
    q: "A estimativa automatizada tem validade jurídica?",
    a: (
      <p>
        A estimativa é preliminar e serve de subsídio. O laudo formal, com validade,
        exige ART de engenheiro avaliador habilitado no CREA. A automação produz a
        fundamentação; a responsabilidade técnica é sempre humana.
      </p>
    ),
  },
  {
    id: "nbr",
    q: "Como vocês garantem aderência à NBR 14.653?",
    a: (
      <p>
        A engine aplica o método comparativo direto de dados de mercado e fatores de
        homogeneização da norma; a revisão técnica humana confere e pode elevar o grau de
        fundamentação (Expedito, Normal, Rigoroso).
      </p>
    ),
  },
  {
    id: "comparaveis",
    q: "De onde vêm os preços de comparáveis, se muitas transações são privadas?",
    a: (
      <p>
        De fontes públicas e de referência (DERAL/SEAB-PR, CEPEA/ESALQ), de parcerias com
        cartórios e de um histórico interno que se torna um ativo proprietário ao longo do
        tempo. Esse é o maior desafio de dados, e tratamos com transparência.
      </p>
    ),
  },
  {
    id: "urbano",
    q: "Funciona para imóvel urbano?",
    a: (
      <p>
        O foco inicial é rural (NBR 14.653-3). O urbano (14.653-2) está no roadmap.
      </p>
    ),
  },
  {
    id: "cobertura",
    q: "Qual a cobertura geográfica?",
    a: (
      <p>
        O MVP foca no Paraná, aproveitando a rede no IDR-PR, DERAL e SEAB, com expansão
        planejada para o restante do Brasil.
      </p>
    ),
  },
  {
    id: "diferencial",
    q: "Como se diferencia de players como Agro1, Gira ou Sólida?",
    a: (
      <p>
        Dados abertos com rastreabilidade (DataSnapshot), separação clara entre estimativa
        e laudo com ART, e base metodológica defensável em instâncias técnicas e judiciais.
      </p>
    ),
  },
];

export default function Faq() {
  const headRef = useReveal<HTMLDivElement>();
  const listRef = useReveal<HTMLDivElement>();
  const [open, setOpen] = useState<string | null>(ITEMS[0].id);

  function toggle(id: string) {
    setOpen((current) => (current === id ? null : id));
  }

  return (
    <section className={styles.section} id="faq" aria-labelledby="faq-title">
      <div className={`vt-container ${styles.inner}`}>
        <div ref={headRef} className={`vt-reveal ${styles.head}`}>
          <span className="vt-eyebrow">Perguntas e respostas</span>
          <h2 id="faq-title" className={styles.title}>
            Dúvidas frequentes
          </h2>
          <p className={styles.lede}>
            Transparência sobre método, dados e limites do que a plataforma entrega. Se
            ficar alguma pergunta, fale com a equipe técnica.
          </p>
        </div>

        <div ref={listRef} className={`vt-reveal ${styles.list}`}>
          {ITEMS.map((item, index) => {
            const isOpen = open === item.id;
            const panelId = `faq-panel-${item.id}`;
            const buttonId = `faq-button-${item.id}`;
            return (
              <div
                key={item.id}
                className={`${styles.item} ${isOpen ? styles.itemOpen : ""}`}
              >
                <h3 className={styles.itemHeading}>
                  <button
                    type="button"
                    id={buttonId}
                    className={styles.trigger}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(item.id)}
                  >
                    <span className={styles.index} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.question}>{item.q}</span>
                    <span className={styles.icon} aria-hidden="true">
                      <svg viewBox="0 0 16 16" className={styles.iconSvg}>
                        <line x1="3" y1="8" x2="13" y2="8" />
                        <line x1="8" y1="3" x2="8" y2="13" className={styles.iconBar} />
                      </svg>
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className={styles.panel}
                  hidden={!isOpen}
                >
                  <div className={styles.answer}>{item.a}</div>
                </div>
              </div>
            );
          })}
        </div>

        <p className={styles.note}>
          Escopo, cobertura e preços citados são preliminares e referentes ao MVP; podem
          mudar conforme a evolução da plataforma.
        </p>
      </div>
    </section>
  );
}
