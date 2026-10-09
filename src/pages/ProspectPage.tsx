import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { buildListName, startDiscovery } from "../features/discovery/discovery.service";
import { getSearchRecord } from "../features/discovery/discovery.repository";
import type { SearchRecord } from "../features/discovery/discovery.repository";
import { listJobs } from "../features/jobs/job.service";
import type { Job } from "../features/jobs/job.service";

import type { DiscoveryResult } from "../features/discovery/discovery.service";
import { carregarMunicipios, listarEstados } from "municipios-brasil";
import type { ApiMunicipios } from "municipios-brasil";
import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../lib/format";

interface Props {
  onOpenList: (id: number) => void;
}

function storedPlace(key: string): string {
  try {
    return localStorage.getItem(`lists-${key}`) ?? "";
  } catch {
    return "";
  }
}

const SUGGESTIONS = [
  "Odontologia", "Clínica de estética", "Advocacia", "Restaurante",
  "Academia", "Imobiliária", "Pet shop", "Contabilidade", "Salão de beleza", "Oficina mecânica",
];

const STATES = listarEstados();

/** Máximo do Google Maps: 3 páginas de 20 resultados. */
const MAX_PAGES = 3;

export function ProspectPage({ onOpenList }: Props) {
  const [segment, setSegment] = useState("");
  const [uf, setUf] = useState(() => storedPlace("uf"));
  const [city, setCity] = useState(() => storedPlace("city"));
  const [api, setApi] = useState<ApiMunicipios | null>(null);
  const [neighborhood, setNeighborhood] = useState("");
  const [customName, setCustomName] = useState<string | null>(null);
  const pages = MAX_PAGES;
  const [previous, setPrevious] = useState<SearchRecord | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const segmentRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs(5));
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar listas."));
    }
  }, []);

  useEffect(() => {
    void carregarMunicipios().then(setApi);
    void refresh();
  }, [refresh]);

  const searching = jobs.find(
    (j) =>
      j.type === "DISCOVERY" &&
      (j.status === "PENDING" || j.status === "RUNNING"),
  );

  useEffect(() => {
    if (!searching) return;

    const timer = setInterval(() => void refresh(), 1500);

    return () => clearInterval(timer);
  }, [searching, refresh]);

  const lastDone = jobs.find(
    (j) => j.type === "DISCOVERY" && j.status === "COMPLETED" && j.result,
  );
  let lastResult: DiscoveryResult | null = null;

  try {
    lastResult = lastDone ? (JSON.parse(lastDone.result as string) as DiscoveryResult) : null;
  } catch {
    lastResult = null;
  }

  const failed = jobs.find((j) => j.type === "DISCOVERY" && j.status === "FAILED");

  useEffect(() => {
    if (!segment.trim() || !city.trim()) {
      setPrevious(null);
      return;
    }

    const timer = setTimeout(() => {
      void getSearchRecord(segment.trim(), uf ? `${city.trim()} - ${uf}` : city.trim(), neighborhood.trim() || undefined)
        .then(setPrevious)
        .catch(() => setPrevious(null));
    }, 400);

    return () => clearTimeout(timer);
  }, [segment, city, uf, neighborhood]);

  const cities = api && uf ? api.porEstado(uf as never) : [];
  const where = uf && city ? `${city} - ${uf}` : city;
  const autoName = buildListName(segment.trim() || "Nicho", where || "Cidade", neighborhood.trim() || undefined);
  const listName = customName ?? autoName;
  const canSearch = !!segment.trim() && !!uf && !!city && !searching;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();

    try {
      setError("");
      setMessage("");
      await startDiscovery(segment, city, { neighborhood, pages, state: uf, listName });
      setCustomName(null);
      try {
        localStorage.setItem("lists-uf", uf);
        localStorage.setItem("lists-city", city);
      } catch {
        // sem armazenamento: só não lembra a última escolha
      }
      setMessage(
        "Buscando no Google Maps… a lista aparece aqui assim que terminar.",
      );
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar a busca."));
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">PROSPECTAR NO GOOGLE MAPS</span>
            <h2>Nova prospecção</h2>
          </div>
        </div>

        <p className="muted">
          Busca no Google Maps e guarda <strong>somente os dados que o Maps
          mostra</strong> (nome, endereço, telefone, site, avaliações). Nada é
          inventado. Cada busca vira uma lista organizada; lugares já
          coletados antes nunca entram de novo.
        </p>

        <form className="search-card" onSubmit={handleCreate}>
          <div className="search-step">
            <span className="step-num">1</span>
            <div>
              <label htmlFor="seg">O que você quer buscar no Google Maps?</label>
              <input
                id="seg"
                ref={segmentRef}
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="Ex.: Odontologia, Restaurante, Academia…"
              />
              <div className="chips">
                {SUGGESTIONS.map((sg) => (
                  <button
                    type="button"
                    key={sg}
                    className={segment === sg ? "chip active" : "chip"}
                    onClick={() => setSegment(sg)}
                  >
                    {sg}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="search-step">
            <span className="step-num">2</span>
            <div className="step-fields">
              <label>
                Estado
                <select
                  value={uf}
                  onChange={(e) => {
                    setUf(e.target.value);
                    setCity("");
                  }}
                >
                  <option value="">Escolha o estado</option>
                  {STATES.map((st) => (
                    <option key={st.uf} value={st.uf}>
                      {st.nome} ({st.uf})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Cidade
                <select
                  value={city}
                  disabled={!uf || !api}
                  onChange={(e) => setCity(e.target.value)}
                >
                  <option value="">
                    {!uf ? "Escolha o estado primeiro" : api ? "Escolha a cidade" : "Carregando cidades…"}
                  </option>
                  {cities
                    .map((m) => m.nome)
                    .sort((x, y) => x.localeCompare(y, "pt-BR"))
                    .map((nome) => (
                      <option key={nome} value={nome}>{nome}</option>
                    ))}
                </select>
              </label>

              <label>
                Bairro (opcional)
                <input
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Ex.: Centro"
                />
              </label>
            </div>
          </div>

          <div className="search-step">
            <span className="step-num">3</span>
            <div>
              <label htmlFor="lname">Nome da lista (já vem pronto: nicho, cidade e data)</label>
              <input
                id="lname"
                value={listName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              {customName !== null && (
                <button type="button" className="chip" onClick={() => setCustomName(null)}>
                  Usar o nome sugerido
                </button>
              )}
            </div>
          </div>

          <button type="submit" className="search-go wide" disabled={!canSearch}>
            {searching
              ? `Buscando no Google Maps… ${searching.progress}%`
              : "Gerar leads em uma lista"}
          </button>

          <p className="muted small">
            Traz até 60 empresas por busca (limite do Google Maps). Para achar mais, repita
            com outro bairro: lugares já coletados nunca voltam.
          </p>
        </form>

        {previous && (
          <p className="muted">
            Você já buscou isso em {formatDateTime(previous.last_run_at)} (
            {previous.runs}×, {previous.last_imported} novas). Repetir só traz
            lugares ainda não coletados — use outro bairro para ampliar.
          </p>
        )}

        {searching && (
          <p className="muted">Busca em andamento… {searching.progress}%</p>
        )}

        {failed && !searching && failed.error && (
          <p className="error">Última busca falhou: {failed.error}</p>
        )}

        {lastResult && !searching && (
          <p className="muted">
            <strong>Última busca:</strong> o Google retornou {lastResult.found} lugar(es):{" "}
            {lastResult.imported} novo(s), {lastResult.alreadySeen} já coletado(s) antes,{" "}
            {lastResult.duplicates} duplicado(s).
            {lastResult.found === 0 &&
              " O Google não encontrou nada: tente outro termo de segmento ou outra região."}
            {lastResult.found > 0 &&
              lastResult.imported === 0 &&
              " Nenhuma lista foi criada porque todos esses lugares já estão na sua base (veja as listas “(anteriores)” ou a Base geral). Use outro bairro ou segmento para achar empresas novas."}
          </p>
        )}

        {lastResult?.listId && !searching && (
          <div className="outreach-actions">
            <button type="button" onClick={() => onOpenList(lastResult.listId as number)}>
              Abrir a lista criada →
            </button>
          </div>
        )}

        {message && <p className="muted">{message}</p>}
        <ErrorMessage message={error} />
      </section>

    </>
  );
}
