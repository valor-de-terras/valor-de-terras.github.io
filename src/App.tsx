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

export default function App() {
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
