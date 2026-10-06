import {
  useEffect,
  useState,
} from "react";

import type {
  FormEvent,
} from "react";

import "./App.css";

import {
  createCompany,
  listCompanies,
} from "./features/companies/company.service";

import type {
  Company,
} from "./features/companies/company.types";

import {
  createProspect,
  listProspects,
} from "./features/prospects/prospect.service";

import type {
  ProspectWithCompany,
} from "./features/prospects/prospect.types";

import {
  listPendingTasks,
} from "./features/tasks/task.service";

import type {
  TaskWithProspect,
} from "./features/tasks/task.types";

import {
  initDatabase,
} from "./lib/migrations";

function App() {
  const [
    companies,
    setCompanies,
  ] = useState<Company[]>([]);

  const [
    prospects,
    setProspects,
  ] = useState<
    ProspectWithCompany[]
  >([]);

  const [
    tasks,
    setTasks,
  ] = useState<
    TaskWithProspect[]
  >([]);

  const [
    name,
    setName,
  ] = useState("");

  const [
    segment,
    setSegment,
  ] = useState("");

  const [
    city,
    setCity,
  ] = useState("");

  const [
    state,
    setState,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    prospectingCompanyId,
    setProspectingCompanyId,
  ] = useState<number | null>(
    null,
  );

  const [
    error,
    setError,
  ] = useState("");

  async function loadCompanies() {
    const data =
      await listCompanies();

    setCompanies(data);
  }

  async function loadProspects() {
    const data =
      await listProspects();

    setProspects(data);
  }

  async function loadTasks() {
    const data =
      await listPendingTasks();

    setTasks(data);
  }

  async function startApplication() {
    try {
      setError("");

      await initDatabase();

      await Promise.all([
        loadCompanies(),
        loadProspects(),
        loadTasks(),
      ]);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Erro ao inicializar o banco de dados.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void startApplication();
  }, []);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!name.trim()) {
      setError(
        "Informe o nome da empresa.",
      );

      return;
    }

    try {
      setSaving(true);
      setError("");

      await createCompany({
        name:
          name.trim(),

        segment:
          segment.trim() ||
          undefined,

        city:
          city.trim() ||
          undefined,

        state:
          state.trim() ||
          undefined,
      });

      setName("");
      setSegment("");
      setCity("");
      setState("");

      await loadCompanies();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Erro ao cadastrar empresa.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateProspect(
    companyId: number,
  ) {
    try {
      setError("");

      setProspectingCompanyId(
        companyId,
      );

      await createProspect(
        companyId,
      );

      await Promise.all([
        loadProspects(),
        loadTasks(),
      ]);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Erro ao adicionar empresa à prospecção.",
      );
    } finally {
      setProspectingCompanyId(
        null,
      );
    }
  }

  function companyIsProspect(
    companyId: number,
  ) {
    return prospects.some(
      (prospect) =>
        prospect.company_id ===
        companyId,
    );
  }

  if (loading) {
    return (
      <main className="app">
        <p>
          Inicializando Creava
          Sales Engine...
        </p>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <span className="eyebrow">
            CREAVA DIGITAL
          </span>

          <h1>
            Sales Engine
          </h1>

          <p>
            Motor local de
            prospecção comercial.
          </p>
        </div>
      </header>

      <section className="metrics">
        <article className="metric-card">
          <span>
            Empresas
          </span>

          <strong>
            {companies.length}
          </strong>

          <small>
            Cadastradas localmente
          </small>
        </article>

        <article className="metric-card">
          <span>
            Prospects
          </span>

          <strong>
            {prospects.length}
          </strong>

          <small>
            Em prospecção
          </small>
        </article>

        <article className="metric-card">
          <span>
            Ações pendentes
          </span>

          <strong>
            {tasks.length}
          </strong>

          <small>
            Para executar
          </small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">
              TODAY
            </span>

            <h2>
              Próximas ações
            </h2>
          </div>

          <span className="counter">
            {tasks.length} pendentes
          </span>
        </div>

        {tasks.length === 0 ? (
          <div className="empty">
            Nenhuma ação
            pendente.
          </div>
        ) : (
          <div className="tasks-list">
            {tasks.map(
              (task) => (
                <article
                  className="task-item"
                  key={task.id}
                >
                  <div>
                    <strong>
                      {
                        task.company_name
                      }
                    </strong>

                    <p>
                      {task.title}
                    </p>
                  </div>

                  <span className="status">
                    {
                      task.prospect_status
                    }
                  </span>
                </article>
              ),
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">
              NOVA EMPRESA
            </span>

            <h2>
              Cadastrar empresa
            </h2>
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
              onChange={(
                event,
              ) =>
                setName(
                  event.target
                    .value,
                )
              }
              placeholder="Clínica Excellence"
            />
          </label>

          <label>
            Segmento

            <input
              value={segment}
              onChange={(
                event,
              ) =>
                setSegment(
                  event.target
                    .value,
                )
              }
              placeholder="Odontologia"
            />
          </label>

          <label>
            Cidade

            <input
              value={city}
              onChange={(
                event,
              ) =>
                setCity(
                  event.target
                    .value,
                )
              }
              placeholder="Cuiabá"
            />
          </label>

          <label>
            UF

            <input
              value={state}
              onChange={(
                event,
              ) =>
                setState(
                  event.target
                    .value,
                )
              }
              placeholder="MT"
              maxLength={2}
            />
          </label>

          <button
            type="submit"
            disabled={saving}
          >
            {saving
              ? "Salvando..."
              : "Adicionar empresa"}
          </button>
        </form>

        {error && (
          <p className="error">
            {error}
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">
              DATABASE
            </span>

            <h2>
              Empresas
            </h2>
          </div>

          <span className="counter">
            {companies.length} registros
          </span>
        </div>

        {companies.length === 0 ? (
          <div className="empty">
            Nenhuma empresa
            cadastrada.
          </div>
        ) : (
          <div className="table">
            <div className="table-row table-header">
              <span>
                Empresa
              </span>

              <span>
                Segmento
              </span>

              <span>
                Cidade
              </span>

              <span>
                UF
              </span>

              <span>
                Ação
              </span>
            </div>

            {companies.map(
              (company) => {
                const isProspect =
                  companyIsProspect(
                    company.id,
                  );

                const isLoading =
                  prospectingCompanyId ===
                  company.id;

                return (
                  <div
                    className="table-row"
                    key={
                      company.id
                    }
                  >
                    <strong>
                      {
                        company.name
                      }
                    </strong>

                    <span>
                      {company.segment ||
                        "—"}
                    </span>

                    <span>
                      {company.city ||
                        "—"}
                    </span>

                    <span>
                      {company.state ||
                        "—"}
                    </span>

                    <div className="action-cell">
                      {isProspect ? (
                        <span className="status">
                          Em prospecção
                        </span>
                      ) : (
                        <button
                          className="prospect-button"
                          type="button"
                          disabled={
                            isLoading
                          }
                          onClick={() =>
                            void handleCreateProspect(
                              company.id,
                            )
                          }
                        >
                          {isLoading
                            ? "Adicionando..."
                            : "Prospectar"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;