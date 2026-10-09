import { useCallback, useEffect, useState } from "react";

import {
  getPublicSettings,
  setSetting,
} from "../features/settings/settings.service";
import type { SettingKey } from "../features/settings/settings.service";

import { testGooglePlacesConnection } from "../features/discovery/googlePlaces.client";
import { getApiUsageSummary } from "../features/jobs/apiUsage.service";

import {
  exportBackup,
  importBackup,
} from "../features/backup/backup.service";

import { runDiagnostics } from "../features/diagnostics/diagnostics.service";
import type { DiagnosticStep } from "../features/diagnostics/diagnostics.service";

import { testOpenAiConnection } from "../features/ai/openai.client";
import { testClaudeConnection } from "../features/ai/anthropic.client";

import {
  clearApiKeys,
  clearBusinessData,
  resetEverything,
} from "../features/backup/reset.service";

import {
  listServices,
  updateService,
} from "../features/services/services.service";
import type { Service } from "../features/services/services.service";

import { saveText } from "../lib/saveFile";
import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

const FIELDS: [SettingKey, string, string][] = [
  ["company_name", "Nome da empresa", "Creava Digital"],
  ["seller_name", "Nome do vendedor", ""],
  ["default_city", "Cidade padrão", "Cuiabá"],
  ["default_state", "UF padrão", "MT"],
  ["preferred_segments", "Segmentos preferidos (separados por vírgula)", "odontologia, advocacia"],
  ["min_score", "Pontuação mínima para qualificar", "50"],
  ["follow_up_delay_days", "Dias até o retorno (follow-up)", "2"],
  ["proposal_follow_up_days", "Dias até o retorno da proposta", "3"],
  ["openai_model", "Modelo OpenAI", "gpt-4o-mini"],
  ["anthropic_model", "Modelo Claude (conversas)", "claude-sonnet-5-5"],
];

const SECRETS: [SettingKey, string][] = [
  ["google_api_key", "Google (busca de empresas)"],
  ["openai_api_key", "OpenAI (análise e gargalos)"],
  ["anthropic_api_key", "Claude / Anthropic (conversas)"],
];

type DangerAction = "keys" | "data" | "all";

const DANGER: Record<
  DangerAction,
  { label: string; description: string; run: () => Promise<void> }
