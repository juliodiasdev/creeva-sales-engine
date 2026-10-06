import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  createCompany,
  initDatabase,
  listCompanies,
} from "./lib/database";

import type { Company } from "./lib/database";

import "./App.css";

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);

  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadCompanies() {
    const data = await listCompanies();
    setCompanies(data);
  }

  async function startApplication() {
    try {
      setError("");

      await initDatabase();
      await loadCompanies();
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

  if (loading) {
    return (
      <main className="app">
        <p>Inicializando Creava Sales Engine...</p>
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

          <h1>Sales Engine</h1>

          <p>
            Motor local de prospecção comercial.
          </p>
        </div>
      </header>

      <section className="metrics">
        <article className="metric-card">
          <span>Empresas</span>
          <strong>{companies.length}</strong>
          <small>Cadastradas localmente</small>
        </article>

        <article className="metric-card">
          <span>Prospects</span>
          <strong>0</strong>
          <small>Vamos criar depois</small>
        </article>

        <article className="metric-card">
          <span>Pipeline</span>
          <strong>R$ 0</strong>
          <small>Sem oportunidades ainda</small>
        </article>
      </section>

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
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="Clínica Excellence"
            />
          </label>

          <label>
            Segmento

            <input
              value={segment}
              onChange={(event) =>
                setSegment(event.target.value)
              }
              placeholder="Odontologia"
            />
          </label>

          <label>
            Cidade

            <input
              value={city}
              onChange={(event) =>
                setCity(event.target.value)
              }
              placeholder="Cuiabá"
            />
          </label>

          <label>
            UF

            <input
              value={state}
              onChange={(event) =>
                setState(event.target.value)
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
            </div>

            {companies.map((company) => (
              <div
                className="table-row"
                key={company.id}
              >
                <strong>
                  {company.name}
                </strong>

                <span>
                  {company.segment || "—"}
                </span>

                <span>
                  {company.city || "—"}
                </span>

                <span>
                  {company.state || "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;