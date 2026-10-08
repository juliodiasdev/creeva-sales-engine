import {
  useEffect,
  useState,
} from "react";

import "./App.css";

import logo from "./assets/creava-logo.png";

import {
  NAV_ITEMS,
  Sidebar,
} from "./components/Sidebar";

import type {
  PageId,
} from "./components/Sidebar";


import { TodayPage } from "./pages/TodayPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { ContactsPage } from "./pages/ContactsPage";
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

import { initApp } from "./lib/init";
import { getSession, onAuthChange, signOut } from "./lib/auth";
import { loadConfig } from "./lib/supabase";

import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";

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
    case "contacts":
      return <ContactsPage onOpenCompany={openCompany} />;
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

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });

  const [phase, setPhase] = useState<
    "config" | "login" | "loading" | "ready" | "error"
  >(() => (loadConfig() ? "loading" : "config"));

  const [userEmail, setUserEmail] = useState("");


  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem("sidebar-collapsed", value ? "0" : "1");
      } catch {
        // armazenamento indisponível: só não persiste
      }

      return !value;
    });
  }

  function navigate(next: PageId) {
    setProspectId(null);
    setCompanyId(null);
    setPage(next);
  }

  // Atalhos de teclado: Ctrl+1..9 navega, Ctrl+B recolhe o menu, Esc volta.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if (event.ctrlKey && /^[0-9]$/.test(event.key)) {
        const item = NAV_ITEMS[(Number(event.key) + 9) % 10];

        if (item) {
          event.preventDefault();
          navigate(item.id);
        }
      } else if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      } else if (event.key === "Escape" && !typing) {
        setProspectId(null);
        setCompanyId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () =>
      window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [error, setError] = useState("");

  useEffect(() => {
    if (phase !== "loading") return;

    let cancelled = false;

    async function start() {
      try {
        const session = await getSession();

        if (cancelled) return;

        if (!session) {
          setPhase("login");
          return;
        }

        setUserEmail(session.user.email ?? "");
        await initApp();

        if (!cancelled) setPhase("ready");
      } catch (err) {
        if (cancelled) return;

        console.error(err);
        setError(errorMessage(err, "Erro ao iniciar o aplicativo."));
        setPhase("error");
      }
    }

    void start();

    return () => {
      cancelled = true;
    };
  }, [phase]);

  // Login/logout em tempo real (inclui expiração da sessão).
  useEffect(() => {
    if (!loadConfig()) return;

    return onAuthChange((session) => {
      setUserEmail(session?.user.email ?? "");
      setPhase((current) =>
        session
          ? current === "login" ? "loading" : current
          : current === "config" ? current : "login",
      );
    });
  }, [phase === "config"]);

  if (phase === "config") {
    return <SetupPage onDone={() => setPhase("loading")} />;
  }

  if (phase === "login") {
    return <LoginPage onReconfigure={() => setPhase("config")} />;
  }

  if (phase === "error") {
    return (
      <main className="app">
        <div>
          <p className="error">{error}</p>

          <div className="outreach-actions">
            <button type="button" onClick={() => setPhase("loading")}>
              Tentar novamente
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => void signOut()}
            >
              Sair
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (phase !== "ready") {
    return (
      <main className="app">
        <img className="loading-logo" src={logo} alt="Creava" />
        <p>Inicializando Creava Sales Engine...</p>
      </main>
    );
  }

  const pageLabel =
    NAV_ITEMS.find((item) => item.id === page)?.label ?? "";

  const detail =
    companyId !== null
      ? "Empresa"
      : prospectId !== null
        ? "Prospect"
        : null;

  return (
    <div className={collapsed ? "shell collapsed" : "shell"}>
      <Sidebar
        current={page}
        collapsed={collapsed}
        onNavigate={navigate}
        onToggle={toggleSidebar}
        userEmail={userEmail}
        onSignOut={() => void signOut()}
      />

      <div className="main">
        <header className="topbar">
          <h1>{pageLabel}</h1>

          {detail && (
            <>
              <span className="crumb">›</span>
              <span className="crumb">{detail}</span>
            </>
          )}
        </header>

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

        <footer className="statusbar">
          <span>
            <span className="dot" />
            Banco local (SQLite)
          </span>

          <span className="spacer" />

          <span className="hint">
            Ctrl+1–0 navegar · Ctrl+B menu · Esc voltar
          </span>
        </footer>
      </div>
    </div>
  );
}

export default App;
