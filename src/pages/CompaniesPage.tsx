import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type { FormEvent } from "react";

import {
  createCompany,
  listCompanies,
} from "../features/companies/company.service";

import type {
  Company,
} from "../features/companies/company.types";

import {
  createProspect,
  listProspects,
} from "../features/prospects/prospect.service";

import { ErrorMessage } from "../components/ErrorMessage";

function messageOf(
  err: unknown,
  fallback: string,
) {
  return err instanceof Error
    ? err.message
    : fallback;
}

export function CompaniesPage() {
  const [companies, setCompanies] = useState<
    Company[]
  >([]);

  const [prospectCompanyIds, setProspectCompanyIds] =
    useState<Set<number>>(new Set());

  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const [saving, setSaving] = useState(false);

  const [prospectingId, setProspectingId] =
    useState<number | null>(null);

  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [companyRows, prospectRows] =
        await Promise.all([
          listCompanies(),
          listProspects(),
        ]);

      setCompanies(companyRows);

      setProspectCompanyIds(
        new Set(
          prospectRows.map((p) => p.company_id),
        ),
      );
    } catch (err) {
      console.error(err);
      setError(
        messageOf(err, "Erro ao carregar empresas."),
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Informe o nome da empresa.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createCompany({
        name: name.trim(),
        segment: segment.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
      });

      setName("");
      setSegment("");
      setCity("");
      setState("");

      await load();
    } catch (err) {
      console.error(err);
      setError(
        messageOf(err, "Erro ao cadastrar empresa."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleProspect(
    companyId: number,
  ) {
    try {
      setError("");
      setProspectingId(companyId);

      await createProspect(companyId);

      await load();
    } catch (err) {
      console.error(err);
      setError(
        messageOf(
          err,
          "Erro ao adicionar empresa à prospecção.",
        ),
      );
    } finally {
      setProspectingId(null);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">
              NOVA EMPRESA
            </span>

            <h2>Cadastrar empresa</h2>
          </div>
        </div>

        <form
          className="company-form"
          onSubmit={handleSubmit}
        >
          <label>
            Empresa
            <input
              value={name}
              onChange={(e) =>
                setName(e.target.value)
              }
              placeholder="Clínica Excellence"
            />
          </label>

          <label>
            Segmento
            <input
              value={segment}
              onChange={(e) =>
                setSegment(e.target.value)
              }
              placeholder="Odontologia"
            />
          </label>

          <label>
            Cidade
            <input
              value={city}
              onChange={(e) =>
                setCity(e.target.value)
              }
              placeholder="Cuiabá"
            />
          </label>

          <label>
            UF
            <input
              value={state}
              onChange={(e) =>
                setState(e.target.value)
              }
              placeholder="MT"
              maxLength={2}
            />
          </label>

          <button type="submit" disabled={saving}>
            {saving
              ? "Salvando..."
              : "Adicionar empresa"}
          </button>
        </form>

        <ErrorMessage message={error} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">
              DATABASE
            </span>

            <h2>Empresas</h2>
          </div>

          <span className="counter">
            {companies.length} registros
          </span>
        </div>

        {companies.length === 0 ? (
          <div className="empty">
            Nenhuma empresa cadastrada.
          </div>
        ) : (
          <div className="table">
            <div className="table-row table-header">
              <span>Empresa</span>
              <span>Segmento</span>
              <span>Cidade</span>
              <span>UF</span>
              <span>Ação</span>
            </div>

            {companies.map((company) => (
              <div
                className="table-row"
                key={company.id}
              >
                <strong>{company.name}</strong>

                <span>{company.segment || "—"}</span>

                <span>{company.city || "—"}</span>

                <span>{company.state || "—"}</span>

                <div className="action-cell">
                  {prospectCompanyIds.has(
                    company.id,
                  ) ? (
                    <span className="status">
                      Em prospecção
                    </span>
                  ) : (
                    <button
                      className="prospect-button"
                      type="button"
                      disabled={
                        prospectingId === company.id
                      }
                      onClick={() =>
                        void handleProspect(
                          company.id,
                        )
                      }
                    >
                      {prospectingId === company.id
                        ? "Adicionando..."
                        : "Prospectar"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
