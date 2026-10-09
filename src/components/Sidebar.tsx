import { Fragment } from "react";
import type { ReactNode } from "react";

import logo from "../assets/creava-logo.png";

export type PageId =
  | "today"
  | "dashboard"
  | "lists"
  | "companies"
  | "contacts"
  | "pipeline"
  | "session"
  | "playbook"
  | "settings";

const ICONS: Record<PageId, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </>
  ),
  lists: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  companies: (
    <>
      <rect x="4" y="3" width="10" height="18" />
      <path d="M14 9h6v12h-6M8 7h2M8 11h2M8 15h2" />
    </>
  ),
  contacts: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M8 10h8M8 14h5" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3" y="4" width="5" height="16" />
      <rect x="10" y="4" width="5" height="10" />
      <rect x="17" y="4" width="4" height="13" />
    </>
  ),
  session: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5.5 3.5-5.5 3.5z" />
    </>
  ),
  playbook: (
    <>
      <path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
      <path d="M8 8h6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
};

export interface NavItem {
  id: PageId;
  label: string;
  description: string;
  section: string;
}

/** Ordem = atalhos Ctrl+1…Ctrl+0. Agrupado como nos grandes CRMs. */
export const NAV_ITEMS: NavItem[] = [
  { id: "today", label: "Hoje", section: "INÍCIO", description: "Seu processo e as tarefas do dia: o que fazer agora para gerar clientes." },
  { id: "lists", label: "Listas", section: "PROCESSO", description: "Prospecte no Google Maps, enriqueça, qualifique e inicie a abordagem lista por lista." },
  { id: "session", label: "Prospectar agora", section: "PROCESSO", description: "Uma empresa por vez: copie, envie e passe para a próxima." },
  { id: "pipeline", label: "Funil de vendas", section: "PROCESSO", description: "Acompanhe cada empresa do primeiro contato até o fechamento." },
  { id: "companies", label: "Base geral", section: "BASE", description: "Todas as empresas cadastradas, com organização de duplicados." },
  { id: "contacts", label: "Contatos", section: "BASE", description: "WhatsApp, redes sociais e e-mail de cada empresa, com exportação para planilha." },
  { id: "dashboard", label: "Resultados", section: "ANÁLISE", description: "Números reais: respostas, reuniões, propostas e receita." },
  { id: "playbook", label: "Mensagens prontas", section: "CONFIGURAÇÃO", description: "Modelos de mensagem por segmento e etapa." },
  { id: "settings", label: "Configurações", section: "CONFIGURAÇÃO", description: "Serviços, integrações, backup e preferências." },
];

interface Props {
  current: PageId;
  collapsed: boolean;
  onNavigate: (page: PageId) => void;
  onToggle: () => void;
  userEmail: string;
  onSignOut: () => void;
}

export function Sidebar({
  current,
  collapsed,
  onNavigate,
  onToggle,
  userEmail,
  onSignOut,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logo} alt="Creava" />

        <div className="brand-text">
          <strong>CREAVA</strong>

          <span className="eyebrow">
            DIGITAL · AGÊNCIA
          </span>
        </div>
      </div>

      <nav>
        {NAV_ITEMS.map((item, index) => (
          <Fragment key={item.id}>
            {(index === 0 || NAV_ITEMS[index - 1].section !== item.section) && (
              <span className="nav-section">{item.section}</span>
            )}

          <button
            type="button"
            title={`${item.label} (Ctrl+${(index + 1) % 10})`}
            className={
              item.id === current
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() => onNavigate(item.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {ICONS[item.id]}
            </svg>

            <span className="nav-label">
              {item.label}
            </span>

            <span className="kbd">
              ^{(index + 1) % 10}
            </span>
          </button>
          </Fragment>
        ))}
      </nav>

      <div className="user-box" title={userEmail}>
        <span className="user-email">{userEmail || "Conectado"}</span>

        <button
          type="button"
          className="collapse-btn"
          title="Sair da conta"
          onClick={onSignOut}
        >
          ⎋<span className="collapse-label"> Sair</span>
        </button>
      </div>

      <button
        type="button"
        className="collapse-btn"
        title="Recolher menu (Ctrl+B)"
        onClick={onToggle}
      >
        {collapsed ? "»" : "«"}
        <span className="collapse-label"> Recolher</span>
      </button>
    </aside>
  );
}
