import { useCallback, useEffect, useState } from "react";

import {
  getPublicSettings,
  setSetting,
} from "../features/settings/settings.service";
import type { SettingKey } from "../features/settings/settings.service";

import { getApiUsageSummary } from "../features/jobs/apiUsage.service";

import {
  exportBackup,
  importBackup,
} from "../features/backup/backup.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

const FIELDS: [SettingKey, string, string][] = [
  ["company_name", "Nome da empresa", "Creava Digital"],
  ["seller_name", "Nome do vendedor", ""],
  ["default_city", "Cidade padrão", "Cuiabá"],
  ["default_state", "UF padrão", "MT"],
  ["preferred_segments", "Segmentos preferidos (separados por vírgula)", "odontologia, advocacia"],
  ["min_score", "Score mínimo para qualificar", "50"],
  ["follow_up_delay_days", "Dias até o follow-up", "2"],
  ["proposal_follow_up_days", "Dias até follow-up da proposta", "3"],
  ["openai_model", "Modelo OpenAI", "gpt-4o-mini"],
];

const SECRETS: [SettingKey, string][] = [
  ["google_api_key", "Google Places API key"],
  ["openai_api_key", "OpenAI API key"],
];

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<
    { provider: string; requests: number; tokens: number; estimated_cost: number }[]
  >([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await getPublicSettings();
      setValues(s.values);
      setConfigured(s.configured);
      setUsage(await getApiUsageSummary());
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

  async function removeSecret(key: SettingKey) {
    await setSetting(key, "");
    await load();
  }

  async function handleExport() {
    try {
      const file = await exportBackup();
      const blob = new Blob([JSON.stringify(file, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `creava-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage("Backup exportado (chaves de API não são incluídas).");
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
            <span className="eyebrow">SETTINGS</span>
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

        <h3 className="group-title">Chaves de API</h3>

        <div className="company-form">
          {SECRETS.map(([key, label]) => (
            <label key={key}>
              {label}{" "}
              {configured[key] && (
                <>
                  <span className="status">configurada</span>{" "}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void removeSecret(key)}
                  >
                    remover
                  </button>
                </>
              )}
              <input
                type="password"
                autoComplete="off"
                placeholder={configured[key] ? "•••••••• (digite para substituir)" : "cole a chave"}
                value={secretInputs[key] ?? ""}
                onChange={(e) =>
                  setSecretInputs({ ...secretInputs, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>

        <p className="muted">
          As chaves ficam apenas no banco local e nunca são exibidas, exportadas
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
          <h2>Uso de APIs</h2>
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
    </>
  );
}