> = {
  keys: {
    label: "Remover chaves de API",
    description: "Apaga as chaves do Google, da OpenAI e da Anthropic. Os dados são mantidos.",
    run: clearApiKeys,
  },
  data: {
    label: "Apagar dados de teste",
    description:
      "Apaga empresas, prospects, tarefas, histórico, jobs e uso de APIs. Mantém configurações, chaves e playbook.",
    run: clearBusinessData,
  },
  all: {
    label: "Resetar tudo",
    description:
      "Apaga dados, configurações, chaves e restaura o playbook padrão. O app volta ao estado inicial.",
    run: resetEverything,
  },
};

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<
    { provider: string; requests: number; tokens: number; estimated_cost: number }[]
  >([]);
  const [services, setServices] = useState<Service[]>([]);
  const [diag, setDiag] = useState<DiagnosticStep[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const [danger, setDanger] = useState<DangerAction | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await getPublicSettings();
      setValues(s.values);
      setConfigured(s.configured);
      setUsage(await getApiUsageSummary());
      setServices(await listServices());
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar configurações."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    try {
      setError("");

      for (const [key] of FIELDS) {
        await setSetting(key, values[key] ?? "");
      }

      for (const [key] of SECRETS) {
        const typed = secretInputs[key];
        if (typed?.trim()) await setSetting(key, typed);
      }

      setSecretInputs({});
      setMessage("Configurações salvas.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Erro ao salvar."));
    }
  }

  async function handleTestGoogle() {
    try {
      setError("");
      setMessage("Testando Google Places…");
      setMessage(await testGooglePlacesConnection());
    } catch (err) {
      setMessage("");
      setError(errorMessage(err, "Falha ao testar o Google Places."));
    }
  }

  async function runDanger() {
    if (!danger || confirmText !== "APAGAR") return;

    try {
      setError("");
      await DANGER[danger].run();
      setMessage(`${DANGER[danger].label}: concluído.`);
      setDanger(null);
      setConfirmText("");
      setSecretInputs({});
      await load();
    } catch (err) {
      setError(errorMessage(err, "Erro ao limpar."));
    }
  }

  async function saveService(service: Service) {
    try {
      setError("");
      await updateService(service.id, {
        name: service.name,
        description: service.description,
        pain_points: service.pain_points,
        active: service.active,
      });
      setMessage(`Serviço "${service.name}" salvo.`);
    } catch (err) {
      setError(errorMessage(err, "Erro ao salvar serviço."));
    }
  }

  const editService = (id: number, patch: Partial<Service>) =>
    setServices((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function handleDiagnostics() {
    setDiagRunning(true);
    setDiag([]);

    try {
      await runDiagnostics(setDiag);
      await load();
    } finally {
      setDiagRunning(false);
    }
  }

  async function handleTestOpenAi() {
    try {
      setError("");
      setMessage("Testando OpenAI…");
      setMessage(await testOpenAiConnection());
    } catch (err) {
      setMessage("");
      setError(errorMessage(err, "Falha ao testar a OpenAI."));
    }
  }

  async function handleTestClaude() {
    try {
      setError("");
      setMessage("Testando Claude…");
      setMessage(await testClaudeConnection());
    } catch (err) {
      setMessage("");
      setError(errorMessage(err, "Falha ao testar o Claude."));
    }
  }

  async function removeSecret(key: SettingKey) {
    await setSetting(key, "");
    await load();
  }

  async function handleExport() {
    try {
      const file = await exportBackup();
      const path = await saveText(
        `creava-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(file, null, 2),
        [{ name: "Backup (JSON)", extensions: ["json"] }],
        "application/json",
      );

      if (!path) {
        setMessage("Exportação cancelada.");
        return;
      }

      setMessage(`Backup salvo em ${path} (as chaves de API não são incluídas).`);
    } catch (err) {
      setError(errorMessage(err, "Erro ao exportar."));
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;

    if (
      !window.confirm(
        "Importar substitui TODOS os dados atuais pelos do backup. Continuar?",
      )
    ) {
      return;
    }

    try {
      setError("");
      await importBackup(JSON.parse(await file.text()));
      setMessage("Backup importado.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Erro ao importar."));
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">CONFIGURAÇÕES</span>
            <h2>Preferências</h2>
          </div>
        </div>

        <div className="company-form">
          {FIELDS.map(([key, label, placeholder]) => (
            <label key={key}>
              {label}
              <input
                value={values[key] ?? ""}
                placeholder={placeholder}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>

        <h3 className="group-title">Chaves das integrações</h3>

        <div className="secret-grid">
          {SECRETS.map(([key, label]) => (
            <div className="secret-field" key={key}>
              <div className="secret-head">
                <strong>{label}</strong>

                {configured[key] ? (
                  <span className="status">configurada</span>
                ) : (
                  <span className="muted">não configurada</span>
                )}

                {configured[key] && (
                  <button
                    type="button"
                    className="secondary small-btn"
                    onClick={() => void removeSecret(key)}
                  >
                    remover
                  </button>
                )}
              </div>

              <input
                type="password"
                autoComplete="off"
                placeholder={configured[key] ? "•••••••• (digite para substituir)" : "cole a chave aqui"}
                value={secretInputs[key] ?? ""}
                onChange={(e) =>
                  setSecretInputs({ ...secretInputs, [key]: e.target.value })
                }
              />
            </div>
          ))}
        </div>

        <div className="outreach-actions">
          <button
            type="button"
            className="secondary"
            disabled={!configured.google_api_key}
            onClick={() => void handleTestGoogle()}
          >
            Testar Google Places
          </button>

          <button
            type="button"
            className="secondary"
            disabled={!configured.openai_api_key}
            onClick={() => void handleTestOpenAi()}
          >
            Testar OpenAI
          </button>

          <button
            type="button"
            className="secondary"
            disabled={!configured.anthropic_api_key}
            onClick={() => void handleTestClaude()}
          >
            Testar Claude
          </button>
        </div>

        <p className="muted">
          As chaves ficam guardadas no seu banco na nuvem (valem para quem entra
          com o mesmo login) e nunca são exibidas de novo, exportadas em backup
          nem enviadas ao Git.
        </p>

        <button type="button" onClick={() => void save()}>
          Salvar
        </button>

        {message && <p className="muted">{message}</p>}
        <ErrorMessage message={error} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Uso das integrações (Google e OpenAI)</h2>
        </div>

        {usage.length === 0 ? (
          <div className="empty">Nenhum uso registrado.</div>
        ) : (
          <div className="tasks-list">
            {usage.map((u) => (
              <article className="task-item" key={u.provider}>
                <strong>{u.provider}</strong>
                <span>
                  {u.requests} req · {u.tokens} tokens · US${" "}
                  {Number(u.estimated_cost).toFixed(4)}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Backup</h2>
        </div>

        <p className="muted">
          Para trazer os dados do app antigo (versão local), exporte o backup
          nele e importe aqui.
        </p>

        <div className="outreach-actions">
          <button type="button" onClick={() => void handleExport()}>
            Exportar backup (JSON)
          </button>

          <label className="file-button">
            Importar backup
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => void handleImport(e.target.files?.[0])}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">CATÁLOGO</span>
            <h2>Serviços da Creava</h2>
            <p className="muted">
              É o que a análise (e a IA) usa para sugerir como vender. Desative
              o que você não quer oferecer.
            </p>
          </div>
        </div>

        <div className="tasks-list">
          {services.map((svc) => (
            <article className="task-item service-edit" key={svc.id}>
              <div className="task-body">
                <label className="check inline">
                  <input
                    type="checkbox"
                    checked={svc.active === 1}
                    onChange={(e) => editService(svc.id, { active: e.target.checked ? 1 : 0 })}
                  />
                  <span><strong>Oferecer</strong></span>
                </label>

                <input
                  value={svc.name}
                  onChange={(e) => editService(svc.id, { name: e.target.value })}
                />
                <textarea
                  rows={2}
                  value={svc.description}
                  onChange={(e) => editService(svc.id, { description: e.target.value })}
                />
                <textarea
                  rows={2}
                  placeholder="Dores que resolve (ajuda a IA)"
                  value={svc.pain_points ?? ""}
                  onChange={(e) => editService(svc.id, { pain_points: e.target.value })}
                />
              </div>

              <button type="button" onClick={() => void saveService(svc)}>
                Salvar
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">DIAGNÓSTICO</span>
            <h2>Testar tudo</h2>
          </div>

          <button
            type="button"
            disabled={diagRunning}
            onClick={() => void handleDiagnostics()}
          >
            {diagRunning ? "Testando…" : "Rodar diagnóstico completo"}
          </button>
        </div>

        <p className="muted">
          Testa banco, Google Places, OpenAI e o fluxo completo (empresa de
          teste → site → sinais → score → análise e mensagem por IA). A empresa
          de teste é removida no final. Usa poucas chamadas pagas.
        </p>

        {diag.length > 0 && (
          <ul className="reasons">
            {diag.map((step) => (
              <li key={step.name}>
                <strong>
                  {step.status === "OK" ? "✔" : step.status === "FALHOU" ? "✘" : "–"}{" "}
                  {step.name}
                </strong>{" "}
                — {step.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel danger-zone">
        <div className="panel-title">
          <div>
            <span className="eyebrow">ZONA DE PERIGO</span>
            <h2>Limpar para novos testes</h2>
          </div>
        </div>

        <div className="tasks-list">
          {(Object.keys(DANGER) as DangerAction[]).map((key) => (
            <article className="task-item" key={key}>
              <div className="task-body">
                <strong>{DANGER[key].label}</strong>
                <p>{DANGER[key].description}</p>
              </div>

              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDanger(key);
                  setConfirmText("");
                }}
              >
                {DANGER[key].label}
              </button>
            </article>
          ))}
        </div>

        {danger && (
          <div className="outreach">
            <strong>{DANGER[danger].label}</strong>
            <p className="muted">
              Esta ação não pode ser desfeita. Digite <b>APAGAR</b> para confirmar.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="APAGAR"
              autoFocus
            />
            <div className="outreach-actions">
              <button
                type="button"
                className="danger"
                disabled={confirmText !== "APAGAR"}
                onClick={() => void runDanger()}
              >
                Confirmar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setDanger(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
