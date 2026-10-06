export type PageId =
  | "today"
  | "dashboard"
  | "discovery"
  | "companies"
  | "prospects"
  | "pipeline"
  | "playbook"
  | "settings";

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
  { id: "playbook", label: "Playbook" },
  { id: "settings", label: "Settings" },
];

interface Props {
  current: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({
  current,
  onNavigate,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="eyebrow">
          CREAVA DIGITAL
        </span>

        <strong>Sales Engine</strong>
      </div>

      <nav>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === current
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              onNavigate(item.id)
            }
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
