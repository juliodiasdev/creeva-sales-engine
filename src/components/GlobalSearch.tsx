import { useEffect, useRef, useState } from "react";

import { searchCompaniesRepository } from "../features/companies/company.repository";
import { label, LEAD_STATUS_LABEL } from "../lib/labels";

type Result = Awaited<ReturnType<typeof searchCompaniesRepository>>;

/** Busca rápida de empresas, disponível em qualquer tela (Ctrl+K). */
export function GlobalSearch({
  onOpenCompany,
}: {
  onOpenCompany: (id: number) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Result>([]);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      searchCompaniesRepository(term)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);

    return () => clearTimeout(timer);
  }, [term]);

  function pick(id: number) {
    setOpen(false);
    setTerm("");
    setResults([]);
    onOpenCompany(id);
  }

  return (
    <div className="global-search">
      <input
        ref={input}
        value={term}
        placeholder="Buscar empresa…  Ctrl+K"
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) pick(results[0].id);
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            input.current?.blur();
          }
        }}
      />

      {open && term.trim().length >= 2 && (
        <div className="search-results">
          {results.length === 0 ? (
            <span className="muted">Nenhuma empresa encontrada.</span>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="search-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(Number(r.id))}
              >
                <strong>{r.name}</strong>
                <small>
                  {[r.segment, r.city].filter(Boolean).join(" · ") || "—"} ·{" "}
                  {label(LEAD_STATUS_LABEL, r.lead_status)}
                </small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
