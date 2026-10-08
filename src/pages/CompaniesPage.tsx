import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type { FormEvent } from "react";

import {
  countCompanies,
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

import { DuplicatesPanel } from "../features/duplicates/DuplicatesPanel";

import { ErrorMessage } from "../components/ErrorMessage";

function messageOf(
  err: unknown,
  fallback: string,
) {
  return err instanceof Error
    ? err.message
    : fallback;
}

interface Props {
  onOpenCompany: (id: number) => void;
}

const PAGE_SIZE = 50;

export function CompaniesPage({ onOpenCompany }: Props) {
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

  const [limit, setLimit] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);

  const [prospectingId, setProspectingId] =
    useState<number | null>(null);

  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [companyRows, prospectRows] =
        await Promise.all([
          listCompanies(limit),
          listProspects(),
        ]);

      setTotal(await countCompanies());

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
  }, [limit]);

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
      <DuplicatesPanel onChanged={() => void load()} />

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
            {companies.length} de {total}
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
              <span>Lead</span>
              <span>Ação</span>
            </div>

            {companies.map((company) => (
              <div
                className="table-row"
                key={company.id}
              >
                <strong
                  className="clickable"
                  onClick={() => onOpenCompany(company.id)}
                >
                  {company.name}
                </strong>

                <span>{company.segment || "—"}</span>

                <span>{company.city || "—"}</span>

                <span>{company.state || "—"}</span>

                <span>{company.lead_status}</span>

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
            {companies.length < total && (
              <button
                type="button"
                className="secondary"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                Carregar mais
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
