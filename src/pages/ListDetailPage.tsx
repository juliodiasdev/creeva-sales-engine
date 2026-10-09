import { useCallback, useEffect, useMemo, useState } from "react";

import { EnrichDialog } from "../features/enrichment/EnrichDialog";
import { downloadXlsx } from "../features/export/download";
import { loadExportData } from "../features/export/export.service";
import { listJobs } from "../features/jobs/job.service";
import {
  discardCompanies,
  loadListItems,
  qualifyCompanies,
  recommendedToQualify,
  removeList,
  renameList,
  restoreCompanies,
  startOutreach,
  countStages,
  nextStep,
} from "../features/lists/lists.service";
import type { ListItem } from "../features/lists/lists.service";
import { getListRepository } from "../features/lists/lists.repository";
import type { ProspectList } from "../features/lists/lists.repository";
import { channelOpenUrl, CHANNEL_LABEL } from "../features/contacts/channels.engine";
import { consolidateChannels } from "../features/contacts/consolidate";
import { openExternal } from "../lib/opener";
import { suppressedCompanyIds } from "../features/compliance/suppression.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { ConfirmButton } from "../components/ConfirmButton";
import { errorMessage, formatDateTime, formatPhone } from "../lib/format";
import { label, LEAD_STATUS_LABEL } from "../lib/labels";

type Stage = "ALL" | "DISCOVERED" | "ENRICHED" | "QUALIFIED" | "READY" | "DISQUALIFIED";

const STEPS: { key: Stage; title: string; statKey: string }[] = [
  { key: "DISCOVERED", title: "1 · Captadas", statKey: "discovered" },
  { key: "ENRICHED", title: "2 · Enriquecidas", statKey: "enriched" },
  { key: "QUALIFIED", title: "3 · Qualificadas", statKey: "qualified" },
  { key: "READY", title: "4 · Em abordagem", statKey: "ready" },
  { key: "DISQUALIFIED", title: "Descartadas", statKey: "disqualified" },
];

interface Props {
  listId: number;
  onBack: () => void;
  onOpenCompany: (id: number) => void;
}

