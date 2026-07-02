import Nav from "./components/layout/Nav";
import Footer from "./components/layout/Footer";
import Hero from "./components/sections/Hero";
import Problem from "./components/sections/Problem";
import ValueProp from "./components/sections/ValueProp";
import HowItWorks from "./components/sections/HowItWorks";
import Compliance from "./components/sections/Compliance";
import DemoSection from "./components/sections/DemoSection";
import DataSources from "./components/sections/DataSources";
import Audience from "./components/sections/Audience";
import Pricing from "./components/sections/Pricing";
import Faq from "./components/sections/Faq";
import CtaBand from "./components/sections/CtaBand";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useHashRoute } from "./lib/router";
import ErrorBoundary from "./components/ErrorBoundary";

// Rotas carregadas sob demanda (não pesam a landing com maplibre/supabase).
const PortalApp = lazy(() => import("./portal/PortalApp"));
const MyRequests = lazy(() => import("./tracking/MyRequests"));
const Legal = lazy(() => import("./legal/Legal"));
const RecoverPassword = lazy(() => import("./portal/RecoverPassword"));
const AppraisePage = lazy(() => import("./appraise/AppraisePage"));

function RouteShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: "3rem", textAlign: "center" }}>Carregando {label}…</div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  const hash = useHashRoute();
  // Link de recuperação de senha (volta do e-mail com access_token/type=recovery no hash).
  // Latch uma vez: mesmo que o supabase limpe o hash, a tela de recuperação permanece.
  const [isRecovery] = useState(() => {
    const h = window.location.hash || "";
    return h.includes("type=recovery") || h.includes("access_token=");
  });
  if (isRecovery) return <RouteShell label="recuperação"><RecoverPassword /></RouteShell>;

  // aceita "#portal" e "#/portal" (e idem para pedidos); âncoras de seção (#demo, #precos) caem na landing.
  const seg = hash.replace(/^#\/?/, "").split(/[/?#]/)[0];

  if (seg === "avaliar") return <RouteShell label="a avaliação"><AppraisePage /></RouteShell>;
  if (seg === "portal") return <RouteShell label="painel"><PortalApp /></RouteShell>;
  if (seg === "pedidos") return <RouteShell label="seus pedidos"><MyRequests /></RouteShell>;
  if (seg === "privacidade") return <RouteShell label="a página"><Legal /></RouteShell>;

  return (
    <>
      <a href="#/avaliar" className="vt-sr-only">
        Ir para avaliar sua propriedade
      </a>
      <span id="top" />
      <Nav />
      <main>
        <Hero />
        <Problem />
        <ValueProp />
        <HowItWorks />
        <Compliance />
        <DemoSection />
        <DataSources />
        <Audience />
        <Pricing />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
