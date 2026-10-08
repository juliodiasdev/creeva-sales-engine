import type { ReactNode } from "react";

import logo from "../assets/creava-logo.png";

export type PageId =
  | "today"
  | "dashboard"
  | "discovery"
  | "companies"
  | "prospects"
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
  discovery: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  companies: (
    <>
      <rect x="4" y="3" width="10" height="18" />
      <path d="M14 9h6v12h-6M8 7h2M8 11h2M8 15h2" />
    </>
  ),
  prospects: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M17 4.5a3.5 3.5 0 0 1 0 7M21.5 20c0-2.5-1.5-4.5-4-5.5" />
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

export const NAV_ITEMS: {
  id: PageId;
  label: string;
}[] = [
  { id: "today", label: "Today" },
  { id: "dashboard", label: "Dashboard" },
  { id: "discovery", label: "Discovery" },
  { id: "companies", label: "Companies" },
  { id: "prospects", label: "Prospects" },
  { id: "pipeline", label: "Pipeline" },
  { id: "session", label: "Sessão" },
  { id: "playbook", label: "Playbook" },
  { id: "settings", label: "Settings" },
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
            SALES ENGINE
          </span>
        </div>
      </div>

      <nav>
        {NAV_ITEMS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            title={`${item.label} (Ctrl+${index + 1})`}
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
              ^{index + 1}
            </span>
          </button>
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