export function ListDetailPage({ listId, onBack, onOpenCompany }: Props) {
  const [list, setList] = useState<ProspectList | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [recommended, setRecommended] = useState<number[]>([]);
  const [stage, setStage] = useState<Stage>("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [enrichIds, setEnrichIds] = useState<number[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState("");
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const [l, rows, jobs] = await Promise.all([
        getListRepository(listId),
        loadListItems(listId),
        listJobs(5),
      ]);

      setList(l);
      setItems(rows);
      setBlockedIds(await suppressedCompanyIds(rows.map((r) => Number(r.company.id))));
      setRecommended(await recommendedToQualify(rows));
      setRunning(
        jobs.some(
          (j) =>
            j.type === "ENRICHMENT" &&
            (j.status === "PENDING" || j.status === "RUNNING"),
        ),
      );
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar a lista."));
    }
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => void load(), 2000);

    return () => clearInterval(timer);
  }, [running, load]);

  const stats = useMemo(
    () => countStages(items.map((i) => ({ lead_status: i.company.lead_status }))),
    [items],
  );
  const next = nextStep(stats);

  const shown = items.filter((i) => {
    if (stage !== "ALL") {
      const st = i.company.lead_status === "ENRICHING" ? "DISCOVERED" : i.company.lead_status;
      if (st !== stage) return false;
    }

    const q = query.trim().toLowerCase();

    return (
      !q ||
      [i.company.name, i.company.address, i.company.category, i.company.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  });

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const chosen = [...selected];

  /** Seleção atual; se vazia, todas as empresas visíveis. */
  function target(statuses: string[]): number[] {
    const base = chosen.length > 0 ? items.filter((i) => selected.has(Number(i.company.id))) : shown;

    return base
      .filter((i) => statuses.includes(i.company.lead_status))
      .map((i) => Number(i.company.id));
  }

  async function run(fn: () => Promise<string>) {
    try {
      setError("");
      setMessage(await fn());
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(errorMessage(err, "Erro ao executar a ação."));
    }
  }

  async function exportSheet() {
    await run(async () => {
      const data = await loadExportData(listId);
      const path = await downloadXlsx(data);

      return path
        ? `Planilha salva (${data.companies.length} empresa(s)): ${path}`
        : "Exportação cancelada.";
    });
  }

  if (!list) {
    return (
      <section className="panel">
        <button type="button" className="secondary" onClick={onBack}>← Listas</button>
        <ErrorMessage message={error} />
        {!error && <p className="muted">Carregando…</p>}
      </section>
    );
  }

  const toEnrich = target(["DISCOVERED", "ENRICHED"]);

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">LISTA · {formatDateTime(list.created_at)}</span>
            <h2>{list.name}</h2>
          </div>

          <button type="button" className="secondary" onClick={onBack}>← Listas</button>
        </div>

        <p className="muted">
          Dados vindos do Google Maps ({list.found} encontradas, {list.imported} novas,{" "}
          {list.duplicates} duplicadas, {list.already_seen} já coletadas antes). O
          enriquecimento só acrescenta informações encontradas no site/CNPJ; nada é inventado.
        </p>

        <div className="stepper">
          {STEPS.map((s) => {
            const count = stats[s.statKey as keyof typeof stats] as number;

            return (
              <button
                type="button"
                key={s.key}
                className={stage === s.key ? "step active" : "step"}
                onClick={() => setStage(stage === s.key ? "ALL" : s.key)}
              >
                <strong>{count}</strong>
                <span>{s.title}</span>
              </button>
            );
          })}
        </div>

        <p>
          <strong>Próximo passo:</strong> {next.title} — {next.detail}
          {running && " · enriquecimento em andamento…"}
        </p>

        <div className="outreach-actions">
          <button
            type="button"
            disabled={toEnrich.length === 0 || running}
            onClick={() => setEnrichIds(toEnrich)}
          >
            Enriquecer ({toEnrich.length})
          </button>

          <button
            type="button"
            className="secondary"
            disabled={recommended.length === 0}
            onClick={() =>
              void run(async () => {
                const r = await qualifyCompanies(recommended);
                return `${r.done} empresa(s) recomendada(s) qualificada(s).`;
              })
            }
          >
            Qualificar recomendadas ({recommended.length})
          </button>

          <button
            type="button"
            className="secondary"
            disabled={target(["DISCOVERED", "ENRICHED"]).length === 0}
            onClick={() =>
              void run(async () => {
                const r = await qualifyCompanies(target(["DISCOVERED", "ENRICHED"]));
                return `${r.done} empresa(s) qualificada(s).`;
              })
            }
          >
            Qualificar {chosen.length > 0 ? "selecionadas" : "visíveis"}
          </button>

          <button
            type="button"
            disabled={target(["QUALIFIED"]).length === 0}
            onClick={() =>
              void run(async () => {
                const r = await startOutreach(target(["QUALIFIED"]));
                return `${r.done} empresa(s) em abordagem. As tarefas estão em "Hoje".${
                  r.suppressed ? ` ${r.suppressed} ignorada(s): estão na lista de não contatar.` : ""
                }`;
              })
            }
          >
            Iniciar abordagem ({target(["QUALIFIED"]).length})
          </button>

          <button
            type="button"
            className="secondary"
            disabled={target(["DISCOVERED", "ENRICHED", "QUALIFIED"]).length === 0}
            onClick={() => setDiscarding(true)}
          >
            Descartar…
          </button>

          <button
            type="button"
            className="secondary"
            disabled={target(["DISQUALIFIED"]).length === 0}
            onClick={() =>
              void run(async () => {
                const r = await restoreCompanies(target(["DISQUALIFIED"]));
                return `${r.done} empresa(s) restaurada(s).`;
              })
            }
          >
            Restaurar
          </button>

          <button type="button" className="secondary" onClick={() => void exportSheet()}>
            Exportar planilha da lista
          </button>
        </div>

        {discarding && (
          <div className="outreach-actions">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo do descarte (obrigatório)"
            />
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  const r = await discardCompanies(
                    target(["DISCOVERED", "ENRICHED", "QUALIFIED"]),
                    reason,
                  );
                  setDiscarding(false);
                  setReason("");
                  return `${r.done} empresa(s) descartada(s).`;
                })
              }
            >
              Confirmar descarte
            </button>
            <button type="button" className="secondary" onClick={() => setDiscarding(false)}>
              Cancelar
            </button>
          </div>
        )}

        {message && <p className="muted">{message}</p>}
        <ErrorMessage message={error} />
      </section>

      {enrichIds && (
        <EnrichDialog
          companyIds={enrichIds}
          onClose={() => setEnrichIds(null)}
          onStarted={() => {
            setEnrichIds(null);
            setRunning(true);
            setMessage("Enriquecimento iniciado. A lista atualiza sozinha.");
            void load();
          }}
        />
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>
            Empresas da lista ({shown.length}
            {shown.length !== items.length ? ` de ${items.length}` : ""})
          </h2>

          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por nome, endereço, categoria…"
          />
        </div>

        {shown.length === 0 ? (
          <div className="empty">Nenhuma empresa neste filtro.</div>
        ) : (
          <div className="list-table">
            <div className="list-row list-head">
              <span>
                <input
                  type="checkbox"
                  checked={shown.every((i) => selected.has(Number(i.company.id)))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(shown.map((i) => Number(i.company.id)))
                        : new Set(),
                    )
                  }
                />
              </span>
              <span>Empresa</span>
              <span>Contato (Google Maps)</span>
              <span>Avaliação</span>
              <span>Etapa</span>
              <span>Ações</span>
            </div>

            {shown.map((i) => {
              const c = i.company;
              const wa = blockedIds.has(Number(c.id))
                ? undefined
                : i.channels.find((ch) => ch.kind === "WHATSAPP");

              return (
                <div className="list-row" key={c.id}>
                  <span>
                    <input
                      type="checkbox"
                      checked={selected.has(Number(c.id))}
                      onChange={() => toggle(Number(c.id))}
                    />
                  </span>

                  <div>
                    <strong className="clickable" onClick={() => onOpenCompany(Number(c.id))}>
                      {c.name}
                    </strong>
                    <small>{c.category || c.segment || "—"}</small>
                    <small>{c.address || "—"}</small>
                  </div>

                  <div>
                    {blockedIds.has(Number(c.id)) && (
                      <small className="error-text">Não contatar (pediu para parar)</small>
                    )}
                    <small>{c.phone ? formatPhone(c.phone) : "sem telefone"}</small>
                    <small>{c.website || "sem site"}</small>
                    {consolidateChannels(i.channels).main.length > 0 && (
                      <small>
                        {consolidateChannels(i.channels)
                          .main.map((ch) => CHANNEL_LABEL[ch.kind])
                          .join(" · ")}
                      </small>
                    )}
                  </div>

                  <div>
                    <small>
                      {c.rating !== null ? `★ ${c.rating} (${c.reviews_count ?? 0})` : "—"}
                    </small>
                    {i.score !== null && <small>Pontuação {i.score}</small>}
                  </div>

                  <span className="status">
                    {label(LEAD_STATUS_LABEL, c.lead_status)}
                  </span>

                  <div className="row-actions">
                    {wa && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void openExternal(channelOpenUrl(wa))}
                      >
                        WhatsApp
                      </button>
                    )}
                    {c.maps_url && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void openExternal(c.maps_url as string)}
                      >
                        Maps
                      </button>
                    )}
                    <button type="button" className="secondary" onClick={() => onOpenCompany(Number(c.id))}>
                      Abrir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <RenamePanel list={list} onDone={(back) => (back ? onBack() : void load())} />
    </>
  );
}

function RenamePanel({
  list,
  onDone,
}: {
  list: ProspectList;
  onDone: (back: boolean) => void;
}) {
  const [name, setName] = useState(list.name);
  const [error, setError] = useState("");

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Gerenciar lista</h2>
      </div>

      <div className="outreach-actions">
        <input value={name} onChange={(e) => setName(e.target.value)} />

        <button
          type="button"
          className="secondary"
          onClick={() =>
            void renameList(Number(list.id), name)
              .then(() => onDone(false))
              .catch((err) => setError(errorMessage(err, "Erro ao renomear.")))
          }
        >
          Renomear
        </button>

        <ConfirmButton
          secondary
          warning="A lista será excluída; as empresas permanecem na Base geral."
          confirmLabel="Excluir lista"
          onConfirm={() =>
            void removeList(Number(list.id))
              .then(() => onDone(true))
              .catch((err) => setError(errorMessage(err, "Erro ao excluir.")))
          }
        >
          Excluir lista
        </ConfirmButton>
      </div>

      <ErrorMessage message={error} />
    </section>
  );
}
