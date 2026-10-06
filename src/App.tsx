import {
  useEffect,
  useState,
} from "react";

import "./App.css";

import {
  Sidebar,
} from "./components/Sidebar";

import type {
  PageId,
} from "./components/Sidebar";

import { Placeholder } from "./components/Placeholder";

import { TodayPage } from "./pages/TodayPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { ProspectsPage } from "./pages/ProspectsPage";

import {
  initDatabase,
} from "./lib/migrations";

const PLACEHOLDERS: Partial<
  Record<PageId, [string, string]>
> = {
  dashboard: [
    "Dashboard",
    "Métricas reais de funil, conversão e receita.",
  ],
  discovery: [
    "Discovery",
    "Busca de empresas por segmento e cidade.",
  ],
  pipeline: [
    "Pipeline",
    "Visão do funil por estágio comercial.",
  ],
  playbook: [
    "Playbook",
    "Biblioteca de scripts por segmento.",
  ],
  settings: [
    "Settings",
    "Preferências e chaves de API.",
  ],
};

function renderPage(page: PageId) {
  switch (page) {
    case "today":
      return <TodayPage />;
    case "companies":
      return <CompaniesPage />;
    case "prospects":
      return <ProspectsPage />;
    default: {
      const [title, description] =
        PLACEHOLDERS[page] ?? [page, ""];

      return (
        <Placeholder
          title={title}
          description={description}
        />
      );
    }
  }
}

function App() {
  const [page, setPage] =
    useState<PageId>("today");

  const [ready, setReady] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    initDatabase()
      .then(() => setReady(true))
      .catch((err) => {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "Erro ao inicializar o banco de dados.",
        );
      });
  }, []);

  if (error) {
    return (
      <main className="app">
        <p className="error">{error}</p>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="app">
        <p>Inicializando Creava Sales Engine...</p>
      </main>
    );
  }

  return (
    <div className="shell">
      <Sidebar
        current={page}
        onNavigate={setPage}
      />

      <main className="content">
        {renderPage(page)}
      </main>
    </div>
  );
}

export default App;
