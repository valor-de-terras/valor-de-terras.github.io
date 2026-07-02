import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Backstop de render: se uma rota lazy quebrar (ex.: chunk velho em cache), oferece recarregar. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("Route error boundary:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "2rem", textAlign: "center" }}>
          <div>
            <p style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--vt-ink)" }}>
              Não foi possível carregar esta página.
            </p>
            <button className="vt-btn vt-btn-primary" onClick={() => window.location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
