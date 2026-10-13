import { useCallback, useEffect, useState } from "react";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage } from "../../lib/format";
import { normalizePhone } from "../../lib/normalize";
import { loadConfig } from "../../lib/supabase";
import { openExternal } from "../../lib/opener";

import { formatDateTime } from "../../lib/format";
import { lastWebhookEventAt } from "./inbox.service";
import { checkWhatsApp, sendWhatsAppText } from "./whatsapp.client";
import type { WhatsAppCheck } from "./whatsapp.client";

const SECRETS: [string, string][] = [
  ["WHATSAPP_TOKEN", "token permanente do usuário do sistema (Meta)"],
  ["WHATSAPP_PHONE_NUMBER_ID", "ID do número de telefone (Meta → WhatsApp → Configuração da API)"],
  ["WHATSAPP_VERIFY_TOKEN", "uma senha que você inventa (a mesma informada ao salvar o webhook na Meta)"],
  ["META_APP_SECRET", "chave secreta do app (Meta → Configurações do app → Básico)"],
];

const RAW = "https://github.com/juliodiasdev/creeva-sales-engine/blob/main/supabase/functions";

/** Conexão com o WhatsApp oficial: estado real, passo a passo e envio de teste. */
export function WhatsAppPanel() {
  const [check, setCheck] = useState<WhatsAppCheck | undefined>(undefined);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const webhook = `${loadConfig()?.url ?? "https://SEU-PROJETO.supabase.co"}/functions/v1/whatsapp-webhook`;

  const run = useCallback(async () => {
    setCheck(undefined);
    setCheck(await checkWhatsApp());
    setLastEvent(await lastWebhookEventAt().catch(() => null));
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  async function sendTest() {
    try {
      setBusy(true);
      setError("");
      setMessage("");

      const phone = normalizePhone(to);

      if (!phone) throw new Error("Informe o número com DDD, ex.: 65 99999-1111.");

      await sendWhatsAppText(`55${phone}`, "Teste de conexão da Creava Digital. Se você recebeu esta mensagem, o envio está certo.");
      setMessage("Mensagem de teste enviada. Confira no celular.");
    } catch (err) {
      setError(errorMessage(err, "Não foi possível enviar o teste."));
    } finally {
      setBusy(false);
    }
  }

  const ready = check?.kind === "ready";

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">WHATSAPP OFICIAL (META)</span>
          <h2>Conectar o WhatsApp</h2>
        </div>

        <button type="button" className="secondary" onClick={() => void run()}>
          Verificar conexão
        </button>
      </div>

      {check === undefined ? (
        <p className="muted">Verificando…</p>
      ) : check.kind === "ready" ? (
        <>
          <p>
            <strong>Envio configurado.</strong> O servidor tem o token e o número.
          </p>
          <p className={lastEvent ? undefined : "muted"}>
            {lastEvent
              ? `Recebimento funcionando: último aviso da Meta em ${formatDateTime(lastEvent)}.`
              : "Recebimento ainda NÃO confirmado: nenhum aviso da Meta chegou. Peça a alguém para escrever para o número e veja a mensagem aparecer em Conversas. Se não aparecer, confira o webhook (passo 5)."}
          </p>
        </>
      ) : check.kind === "missing_secrets" ? (
        <p className="error">
          A função de envio existe, mas faltam segredos: {check.missing.join(", ")}.
        </p>
      ) : check.kind === "not_installed" ? (
        <p className="muted">
          Ainda não conectado: a função <code>whatsapp-send</code> não está instalada no seu
          Supabase. Siga o passo a passo abaixo.
        </p>
      ) : (
        <p className="error">{check.message}</p>
      )}

      <details open={!ready}>
        <summary>Passo a passo (uma vez só)</summary>

        <ol className="steps-list">
          <li>
            <strong>Meta:</strong> em business.facebook.com crie o portfólio da Creava e, em
            developers.facebook.com, um app do tipo <em>Empresa</em> com o produto{" "}
            <em>WhatsApp</em>. Conecte o número: o do seu <strong>WhatsApp Business atual</strong>{" "}
            (opção de continuar usando o aplicativo no celular, se a Meta liberar para o seu
            número) ou um número novo e dedicado. Pode ser necessário verificar a empresa.
          </li>
          <li>
            <strong>Token permanente:</strong> no portfólio, crie um <em>usuário do sistema</em>, dê a
            ele acesso ao app e à conta do WhatsApp e gere o token com as permissões{" "}
            <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>.
          </li>
          <li>
            <strong>Supabase → Edge Functions → Deploy a new function</strong> (no próprio painel):
            crie <code>whatsapp-send</code> (deixe "Verify JWT" ligado) e{" "}
            <code>whatsapp-webhook</code> (desligue "Verify JWT"). O código de cada uma está no
            projeto: abra{" "}
            <a href={`${RAW}/whatsapp-send/index.ts`} onClick={(e) => { e.preventDefault(); void openExternal(`${RAW}/whatsapp-send/index.ts`); }}>whatsapp-send</a>{" "}
            e{" "}
            <a href={`${RAW}/whatsapp-webhook/index.ts`} onClick={(e) => { e.preventDefault(); void openExternal(`${RAW}/whatsapp-webhook/index.ts`); }}>whatsapp-webhook</a>
            , copie o conteúdo e cole no editor.
          </li>
          <li>
            <strong>Supabase → Edge Functions → Secrets:</strong> cadastre:
            <ul>
              {SECRETS.map(([name, hint]) => (
                <li key={name}>
                  <code>{name}</code> — {hint}
                </li>
              ))}
            </ul>
          </li>
          <li>
            <strong>Webhook na Meta</strong> (WhatsApp → Configuração → Webhook): endereço{" "}
            <code>{webhook}</code>, com o mesmo token de verificação, e assine o campo{" "}
            <code>messages</code>.
          </li>
          <li>
            Volte aqui e clique em <strong>Verificar conexão</strong>. Para testar o recebimento,
            peça a alguém para <strong>escrever para o número</strong>: a mensagem deve aparecer em
            Conversas. O envio de teste abaixo só chega a quem escreveu nas últimas 24 horas (ou a
            números de teste cadastrados na Meta).
          </li>
        </ol>

        <p className="muted">
          O token e o segredo ficam só no servidor (Supabase), nunca neste app. O app só recebe se
          está "configurado".
        </p>
      </details>

      {ready && (
        <>
          <div className="outreach-actions">
            <input
              aria-label="Número para o teste"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Número com DDD, ex.: 65 99999-1111"
            />

            <button type="button" disabled={busy || !to.trim()} onClick={() => void sendTest()}>
              {busy ? "Enviando…" : "Enviar mensagem de teste"}
            </button>
          </div>

          <p className="muted small">
            Funciona para quem escreveu para o número nas últimas 24 horas ou para números
            cadastrados como teste na Meta. Para qualquer outro, a Meta recusa: isso não é erro de
            configuração.
          </p>
        </>
      )}

      {message && <p className="muted">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
