import { useCallback, useEffect, useMemo, useState } from "react";

import {
  bestApproach,
  loadContactList,
} from "../features/contacts/contacts.service";
import type { ContactListItem } from "../features/contacts/contacts.service";
import { ChannelButtons } from "../features/contacts/ChannelButtons";
import { suppressedCompanyIds } from "../features/compliance/suppression.service";

import { EnrichDialog } from "../features/enrichment/EnrichDialog";
import { loadExportData } from "../features/export/export.service";
import { downloadCsv, downloadXlsx } from "../features/export/download";

import { label, LEAD_STATUS_LABEL } from "../lib/labels";
import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

const PAGE = 300;

export function ContactsPage({
  onOpenCompany,
}: {
  onOpenCompany: (id: number) => void;
}) {
  const [items, setItems] = useState<ContactListItem[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [search, setSearch] = useState("");
  const [onlyWhatsapp, setOnlyWhatsapp] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const rows = await loadContactList(limit);

      setItems(rows);
      setBlockedIds(await suppressedCompanyIds(rows.map((r) => Number(r.company.id))));
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar contatos."));
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    return items.filter(
      (item) =>
        (!q ||
          [item.company.name, item.company.segment, item.company.city]
            .join(" ")
            .toLowerCase()
            .includes(q)) &&
        (!onlyWhatsapp || item.channels.some((c) => c.kind === "WHATSAPP")),
    );
  }, [items, search, onlyWhatsapp]);

  async function exportFile(kind: "xlsx" | "csv") {
    try {
      setError("");
      setBusy(kind);
      const data = await loadExportData();

      const path =
        kind === "xlsx" ? await downloadXlsx(data) : await downloadCsv(data);

      setMessage(
        path
          ? `Planilha salva (${data.companies.length} empresa(s)): ${path}`
          : "Exportação cancelada.",
      );
    } catch (err) {
      setError(errorMessage(err, "Erro ao gerar a planilha."));
    } finally {
      setBusy("");
    }
  }

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">CONTATOS</span>
            <h2>Todos os contatos</h2>
            <p className="muted">
              Clique em um canal para abrir direto no WhatsApp, Instagram,
              Facebook, LinkedIn, e-mail ou telefone.
            </p>
          </div>

          <div className="outreach-actions">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void exportFile("xlsx")}
            >
              {busy === "xlsx" ? "Gerando…" : "Exportar Excel"}
            </button>

            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() => void exportFile("csv")}
            >
              CSV
            </button>
          </div>
        </div>

        <div className="outreach-actions">
          <input
            className="grow"
            placeholder="Buscar por empresa, segmento ou cidade"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <label className="check inline">
            <input
              type="checkbox"
              checked={onlyWhatsapp}
              onChange={(e) => setOnlyWhatsapp(e.target.checked)}
            />
            <span>Só com WhatsApp</span>
          </label>

          <button
            type="button"
            className="secondary"
            disabled={selected.size === 0}
            onClick={() => setEnriching(true)}
          >
            Enriquecer selecionadas ({selected.size})
          </button>
        </div>

        {message && <p className="muted">{message}</p>}
        <ErrorMessage message={error} />
      </section>

      {enriching && (
        <EnrichDialog
          companyIds={[...selected]}
          onClose={() => setEnriching(false)}
          onStarted={() => {
            setEnriching(false);
            setSelected(new Set());
            setMessage(
              "Enriquecimento iniciado. Acompanhe em Discovery → Jobs e recarregue esta lista depois.",
            );
          }}
        />
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>Empresas</h2>
          <span className="counter">
            {visible.length} de {items.length}
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="empty">Nenhum contato encontrado.</div>
        ) : (
          <div className="tasks-list">
            {visible.map(({ company, channels, approaches, score }) => {
              const wa = bestApproach(approaches, "WHATSAPP");

              return (
                <article className="task-item contact-row" key={company.id}>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${company.name}`}
                    checked={selected.has(company.id)}
                    onChange={() => toggle(company.id)}
                  />

                  <div className="task-body">
                    <strong
                      className="clickable"
                      onClick={() => onOpenCompany(company.id)}
                    >
                      {company.name}
                    </strong>

                    <p>
                      {[company.segment, company.city, company.state]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                      {score !== null ? ` · pontuação ${score}` : ""}
                    </p>

                    <ChannelButtons
                      channels={channels}
                      message={wa?.message}
                      subject={`Contato — ${company.name}`}
                      size="small"
                      blocked={blockedIds.has(Number(company.id))}
                    />
                  </div>

                  <div className="task-actions">
                    <span className="status">{label(LEAD_STATUS_LABEL, company.lead_status)}</span>

                    <button
                      type="button"
                      className="secondary"
                      onClick={() => onOpenCompany(company.id)}
                    >
                      Abordagens
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {items.length >= limit && (
          <button
            type="button"
            className="secondary"
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Carregar mais
          </button>
        )}
      </section>
    </>
  );
}
