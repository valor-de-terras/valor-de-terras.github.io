// Detector de passivos/ônus de matrícula por REGRAS (sem LLM). Faz o primeiro passe da
// due diligence dominial: hipoteca, alienação fiduciária, penhora, indisponibilidade,
// cláusulas restritivas, enfiteuse, etc., distinguindo ativo x cancelado.
// Upgrade futuro: reprocessar o mesmo texto com LLM (Claude) para leitura contextual.

export interface Passivo {
  tipo: string;
  status: "ativo" | "cancelado" | "indeterminado";
  ocorrencias: number;
  trecho: string;
}

interface Rule {
  tipo: string;
  re: RegExp;
}

const RULES: Rule[] = [
  { tipo: "Hipoteca", re: /hipoteca/gi },
  { tipo: "Alienação fiduciária", re: /aliena[çc][ãa]o\s+fiduci[áa]ria/gi },
  { tipo: "Penhora", re: /\bpenhora/gi }, // \b evita casar dentro de "impenhorabilidade"
  { tipo: "Arresto ou sequestro", re: /arresto|sequestro/gi },
  { tipo: "Indisponibilidade", re: /indisponibilidade/gi },
  { tipo: "Usufruto", re: /usufruto/gi },
  { tipo: "Servidão", re: /servid[ãa]o/gi },
  { tipo: "Cláusula de inalienabilidade", re: /inalienabilidade/gi },
  { tipo: "Cláusula de impenhorabilidade", re: /impenhorabilidade/gi },
  { tipo: "Cláusula de incomunicabilidade", re: /incomunicabilidade/gi },
  { tipo: "Enfiteuse / imóvel foreiro", re: /enfiteuse|foreiro|aforamento/gi },
  { tipo: "Reserva legal / averbação ambiental", re: /reserva\s+legal|[áa]rea\s+de\s+preserva[çc][ãa]o\s+permanente/gi },
  { tipo: "Ação judicial / execução", re: /a[çc][ãa]o\s+de\s+execu[çc][ãa]o|penhora\s+no\s+rosto|citando\s+a\s+a[çc][ãa]o/gi },
];

const CANCEL_RE = /cancel|baixa|extin|liberad|remi[çs]/i;

function windowAround(text: string, idx: number, len: number, radius = 90): string {
  const a = Math.max(0, idx - radius);
  const b = Math.min(text.length, idx + len + radius);
  return text.slice(a, b).replace(/\s+/g, " ").trim();
}

/** Analisa o texto da matrícula e devolve os passivos encontrados. */
export function analisarMatricula(rawText: string): {
  passivos: Passivo[];
  n_passivos: number;
  n_ativos: number;
} {
  const text = rawText || "";
  const passivos: Passivo[] = [];

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let ocorrencias = 0;
    let temAtivo = false;
    let todosCancelados = true;
    let trecho = "";
    while ((m = rule.re.exec(text)) !== null) {
      ocorrencias++;
      const janela = windowAround(text, m.index, m[0].length);
      const cancelado = CANCEL_RE.test(janela);
      if (!cancelado) {
        temAtivo = true;
        todosCancelados = false;
      }
      if (!trecho || (!cancelado && temAtivo && ocorrencias <= 2)) trecho = janela;
      if (ocorrencias > 50) break; // guarda
    }
    if (ocorrencias > 0) {
      const status: Passivo["status"] = temAtivo ? "ativo" : todosCancelados ? "cancelado" : "indeterminado";
      passivos.push({ tipo: rule.tipo, status, ocorrencias, trecho: trecho.slice(0, 240) });
    }
  }

  const n_ativos = passivos.filter((p) => p.status === "ativo").length;
  return { passivos, n_passivos: passivos.length, n_ativos };
}
