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
import TechStack from "./components/sections/TechStack";
import Roadmap from "./components/sections/Roadmap";
import Faq from "./components/sections/Faq";
import CtaBand from "./components/sections/CtaBand";
import { lazy, Suspense, type ReactNode } from "react";
import { useHashRoute } from "./lib/router";
import ErrorBoundary from "./components/ErrorBoundary";

// Rotas carregadas sob demanda (não pesam a landing com maplibre/supabase).
const PortalApp = lazy(() => import("./portal/PortalApp"));
const MyRequests = lazy(() => import("./tracking/MyRequests"));

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
  // aceita "#portal" e "#/portal" (e idem para pedidos); âncoras de seção (#demo, #precos) caem na landing.
  const seg = hash.replace(/^#\/?/, "").split(/[/?]/)[0];

  if (seg === "portal") return <RouteShell label="painel"><PortalApp /></RouteShell>;
  if (seg === "pedidos") return <RouteShell label="seus pedidos"><MyRequests /></RouteShell>;

  return (
    <>
      <a href="#demo" className="vt-sr-only">
        Pular para a demonstração interativa
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
        <TechStack />
        <Roadmap />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
