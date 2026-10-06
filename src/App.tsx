import {
  useEffect,
  useState,
} from "react";

import "./App.css";

import logo from "./assets/creava-logo.png";

import {
  Sidebar,
} from "./components/Sidebar";

import type {
  PageId,
} from "./components/Sidebar";


import { TodayPage } from "./pages/TodayPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { ProspectsPage } from "./pages/ProspectsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { PlaybookPage } from "./pages/PlaybookPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionPage } from "./pages/SessionPage";
import { CompanyDetailPage } from "./pages/CompanyDetailPage";
import { PipelinePage } from "./pages/PipelinePage";
import { ProspectDetailPage } from "./pages/ProspectDetailPage";

import { errorMessage } from "./lib/format";

import {
  initDatabase,
} from "./lib/migrations";

import {
  ensurePlaybookSeed,
} from "./features/playbook/playbook.service";

function renderPage(
  page: PageId,
  openProspect: (id: number) => void,
  openCompany: (id: number) => void,
) {
  switch (page) {
    case "today":
      return <TodayPage onOpenProspect={openProspect} />;
    case "dashboard":
      return <DashboardPage />;
    case "discovery":
      return <DiscoveryPage />;
    case "companies":
      return <CompaniesPage onOpenCompany={openCompany} />;
    case "prospects":
      return <ProspectsPage onOpenProspect={openProspect} />;
    case "pipeline":
      return <PipelinePage onOpenProspect={openProspect} />;
    case "session":
      return <SessionPage onOpenProspect={openProspect} />;
    case "playbook":
      return <PlaybookPage />;
    case "settings":
      return <SettingsPage />;
  }
}

function App() {
  const [page, setPage] =
    useState<PageId>("today");

  const [prospectId, setProspectId] =
    useState<number | null>(null);

  const [companyId, setCompanyId] =
    useState<number | null>(null);

  const [ready, setReady] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    initDatabase()
      .then(() => ensurePlaybookSeed())
      .then(() => setReady(true))
      .catch((err) => {
        console.error(err);
        setError(
          `Erro ao inicializar o banco de dados: ${errorMessage(err, "causa desconhecida")}`,
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
        <img className="loading-logo" src={logo} alt="Creava" />
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
          setCompanyId(null);
          setPage(next);
        }}
      />

      <main className="content">
        {companyId !== null ? (
          <CompanyDetailPage
            key={companyId}
            companyId={companyId}
            onBack={() => setCompanyId(null)}
            onOpenProspect={(id) => {
              setCompanyId(null);
              setProspectId(id);
            }}
          />
        ) : prospectId !== null ? (
          <ProspectDetailPage
            key={prospectId}
            prospectId={prospectId}
            onBack={() => setProspectId(null)}
          />
        ) : (
          renderPage(page, setProspectId, setCompanyId)
        )}
      </main>
    </div>
  );
}

export default App;
