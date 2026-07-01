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
import { lazy, Suspense } from "react";
import { useHashRoute } from "./lib/router";

// Portal do engenheiro carregado sob demanda (não pesa a landing com maplibre/supabase).
const PortalApp = lazy(() => import("./portal/PortalApp"));

export default function App() {
  const hash = useHashRoute();
  // Portal do engenheiro (rota discreta, protegida por login). GitHub Pages = hash routing.
  if (hash.startsWith("#/portal")) {
    return (
      <Suspense fallback={<div style={{ padding: "3rem", textAlign: "center" }}>Carregando painel…</div>}>
        <PortalApp />
      </Suspense>
    );
  }

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
