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
import { PipelinePage } from "./pages/PipelinePage";
import { ProspectDetailPage } from "./pages/ProspectDetailPage";

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
  playbook: [
    "Playbook",
    "Biblioteca de scripts por segmento.",
  ],
  settings: [
    "Settings",
    "Preferências e chaves de API.",
  ],
};

function renderPage(
  page: PageId,
  openProspect: (id: number) => void,
) {
  switch (page) {
    case "today":
      return <TodayPage onOpenProspect={openProspect} />;
    case "companies":
      return <CompaniesPage />;
    case "prospects":
      return <ProspectsPage onOpenProspect={openProspect} />;
    case "pipeline":
      return <PipelinePage onOpenProspect={openProspect} />;
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

  const [prospectId, setProspectId] =
    useState<number | null>(null);

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
        onNavigate={(next) => {
          setProspectId(null);
          setPage(next);
        }}
      />

      <main className="content">
        {prospectId !== null ? (
          <ProspectDetailPage
            key={prospectId}
            prospectId={prospectId}
            onBack={() => setProspectId(null)}
          />
        ) : (
          renderPage(page, setProspectId)
        )}
      </main>
    </div>
  );
}

export default App;
