import { useCallback, useEffect, useState } from "react";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage } from "../../lib/format";
import { loadConfig } from "../../lib/supabase";

import { getWhatsAppStatus, isWhatsAppReady, sendWhatsAppText } from "./whatsapp.client";
import type { WhatsAppStatus } from "./whatsapp.client";

const SECRETS: [string, string][] = [
  ["WHATSAPP_TOKEN", "token permanente do usuário do sistema (Meta)"],
  ["WHATSAPP_PHONE_NUMBER_ID", "ID do número de telefone (Meta → WhatsApp → Configuração da API)"],
  ["WHATSAPP_VERIFY_TOKEN", "uma senha que você inventa (a mesma informada ao salvar o webhook na Meta)"],
  ["META_APP_SECRET", "chave secreta do app (Meta → Configurações do app → Básico)"],
];

/** Conexão com o WhatsApp oficial: estado, passo a passo e envio de teste. */
export function WhatsAppPanel() {
  const [status, setStatus] = useState<WhatsAppStatus | null | undefined>(undefined);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const webhook = `${loadConfig()?.url ?? "https://SEU-PROJETO.supabase.co"}/functions/v1/whatsapp-webhook`;

  const check = useCallback(async () => {
    setStatus(undefined);
    setStatus(await getWhatsAppStatus());
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function sendTest() {
    try {
      setBusy(true);
      setError("");
      setMessage("");
      await sendWhatsAppText(to, "Teste de conexão da Creava Digital. Se você recebeu esta mensagem, está tudo certo.");
      setMessage("Mensagem de teste enviada. Confira no celular.");
    } catch (err) {
      setError(errorMessage(err, "Não foi possível enviar o teste."));
    } finally {
      setBusy(false);
    }
  }

  const ready = isWhatsAppReady(status ?? null);

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">WHATSAPP OFICIAL (META)</span>
          <h2>Conectar o WhatsApp</h2>
        </div>

        <button type="button" className="secondary" onClick={() => void check()}>
          Verificar conexão
        </button>
      </div>

      {status === undefined ? (
        <p className="muted">Verificando…</p>
      ) : ready ? (
        <p>
          <strong>Conectado.</strong> As respostas chegam em Conversas e você pode responder dentro
          das 24 horas depois da última mensagem da pessoa.
        </p>
      ) : status ? (
        <p className="error">
          A função de envio existe, mas faltam segredos:{" "}
          {[!status.configured.token && "WHATSAPP_TOKEN", !status.configured.phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID"]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      ) : (
        <p className="muted">
          Ainda não conectado: a função <code>whatsapp-send</code> não está instalada no seu
          Supabase. Siga o passo a passo abaixo.
        </p>
      )}

      <details>
        <summary>Passo a passo (uma vez só)</summary>

        <ol className="steps-list">
          <li>
            <strong>Meta:</strong> em business.facebook.com crie o portfólio da Creava e, em
            developers.facebook.com, um app do tipo <em>Empresa</em> com o produto{" "}
            <em>WhatsApp</em>. Conecte o seu número do WhatsApp Business (opção de usar o app já
            existente, com o aplicativo no celular). Pode ser necessário verificar a empresa.
          </li>
          <li>
            <strong>Token permanente:</strong> no portfólio, crie um <em>usuário do sistema</em>, dê a
            ele acesso ao app e à conta do WhatsApp e gere o token com as permissões{" "}
            <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>.
          </li>
          <li>
            <strong>Supabase → Edge Functions:</strong> crie a função <code>whatsapp-send</code>{" "}
            (deixe "Verify JWT" ligado) e a função <code>whatsapp-webhook</code> (desligue "Verify
            JWT"), colando o código das pastas <code>supabase/functions/…/index.ts</code> do projeto.
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
            Volte aqui, clique em <strong>Verificar conexão</strong> e envie um teste.
          </li>
        </ol>

        <p className="muted">
          O token e o segredo ficam só no servidor (Supabase), nunca neste app. O app só recebe se
          está "configurado".
        </p>
      </details>

      {ready && (
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
      )}

      {message && <p className="muted">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
