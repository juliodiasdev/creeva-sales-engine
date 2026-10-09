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
import { DashboardPage } from "./pages/DashboardPage";
import { ListsPage } from "./pages/ListsPage";
import { ProspectPage } from "./pages/ProspectPage";
import { ListDetailPage } from "./pages/ListDetailPage";
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

import { GlobalSearch } from "./components/GlobalSearch";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";

function renderPage(
  page: PageId,
  navigate: (page: PageId) => void,
  openProspect: (id: number) => void,
  openCompany: (id: number) => void,
  openList: (id: number) => void,
) {
  switch (page) {
    case "today":
      return <TodayPage onOpenProspect={openProspect} onOpenList={openList} onNavigate={navigate} />;
    case "dashboard":
      return <DashboardPage />;
    case "prospect":
      return <ProspectPage onOpenList={openList} />;
    case "lists":
      return <ListsPage onOpenList={openList} onNewSearch={() => navigate("prospect")} />;
    case "companies":
      return <CompaniesPage onOpenCompany={openCompany} />;
    case "contacts":
      return <ContactsPage onOpenCompany={openCompany} />;
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

  const [listId, setListId] =
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
    setListId(null);
    setPage(next);
  }

  function openList(id: number) {
    setProspectId(null);
    setCompanyId(null);
    setPage("lists");
    setListId(id);
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
        <p>Abrindo Creava Digital - Agência...</p>
      </main>
    );
  }

  const current = NAV_ITEMS.find((item) => item.id === page);
  const pageLabel = current?.label ?? "";
  const pageDescription = current?.description ?? "";

  const detail =
    companyId !== null
      ? "Empresa"
      : prospectId !== null
        ? "Prospect"
        : listId !== null
          ? "Lista"
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
          <div className="topbar-title">
            <h1>{pageLabel}</h1>

            {detail ? (
              <span className="crumb">› {detail}</span>
            ) : (
              <span className="crumb hint-desc">{pageDescription}</span>
            )}
          </div>

          <span className="spacer" />

          <GlobalSearch
            onOpenCompany={(id) => {
              setProspectId(null);
              setCompanyId(id);
            }}
          />

          {(page !== "prospect" || listId !== null) && (
            <button
              type="button"
              className="topbar-cta"
              onClick={() => navigate("prospect")}
            >
              + Nova prospecção
            </button>
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
          ) : listId !== null ? (
            <ListDetailPage
              key={listId}
              listId={listId}
              onBack={() => setListId(null)}
              onOpenCompany={setCompanyId}
            />
          ) : (
            renderPage(page, navigate, setProspectId, setCompanyId, openList)
          )}
        </main>

        <footer className="statusbar">
          <span>
            <span className="dot" />
            Conectado à nuvem · dados salvos automaticamente
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
