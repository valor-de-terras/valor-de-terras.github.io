import styles from "./legal.module.css";

export default function Legal() {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>Valor de Terras</span>
        <div className={styles.spacer} />
        <a className={styles.linkBtn} href="#/">Voltar ao site</a>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Política de Privacidade e Termos de Uso</h1>
        <p className={styles.updated}>Versão preliminar · atualizada em 2026-07-02</p>
        <div className={styles.draft}>
          Documento preliminar, sujeito a revisão jurídica antes do uso definitivo. Em caso de
          dúvida, prevalece a legislação aplicável (LGPD, Lei nº 13.709/2018).
        </div>

        <h2>1. Quem é o controlador dos dados</h2>
        <p>
          A plataforma <strong>Valor de Terras</strong> é o controlador dos dados pessoais tratados
          aqui. Contato do controlador / encarregado (DPO):{" "}
          <span className={styles.ph}>[inserir e-mail de contato]</span>.
        </p>

        <h2>2. Quais dados coletamos</h2>
        <ul>
          <li><strong>Dados de contato</strong> que você informa ao solicitar um laudo: nome, e-mail e telefone.</li>
          <li><strong>Geometria e localização do imóvel</strong> que você desenha, seleciona (CAR) ou envia (KML/KMZ/SHP/GeoJSON), e a finalidade declarada.</li>
          <li><strong>Dados técnicos gerados</strong> pela avaliação (estimativas, camadas de enriquecimento a partir de fontes públicas, comparáveis).</li>
          <li><strong>Sessão anônima local</strong> no seu navegador, usada para você testar a demonstração e acompanhar seus pedidos sem cadastro.</li>
        </ul>

        <h2>3. Para que usamos</h2>
        <ul>
          <li>Processar sua solicitação de estimativa e, quando pedido, de laudo formal.</li>
          <li>Permitir que um engenheiro habilitado (com CREA e ART) revise e emita o laudo.</li>
          <li>Entrar em contato sobre o seu pedido e a respectiva cobrança.</li>
        </ul>

        <h2>4. Base legal</h2>
        <p>
          Tratamos os dados de contato com base no seu <strong>consentimento</strong> e na
          <strong> execução de contrato/procedimentos preliminares</strong> a seu pedido (LGPD, art.
          7º, I e V). Os dados abertos consultados (relevo, solo, uso e cobertura, clima, hidrografia,
          preços de referência) são de fontes públicas oficiais.
        </p>

        <h2>5. Com quem compartilhamos</h2>
        <p>
          Seus dados são acessados pela equipe técnica responsável (engenheiros da plataforma) para
          revisar e emitir o laudo. <strong>Não vendemos seus dados</strong> nem os usamos para
          finalidades diversas das descritas. Provedores de infraestrutura (hospedagem e banco de
          dados) atuam como operadores, sob obrigação de confidencialidade.
        </p>

        <h2>6. Por quanto tempo guardamos</h2>
        <p>
          Mantemos os dados do pedido pelo tempo necessário para a prestação do serviço e para
          cumprir obrigações legais e de responsabilidade técnica (o laudo e sua trilha de
          defensabilidade). Depois disso, os dados são eliminados ou anonimizados.
        </p>

        <h2>7. Seus direitos (LGPD, art. 18)</h2>
        <ul>
          <li>Confirmar a existência de tratamento e acessar seus dados.</li>
          <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
          <li>Solicitar anonimização, bloqueio ou eliminação de dados desnecessários.</li>
          <li>Revogar o consentimento e solicitar a exclusão dos dados tratados com essa base.</li>
        </ul>
        <p>
          Para exercer seus direitos, escreva para{" "}
          <span className={styles.ph}>[inserir e-mail de contato]</span>.
        </p>

        <h2>8. Segurança</h2>
        <p>
          Adotamos controle de acesso por papéis, isolamento por linha (RLS) no banco de dados,
          escritas apenas por rotinas auditadas e armazenamento privado dos documentos (laudo e ART),
          acessíveis por links assinados e temporários.
        </p>

        <h2>9. Cookies e sessão</h2>
        <p>
          Usamos apenas o armazenamento local necessário para manter sua sessão anônima (testar a
          demo e acompanhar pedidos). Não usamos cookies de rastreamento publicitário.
        </p>

        <h2>10. Termos de uso (resumo)</h2>
        <ul>
          <li>A <strong>estimativa automatizada é preliminar</strong> (Grau I da NBR 14.653-3) e não constitui laudo nem parecer técnico.</li>
          <li>A avaliação de imóvel rural é atribuição privativa de Engenheiro Agrônomo ou Florestal com CREA e ART; o <strong>laudo formal</strong> só tem validade quando assinado por profissional habilitado.</li>
          <li>Os valores são referenciais e podem variar conforme a região, o tipo de imóvel e a complexidade.</li>
        </ul>

        <h2>11. Alterações</h2>
        <p>
          Esta política pode ser atualizada. A data de atualização no topo indica a versão vigente.
        </p>
      </main>
    </div>
  );
}
