import { useState } from "react";

import { startEnrichmentJob } from "./enrichment.service";
import type { EnrichOptions } from "./enrichment.service";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage } from "../../lib/format";

const MAX_AI = 25;

/**
 * Pergunta ao usuário o que ele aceita executar antes de enriquecer.
 * Nada roda sem o aceite; a IA vem desmarcada.
 */
export function EnrichDialog({
  companyIds,
  onClose,
  onStarted,
}: {
  companyIds: number[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const [options, setOptions] = useState<EnrichOptions>({
    crawlSite: true,
    analyze: true,
    ai: false,
  });

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const tooManyForAi = !!options.ai && companyIds.length > MAX_AI;

  async function start() {
    try {
      setBusy(true);
      setError("");
      await startEnrichmentJob(companyIds, options);
      onStarted();
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar."));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: keyof EnrichOptions) =>
    setOptions((o) => ({ ...o, [key]: !o[key] }));

  return (
    <section className="panel enrich-dialog">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ENRIQUECER</span>
          <h2>{companyIds.length} empresa(s)</h2>
          <p className="muted">Escolha o que você aceita executar:</p>
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={options.crawlSite}
          onChange={() => toggle("crawlSite")}
        />
        <span>
          <strong>Ler o site das empresas</strong>
          <small>
            Busca e-mails, WhatsApp, Instagram, Facebook, LinkedIn e
            outras redes (página inicial e de contato). Sem IA, sem custo.
          </small>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={options.analyze}
          onChange={() => toggle("analyze")}
        />
        <span>
          <strong>Analisar e sugerir serviços</strong>
          <small>
            Sinais, pontuação com explicação, serviços da Creava mais
            adequados e abordagens por canal (templates). Sem IA, sem custo.
          </small>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={!!options.ai}
          onChange={() => toggle("ai")}
        />
        <span>
          <strong>Diagnóstico de gargalos com IA (opcional)</strong>
          <small>
            A OpenAI analisa os dados reais de cada empresa e aponta os
            gargalos que a Creava resolve, sempre com a evidência que
            os comprova (1 chamada por empresa, centavos). Máx. {MAX_AI}{" "}
            por vez.
          </small>
        </span>
      </label>

      {tooManyForAi && (
        <p className="error">
          Com IA, selecione no máximo {MAX_AI} empresas por vez.
        </p>
      )}

      <ErrorMessage message={error} />

      <div className="outreach-actions">
        <button
          type="button"
          disabled={
            busy ||
            tooManyForAi ||
            (!options.crawlSite && !options.analyze && !options.ai)
          }
          onClick={() => void start()}
        >
          {busy ? "Iniciando…" : "Enriquecer agora"}
        </button>

        <button type="button" className="secondary" onClick={onClose}>
          Agora não
        </button>
      </div>
    </section>
  );
}
